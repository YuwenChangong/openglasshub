import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

export const CONFIRMATION_PHRASE_ISSUANCE_V1 = "r6-production-reconciliation-confirmation-phrase-issuance-v1";
export const CONFIRMATION_PHRASE_BINDING_V1 = "r6-production-reconciliation-confirmation-phrase-candidate-binding-v1";
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9-]{36}$/;
const hash = value => createHash("sha256").update(value).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };
const canonicalRoot = repositoryRoot => path.resolve(repositoryRoot, "..", "r6-production-reconciliation-confirmation-authority-v1");
const authorityRoot = ({ repositoryRoot, testOnly = false, testAuthorityRoot }) => {
  if (testOnly && path.isAbsolute(String(testAuthorityRoot ?? ""))) return path.resolve(testAuthorityRoot);
  if (testAuthorityRoot !== undefined) fail("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_AUTHORITY_ROOT_OVERRIDE_FORBIDDEN");
  return canonicalRoot(repositoryRoot);
};
const phrase = ({ sourceCommit, randomBytesProvider }) => `CONFIRM_R6_PRODUCTION_RECONCILIATION_${sourceCommit.slice(0, 8).toUpperCase()}_${randomBytesProvider(32).toString("hex").toUpperCase()}_SINGLE_USE_V5`;
const writeExclusiveJson = async (file, value, replayCode) => {
  await mkdir(path.dirname(file), { recursive: true });
  let handle;
  try {
    handle = await open(file, "wx", 0o600);
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
    await handle.writeFile(bytes); await handle.sync();
    return Object.freeze({ path: file, sha256: hash(bytes), value: Object.freeze({ ...value }) });
  } catch (error) { if (error?.code === "EEXIST") fail(replayCode); throw error; } finally { await handle?.close(); }
};
const exactKeys = (value, keys, code) => { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) fail(code); };

export function confirmationAuthorityRootForRepository(repositoryRoot) { return canonicalRoot(repositoryRoot); }

export async function issueFreshConfirmationPhraseV1({ repositoryRoot, sourceCommit, now = new Date().toISOString(), randomBytesProvider = randomBytes, issuanceId = randomUUID(), testOnly = false, testAuthorityRoot } = {}) {
  if (!path.isAbsolute(String(repositoryRoot ?? "")) || !COMMIT.test(String(sourceCommit ?? "")) || !UUID.test(String(issuanceId ?? "")) || Number.isNaN(Date.parse(String(now)))) fail("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_ISSUANCE_INVALID");
  if (!testOnly && randomBytesProvider !== randomBytes) fail("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_RNG_OVERRIDE_FORBIDDEN");
  const confirmationPhrase = phrase({ sourceCommit, randomBytesProvider });
  const confirmationPhraseSha256 = hash(confirmationPhrase);
  const root = authorityRoot({ repositoryRoot, testOnly, testAuthorityRoot });
  const value = { schemaVersion: CONFIRMATION_PHRASE_ISSUANCE_V1, sourceCommit, confirmationPhraseSha256, issuanceId, issuedAtUtc: now, formatVersion: "V5" };
  const artifact = await writeExclusiveJson(path.join(root, "issuances", `${confirmationPhraseSha256}.json`), value, "R6_PRODUCTION_RECONCILIATION_CONFIRMATION_PHRASE_ALREADY_ISSUED");
  return Object.freeze({ confirmationPhrase, confirmationPhraseSha256, authorityRoot: root, receipt: artifact });
}

export async function issueTestOnlyConfirmationPhraseV1({ repositoryRoot, sourceCommit, confirmationPhrase, now = new Date().toISOString(), issuanceId = randomUUID(), testAuthorityRoot } = {}) {
  if (!path.isAbsolute(String(repositoryRoot ?? "")) || !COMMIT.test(String(sourceCommit ?? "")) || typeof confirmationPhrase !== "string" || !UUID.test(String(issuanceId ?? "")) || Number.isNaN(Date.parse(String(now)))) fail("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_ISSUANCE_INVALID");
  const confirmationPhraseSha256 = hash(confirmationPhrase);
  const root = authorityRoot({ repositoryRoot, testOnly: true, testAuthorityRoot });
  const value = { schemaVersion: CONFIRMATION_PHRASE_ISSUANCE_V1, sourceCommit, confirmationPhraseSha256, issuanceId, issuedAtUtc: now, formatVersion: "V5" };
  const receipt = await writeExclusiveJson(path.join(root, "issuances", `${confirmationPhraseSha256}.json`), value, "R6_PRODUCTION_RECONCILIATION_CONFIRMATION_PHRASE_ALREADY_ISSUED");
  return Object.freeze({ confirmationPhrase, confirmationPhraseSha256, authorityRoot: root, receipt });
}

export async function loadConfirmationPhraseIssuanceV1({ repositoryRoot, issuancePath, sourceCommit, testOnly = false, testAuthorityRoot } = {}) {
  const root = authorityRoot({ repositoryRoot, testOnly, testAuthorityRoot });
  if (!path.isAbsolute(String(issuancePath ?? "")) || !COMMIT.test(String(sourceCommit ?? ""))) fail("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_ISSUANCE_INVALID");
  const expectedPrefix = path.join(root, "issuances") + path.sep;
  const resolved = path.resolve(issuancePath);
  if (!resolved.startsWith(expectedPrefix)) fail("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_ISSUANCE_ROOT_INVALID");
  let bytes; try { bytes = await readFile(resolved); } catch { fail("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_ISSUANCE_MISSING"); }
  let value; try { value = JSON.parse(bytes.toString("utf8")); } catch { fail("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_ISSUANCE_INVALID"); }
  const keys = ["schemaVersion", "sourceCommit", "confirmationPhraseSha256", "issuanceId", "issuedAtUtc", "formatVersion"];
  exactKeys(value, keys, "R6_PRODUCTION_RECONCILIATION_CONFIRMATION_ISSUANCE_INVALID");
  if (value.schemaVersion !== CONFIRMATION_PHRASE_ISSUANCE_V1 || value.sourceCommit !== sourceCommit || !HASH.test(String(value.confirmationPhraseSha256)) || !UUID.test(String(value.issuanceId)) || Number.isNaN(Date.parse(String(value.issuedAtUtc))) || value.formatVersion !== "V5" || path.basename(resolved) !== `${value.confirmationPhraseSha256}.json`) fail("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_ISSUANCE_INVALID");
  return Object.freeze({ authorityRoot: root, path: resolved, sha256: hash(bytes), value: Object.freeze({ ...value }) });
}

export async function bindConfirmationPhraseToCandidateV1({ repositoryRoot, issuance, candidate, testOnly = false, testAuthorityRoot, now = new Date().toISOString() } = {}) {
  const root = authorityRoot({ repositoryRoot, testOnly, testAuthorityRoot });
  if (!issuance || issuance.authorityRoot !== root || !candidate || !UUID.test(String(candidate.authorizationId)) || candidate.transportImplementationCommit !== issuance.value.sourceCommit || !UUID.test(String(candidate.packageId)) || Number.isNaN(Date.parse(String(now)))) fail("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_BINDING_INVALID");
  const value = { schemaVersion: CONFIRMATION_PHRASE_BINDING_V1, confirmationPhraseSha256: issuance.value.confirmationPhraseSha256, confirmationIssuancePath: issuance.path, confirmationIssuanceSha256: issuance.sha256, candidateId: candidate.authorizationId, sourceCommit: candidate.transportImplementationCommit, packageId: candidate.packageId, boundAtUtc: now };
  return writeExclusiveJson(path.join(root, "candidate-bindings", `${value.confirmationPhraseSha256}.json`), value, "R6_PRODUCTION_RECONCILIATION_CONFIRMATION_PHRASE_CROSS_CANDIDATE_REUSE_REJECTED");
}
