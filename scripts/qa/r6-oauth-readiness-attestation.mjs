import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";

export const OAUTH_READINESS_ATTESTATION_SCHEMA = "r6-current-canonical-production-v3-oauth-readiness-attestation-v1";
export const OAUTH_READINESS_OPERATION = "VALIDATE_CURRENT_CANONICAL_PRODUCTION_V3_OAUTH_PROFILE";
export const OAUTH_READINESS_CLASSIFICATION = "R6_CURRENT_CANONICAL_PRODUCTION_V3_OAUTH_PREFLIGHT_READY";
export const OAUTH_READINESS_VALIDITY_SECONDS = 900;
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const exact = (value, keys, code) => { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) fail(code); };
const utc = (value, code) => { if (!UTC.test(String(value)) || new Date(value).toISOString() !== value) fail(code); return value; };
const text = (value, code) => { if (typeof value !== "string" || value.length === 0) fail(code); return value; };
const digest = (value, code) => { if (!HASH.test(String(value))) fail(code); return value; };
const containedPath = (root, candidate, code) => {
  const base = path.resolve(text(root, code));
  const target = path.resolve(text(candidate, code));
  const relative = path.relative(base, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) fail(code);
  return { base, target };
};

async function assertOwnedRegularFile(attestationPath, attestationRoot, code) {
  if (!attestationRoot) return path.resolve(text(attestationPath, code));
  const { base, target } = containedPath(attestationRoot, attestationPath, code);
  const [realBase, realTarget, stats] = await Promise.all([realpath(base), realpath(target), lstat(target)]);
  const relative = path.relative(realBase, realTarget);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative) || stats.isSymbolicLink() || !stats.isFile()) fail(code);
  return target;
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  return value;
}
export const canonicalJson = (value) => `${JSON.stringify(sorted(value))}\n`;
export const canonicalSha256 = (value) => hash(Buffer.from(canonicalJson(value), "utf8"));
export const sha256 = hash;

export function createOAuthReadinessAttestation({ profile, executionCommit, branch, wrapperSha256, wranglerVersion, wranglerEntrySha256, atomicSessionId, parentPowerShellPid, parentPowerShellStartTime, handoffNonce, now = () => new Date() } = {}) {
  if (!profile || typeof profile.profilePath !== "string" || typeof profile.token !== "string" || profile.token.length === 0 || profile.hasRefreshCapability !== true) fail("R6_OAUTH_READINESS_ATTESTATION_PROFILE_INVALID");
  if (!COMMIT.test(String(executionCommit)) || !UUID.test(String(atomicSessionId)) || !Number.isInteger(parentPowerShellPid) || parentPowerShellPid <= 0) fail("R6_OAUTH_READINESS_ATTESTATION_BINDING_INVALID");
  const issuedAt = utc(now().toISOString(), "R6_OAUTH_READINESS_ATTESTATION_TIME_INVALID");
  const value = {
    schemaVersion: OAUTH_READINESS_ATTESTATION_SCHEMA,
    attestationId: randomUUID(),
    operation: OAUTH_READINESS_OPERATION,
    classification: OAUTH_READINESS_CLASSIFICATION,
    issuedAt,
    validitySeconds: OAUTH_READINESS_VALIDITY_SECONDS,
    executionCommit,
    branch: text(branch, "R6_OAUTH_READINESS_ATTESTATION_BINDING_INVALID"),
    wrapperSha256: digest(wrapperSha256, "R6_OAUTH_READINESS_ATTESTATION_BINDING_INVALID"),
    wranglerVersion: text(wranglerVersion, "R6_OAUTH_READINESS_ATTESTATION_BINDING_INVALID"),
    wranglerEntrySha256: digest(wranglerEntrySha256, "R6_OAUTH_READINESS_ATTESTATION_BINDING_INVALID"),
    profilePathHash: hash(path.resolve(profile.profilePath)),
    profileFileSha256: digest(profile.profileFileSha256, "R6_OAUTH_READINESS_ATTESTATION_PROFILE_INVALID"),
    credentialEntryPresent: true,
    credentialFreshnessClass: "R6_OAUTH_PROFILE_READY_OFFLINE",
    scopeState: "WRANGLER_PROFILE_SCOPE_NOT_DECLARED",
    atomicSessionId,
    parentPowerShellPid,
    parentPowerShellStartTime: utc(parentPowerShellStartTime, "R6_OAUTH_READINESS_ATTESTATION_BINDING_INVALID"),
    handoffNonceSha256: digest(hash(Buffer.from(handoffNonce ?? "", "utf8")), "R6_OAUTH_READINESS_ATTESTATION_BINDING_INVALID"),
  };
  validateOAuthReadinessAttestation(value);
  return Object.freeze(value);
}

export function validateOAuthReadinessAttestation(value) {
  const keys = ["schemaVersion","attestationId","operation","classification","issuedAt","validitySeconds","executionCommit","branch","wrapperSha256","wranglerVersion","wranglerEntrySha256","profilePathHash","profileFileSha256","credentialEntryPresent","credentialFreshnessClass","scopeState","atomicSessionId","parentPowerShellPid","parentPowerShellStartTime","handoffNonceSha256"];
  exact(value, keys, "R6_OAUTH_READINESS_ATTESTATION_INVALID");
  if (value.schemaVersion !== OAUTH_READINESS_ATTESTATION_SCHEMA || !UUID.test(value.attestationId) || value.operation !== OAUTH_READINESS_OPERATION || value.classification !== OAUTH_READINESS_CLASSIFICATION || value.validitySeconds !== OAUTH_READINESS_VALIDITY_SECONDS || !COMMIT.test(value.executionCommit) || !UUID.test(value.atomicSessionId) || !Number.isInteger(value.parentPowerShellPid) || value.parentPowerShellPid <= 0 || value.credentialEntryPresent !== true || value.credentialFreshnessClass !== "R6_OAUTH_PROFILE_READY_OFFLINE" || value.scopeState !== "WRANGLER_PROFILE_SCOPE_NOT_DECLARED") fail("R6_OAUTH_READINESS_ATTESTATION_INVALID");
  for (const key of ["wrapperSha256","wranglerEntrySha256","profilePathHash","profileFileSha256","handoffNonceSha256"]) digest(value[key], "R6_OAUTH_READINESS_ATTESTATION_INVALID");
  utc(value.issuedAt, "R6_OAUTH_READINESS_ATTESTATION_INVALID"); utc(value.parentPowerShellStartTime, "R6_OAUTH_READINESS_ATTESTATION_INVALID");
  return Object.freeze({ ...value });
}

export async function writeOAuthReadinessAttestation({ attestation, attestationPath, attestationRoot } = {}) {
  const value = validateOAuthReadinessAttestation(attestation);
  const target = path.resolve(text(attestationPath, "R6_OAUTH_READINESS_ATTESTATION_PATH_INVALID"));
  if (attestationRoot) {
    const { base } = containedPath(attestationRoot, target, "R6_OAUTH_READINESS_ATTESTATION_PATH_INVALID");
    if (path.resolve(base) !== path.resolve(path.dirname(target))) fail("R6_OAUTH_READINESS_ATTESTATION_PATH_INVALID");
    await realpath(base);
  }
  const raw = Buffer.from(canonicalJson(value), "utf8");
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try { const handle = await open(temporary, "wx", 0o600); try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); } await rename(temporary, target); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
  return Object.freeze({ attestationPath: target, attestationSha256: hash(raw), attestationSchema: value.schemaVersion, attestationId: value.attestationId, atomicSessionId: value.atomicSessionId, handoffNonceSha256: value.handoffNonceSha256 });
}

export async function readOAuthReadinessAttestation({ attestationPath, attestationRoot, expectedAttestationSha256, atomicSessionId, parentPowerShellPid, parentPowerShellStartTime, handoffNonce, now = () => new Date(), atomic = false } = {}) {
  let target;
  try { target = await assertOwnedRegularFile(attestationPath, attestationRoot, "R6_DRYRUN_OAUTH_ATTESTATION_PATH_INVALID"); }
  catch (error) { if (error?.code === "ENOENT") fail("R6_DRYRUN_OAUTH_ATTESTATION_INVALID"); throw error; }
  let raw;
  try { raw = await readFile(target); }
  catch { fail("R6_DRYRUN_OAUTH_ATTESTATION_INVALID"); }
  const actual = hash(raw);
  if (!HASH.test(String(expectedAttestationSha256)) || !timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expectedAttestationSha256, "hex"))) fail("R6_DRYRUN_OAUTH_ATTESTATION_SHA_INVALID");
  let value; try { value = JSON.parse(raw.toString("utf8")); } catch { fail("R6_DRYRUN_OAUTH_ATTESTATION_INVALID"); }
  if (raw.toString("utf8") !== canonicalJson(value)) fail("R6_DRYRUN_OAUTH_ATTESTATION_CANONICAL_INVALID");
  const attestation = validateOAuthReadinessAttestation(value);
  if (attestation.atomicSessionId !== atomicSessionId || attestation.parentPowerShellPid !== parentPowerShellPid || attestation.parentPowerShellStartTime !== parentPowerShellStartTime || hash(Buffer.from(handoffNonce ?? "", "utf8")) !== attestation.handoffNonceSha256) fail("R6_DRYRUN_OAUTH_ATTESTATION_HANDOFF_INVALID");
  const issuerStartedAt = utc(now().toISOString(), "R6_DRYRUN_OAUTH_ATTESTATION_INVALID"); const ageSeconds = Math.floor((Date.parse(issuerStartedAt) - Date.parse(attestation.issuedAt)) / 1000); const remainingSeconds = attestation.validitySeconds - ageSeconds;
  const maximumAgeSeconds = atomic ? 60 : 180; const minimumRemainingSeconds = atomic ? 840 : 720;
  if (ageSeconds < 0 || ageSeconds > maximumAgeSeconds || remainingSeconds < minimumRemainingSeconds) fail("R6_DRYRUN_OAUTH_ATTESTATION_FRESHNESS_INVALID");
  return Object.freeze({ attestation, attestationPath: target, attestationSha256: actual, raw, actualSha256: actual, issuerStartedAt, ageSeconds, remainingSeconds });
}
