import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prepareCurrentCanonicalProductionV3Metadata } from "./prepare-cloudflare-pages-current-canonical-production-v3-get.mjs";
import { PAGES_PROJECT_R2_SOURCE_CONTRACT_HASHES as PAGES_CURRENT_CANONICAL_PRODUCTION_V3_SOURCE_CONTRACT_HASHES } from "./cloudflare-pages-project-v3-get.mjs";
import { allocateProjectUnreservedDryRunId, createProjectPhaseState, createProjectSingleRequestSentinel, markProjectPhase } from "./run-cloudflare-pages-project-metadata-preparation.mjs";
import { validateDeploymentAttestation } from "./production-deployment-attestation.mjs";
import { assertOfflineOAuthProfileReady, validateOfflineWranglerOAuthProfile } from "./cloudflare-pages-oauth-profile-readiness.mjs";
import { resolvePagesAccountId } from "./cloudflare-pages-account-resolver.mjs";
import { readHiddenCloudflareAccountId } from "./run-cloudflare-pages-metadata-preparation.mjs";

export const R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_OPERATION = "PREPARE_CURRENT_CANONICAL_PRODUCTION_V3_AUTH_DRY_RUN_ATTESTATION";
export const R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_VERSION = "r6-pages-current-canonical-production-v3-metadata-terminal-result-v3";
export const R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_SUCCESS = "R6_HARDENED_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_CAPTURE_HUMAN_COMMAND_READY";
export const R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ENTRYPOINT_LOAD_ONLY = "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_METADATA_ENTRYPOINT_LOAD_ONLY_OK";
const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
export const R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ATTESTATION_TTL_MS = 15 * 60 * 1000;
export const R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_MINIMUM_COMMAND_VALIDITY_MS = 13 * 60 * 1000;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code, innerCode = null) => { const error = new Error(code); error.code = code; error.innerCode = innerCode; throw error; };
const inside = (root, candidate) => { const relative = path.relative(path.resolve(root), path.resolve(candidate)); return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative); };
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

function terminalDigest(value) { const copy = { ...value, resultSha256: null }; return hash(JSON.stringify(copy)); }
function exactUtcMilliseconds(value) {
  const text = String(value ?? ""); const milliseconds = Date.parse(text);
  if (!UTC_TIMESTAMP.test(text) || !Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== text) fail("R6_CURRENT_CANONICAL_PRODUCTION_V3_ATTESTATION_TIME_INVALID");
  return milliseconds;
}
export function assessCurrentCanonicalProductionV3AttestationFreshness({ issuedAt, expiresAt, validationNow, minimumValidityMilliseconds = R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_MINIMUM_COMMAND_VALIDITY_MS } = {}) {
  const issuedAtMilliseconds = exactUtcMilliseconds(issuedAt); const expiresAtMilliseconds = exactUtcMilliseconds(expiresAt);
  if (!Number.isSafeInteger(validationNow) || !Number.isInteger(minimumValidityMilliseconds) || minimumValidityMilliseconds <= 0 || expiresAtMilliseconds <= issuedAtMilliseconds || expiresAtMilliseconds - issuedAtMilliseconds !== R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ATTESTATION_TTL_MS) fail("R6_CURRENT_CANONICAL_PRODUCTION_V3_ATTESTATION_TIME_INVALID");
  const remainingValidityMilliseconds = expiresAtMilliseconds - validationNow;
  return Object.freeze({ attestationIssuedAt: issuedAt, attestationExpiresAt: expiresAt, freshnessValidatedAt: new Date(validationNow).toISOString(), remainingValidityMilliseconds, minimumValidityMilliseconds, freshnessCheckPassed: remainingValidityMilliseconds >= minimumValidityMilliseconds });
}
function assertTerminalFreshness(value, { required = false } = {}) {
  const fields = [value.attestationIssuedAt, value.attestationExpiresAt, value.freshnessValidatedAt, value.remainingValidityMilliseconds, value.minimumValidityMilliseconds];
  const hasAny = fields.some((field) => field !== null && field !== undefined);
  if (!hasAny) {
    if (required || value.freshnessCheckPassed !== false) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
    return;
  }
  if (fields.some((field) => field === null || field === undefined) || typeof value.freshnessCheckPassed !== "boolean") fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
  const assessed = assessCurrentCanonicalProductionV3AttestationFreshness({ issuedAt: value.attestationIssuedAt, expiresAt: value.attestationExpiresAt, validationNow: exactUtcMilliseconds(value.freshnessValidatedAt), minimumValidityMilliseconds: value.minimumValidityMilliseconds });
  if (assessed.remainingValidityMilliseconds !== value.remainingValidityMilliseconds || assessed.freshnessCheckPassed !== value.freshnessCheckPassed) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
}
export function createCurrentCanonicalProductionV3TerminalResult({ resultPath, toolingCommit, outerClassification, innerClassification = null, childExitCode, promptReached = false, requestSentinelReached = false, transportReached = false, attestationCreated = false, attestationPath = null, attestationSha256 = null, validateOnlyCompleted = false, commands = [], attestationIssuedAt = null, attestationExpiresAt = null, freshnessValidatedAt = null, remainingValidityMilliseconds = null, minimumValidityMilliseconds = null, freshnessCheckPassed = false }) {
  if (!resultPath || !COMMIT.test(String(toolingCommit)) || !Number.isInteger(childExitCode) || !Array.isArray(commands)) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
  const created = Boolean(attestationCreated);
  if (created !== (typeof attestationPath === "string" && SHA256.test(String(attestationSha256)))) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
  const result = { schemaVersion: R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_VERSION, toolingCommit, outerClassification, innerClassification, childExitCode, promptReached: Boolean(promptReached), requestSentinelReached: Boolean(requestSentinelReached), transportReached: Boolean(transportReached), attestationCreated: created, attestationPath: created ? attestationPath : null, attestationSha256: created ? attestationSha256 : null, validateOnlyCompleted: Boolean(validateOnlyCompleted), attestationIssuedAt, attestationExpiresAt, freshnessValidatedAt, remainingValidityMilliseconds, minimumValidityMilliseconds, freshnessCheckPassed: Boolean(freshnessCheckPassed), commandsEmittedCount: commands.length, commands, sanitizedEvidencePath: resultPath, sanitizedEvidenceDigest: hash(path.resolve(resultPath)), resultSha256: null };
  if (!created && (attestationIssuedAt !== null || attestationExpiresAt !== null || freshnessValidatedAt !== null || remainingValidityMilliseconds !== null || minimumValidityMilliseconds !== null || freshnessCheckPassed)) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
  assertTerminalFreshness(result, { required: outerClassification === R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_SUCCESS });
  result.resultSha256 = terminalDigest(result); return result;
}
export async function writeCurrentCanonicalProductionV3TerminalResult(value, resultPath) {
  if (value?.resultSha256 !== terminalDigest(value) || path.resolve(value.sanitizedEvidencePath ?? "") !== path.resolve(resultPath)) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
  await mkdir(path.dirname(resultPath), { recursive: true });
  try { await stat(resultPath); fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE"); } catch (error) { if (error?.code && error.code !== "ENOENT") throw error; }
  const raw = Buffer.from(`${JSON.stringify(value)}\n`); const temporary = `${resultPath}.${process.pid}.${randomUUID()}.tmp`;
  try { const handle = await open(temporary, "wx", 0o600); try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); } await rename(temporary, resultPath); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
  return Object.freeze({ path: resultPath, sha256: hash(raw), byteLength: raw.length });
}
export function validateCurrentCanonicalProductionV3TerminalResult(value, { resultPath, toolingCommit } = {}) {
  const phases = ["promptReached", "requestSentinelReached", "transportReached", "attestationCreated", "validateOnlyCompleted"];
  if (!value || value.schemaVersion !== R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_VERSION || value.toolingCommit !== toolingCommit || path.resolve(value.sanitizedEvidencePath ?? "") !== path.resolve(resultPath ?? "") || value.sanitizedEvidenceDigest !== hash(path.resolve(resultPath ?? "")) || value.resultSha256 !== terminalDigest(value) || !Number.isInteger(value.childExitCode) || !Array.isArray(value.commands) || value.commands.length !== value.commandsEmittedCount || !phases.every((key) => typeof value[key] === "boolean")) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
  if (value.attestationCreated !== (typeof value.attestationPath === "string" && SHA256.test(String(value.attestationSha256)))) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
  if (value.outerClassification === R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_SUCCESS) {
    if (value.childExitCode !== 0 || value.innerClassification !== null || !phases.every((key) => value[key]) || value.commands.length !== 2 || value.freshnessCheckPassed !== true) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
    assertTerminalFreshness(value, { required: true });
    return Object.freeze({ kind: "success", classification: value.outerClassification });
  }
  const known = new Set(["R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_OAUTH_NOT_READY", "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ACCOUNT_INPUT_FAILED", "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TARGET_MISMATCH", "R6_CURRENT_CANONICAL_PRODUCTION_SOURCE_COMMIT_MISMATCH", "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TRANSPORT_FAILED", "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ATTESTATION_SCHEMA_UNSAFE", "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_VALIDATE_ONLY_FAILED", "R6_CURRENT_CANONICAL_PRODUCTION_V3_ATTESTATION_VALIDITY_INSUFFICIENT", "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_COMMAND_PREPARATION_FAILED"]);
  if (!known.has(value.outerClassification) || value.childExitCode !== 1 || value.commands.length !== 0) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
  if (value.outerClassification === "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_OAUTH_NOT_READY" && (value.promptReached || value.requestSentinelReached || value.transportReached)) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
  if (value.outerClassification === "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ACCOUNT_INPUT_FAILED" && (!value.promptReached || value.requestSentinelReached || value.transportReached)) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
  if (["R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TARGET_MISMATCH", "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TRANSPORT_FAILED", "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ATTESTATION_SCHEMA_UNSAFE"].includes(value.outerClassification) && (!value.requestSentinelReached || !value.transportReached || value.attestationCreated || value.validateOnlyCompleted)) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
  if (value.outerClassification === "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_VALIDATE_ONLY_FAILED" && (!value.attestationCreated || value.validateOnlyCompleted)) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
  if (value.outerClassification === "R6_CURRENT_CANONICAL_PRODUCTION_V3_ATTESTATION_VALIDITY_INSUFFICIENT" && (!value.attestationCreated || !value.validateOnlyCompleted || value.freshnessCheckPassed)) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
  assertTerminalFreshness(value);
  return Object.freeze({ kind: "failure", classification: value.outerClassification });
}

async function atomicSeal({ attestationRoot, selection, accountSource, toolingCommit, wrapperSha256, transportSha256, parserSelectorSha256, endpointSha256, now = () => new Date() }) {
  if (!COMMIT.test(String(toolingCommit)) || ![wrapperSha256, transportSha256, parserSelectorSha256, endpointSha256, accountSource?.accountIdSha256, selection?.rawResponseSha256].every((value) => SHA256.test(String(value)))) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ATTESTATION_SCHEMA_UNSAFE");
  const observedAt = now().toISOString(); const expiresAt = new Date(Date.parse(observedAt) + R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ATTESTATION_TTL_MS).toISOString();
  const document = {
    schemaVersion: "r6-production-deployment-attestation-v1", evidenceType: "CLOUDFLARE_PAGES_PROJECT_GET_V3", provider: "cloudflare-pages", classification: "PRODUCTION_DEPLOYMENT_IDENTITY_EXACT",
    projectName: selection.projectName, projectId: selection.projectId, projectSubdomain: selection.projectSubdomain, productionBranch: selection.productionBranch,
    deploymentId: selection.deploymentId, canonicalDeploymentProjectId: selection.canonicalDeploymentProjectId, canonicalDeploymentProjectName: selection.canonicalDeploymentProjectName,
    environment: selection.environment, canonicalBaseUrl: "https://openglasshub.pages.dev", immutableDeploymentUrl: selection.immutableDeploymentUrl, immutableDeploymentUrlNormalizationVersion: selection.immutableDeploymentUrlNormalizationVersion,
    aliasesObservedType: selection.aliasesObservedType, ...(selection.canonicalAlias ? { canonicalAlias: selection.canonicalAlias } : {}), canonicalTargetProofMode: selection.canonicalTargetProofMode,
    triggerBranch: selection.triggerBranch, sourceCommit: selection.sourceCommit, isSkipped: selection.isSkipped, latestStageName: selection.latestStageName, latestStageStatus: selection.latestStageStatus,
    queryOrProviderEvidenceSha256: selection.rawResponseSha256, sanitizedMetadataSha256: hash(JSON.stringify(selection)), projectSourceContractSha256s: selection.sourceContractSha256s,
    targetIdentityHash: hash("cloudflare-pages|openglasshub|production|https://openglasshub.pages.dev"), toolingCommit, wrapperSha256, wrapperVersion: "r6-consumed-run-wrapper-v1", transportSha256, parserSelectorSha256, endpointSha256, accountIdSha256: accountSource.accountIdSha256, observedAt, expiresAt,
  };
  const directory = path.join(path.resolve(attestationRoot), `r6-current-canonical-production-v3-auth-dry-${randomUUID()}`); const file = path.join(directory, "production-deployment-attestation.json");
  if (!inside(attestationRoot, file)) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ATTESTATION_SCHEMA_UNSAFE");
  const raw = Buffer.from(`${JSON.stringify(document, null, 2)}\n`); const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try { await mkdir(directory, { recursive: false }); const handle = await open(temporary, "wx", 0o600); try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); } await rename(temporary, file); }
  catch { await rm(temporary, { force: true }); await rm(directory, { recursive: true, force: true }); fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ATTESTATION_SCHEMA_UNSAFE"); }
  return Object.freeze({ path: file, sha256: hash(raw), observedAt, expiresAt, document });
}
export function emitCurrentCanonicalProductionV3Commands({ wrapperPath, executionWorktree, attestation, dryRunId, evidenceRoot }) {
  const base = `& ${quote(wrapperPath)} -ExecutionWorktree ${quote(executionWorktree)} -DeploymentAttestationPath ${quote(attestation.path)} -DeploymentAttestationSha256 ${attestation.sha256}`;
  return Object.freeze({ authCheckOnly: `${base} -AuthCheckOnly -EvidenceRoot ${quote(path.join(evidenceRoot, "auth-check"))}`, dryRunOnly: `${base} -DryRunOnly -RunId ${dryRunId} -EvidenceRoot ${quote(path.join(evidenceRoot, "dry-run"))}` });
}
function mapTransport(error) { if (error?.code === "R6_CURRENT_CANONICAL_PRODUCTION_SOURCE_COMMIT_MISMATCH") return error.code; return error?.code?.includes("TARGET") || error?.code?.includes("REQUIRED_FIELD") || error?.code?.includes("CONFLICT") || error?.code?.includes("SUBDOMAIN") ? "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TARGET_MISMATCH" : "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TRANSPORT_FAILED"; }
export async function prepareCurrentCanonicalProductionV3AuthDryRunAttestation(options) {
  const { assertOAuthReady = () => undefined, requestSentinel = createProjectSingleRequestSentinel(), validateOnly, clock = () => new Date(), onRequestSentinel = () => undefined, onTransportStart = () => undefined, onAttestationCreated = () => undefined, onValidateOnlyCompleted = () => undefined, onAttestationFreshness = () => undefined } = options;
  if (typeof validateOnly !== "function") fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_VALIDATE_ONLY_FAILED");
  try { assertOAuthReady(); } catch (error) { fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_OAUTH_NOT_READY", error?.code ?? null); }
  requestSentinel(); onRequestSentinel(); let metadata;
  try { metadata = await prepareCurrentCanonicalProductionV3Metadata({ ...options, accountId: options.resolvedAccount.accountId, onTransportStart }); } catch (error) { fail(mapTransport(error), error?.diagnosticReference ?? error?.code ?? null); }
  const attestation = await atomicSeal({ attestationRoot: options.attestationRoot, selection: metadata.selection, accountSource: metadata.request, toolingCommit: options.toolingCommit, wrapperSha256: options.wrapperSha256, transportSha256: options.transportSha256, parserSelectorSha256: options.parserSelectorSha256, endpointSha256: metadata.request.endpointSha256, now: clock }); onAttestationCreated({ path: attestation.path, sha256: attestation.sha256, observedAt: attestation.observedAt, expiresAt: attestation.expiresAt });
  try { await validateOnly({ attestationPath: attestation.path, attestationSha256: attestation.sha256 }); onValidateOnlyCompleted(); } catch { fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_VALIDATE_ONLY_FAILED"); }
  const dryRunId = await allocateProjectUnreservedDryRunId({ registryRoot: options.registryRoot, journalRoot: options.journalRoot, evidenceRoot: options.evidenceRoot, randomUuid: options.randomUuid, exists: options.exists });
  const freshness = assessCurrentCanonicalProductionV3AttestationFreshness({ issuedAt: attestation.observedAt, expiresAt: attestation.expiresAt, validationNow: clock().getTime() }); onAttestationFreshness(freshness);
  if (!freshness.freshnessCheckPassed) fail("R6_CURRENT_CANONICAL_PRODUCTION_V3_ATTESTATION_VALIDITY_INSUFFICIENT");
  return Object.freeze({ classification: "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_METADATA_PREPARATION_OK", metadata, attestation, freshness, dryRunId, commands: emitCurrentCanonicalProductionV3Commands({ wrapperPath: options.wrapperPath, executionWorktree: options.executionWorktree, attestation, dryRunId, evidenceRoot: options.evidenceRoot }) });
}
function requiredFlag(values, name) { const value = values.get(name); if (!value) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_COMMAND_PREPARATION_FAILED"); return value; }
function parseFlags(argv) { const values = new Map(); const allowed = new Set(["--operation", "--repository-root", "--attestation-root", "--registry-root", "--journal-root", "--evidence-root", "--wrapper-path", "--execution-worktree", "--tooling-commit", "--wrapper-sha256", "--transport-sha256", "--parser-selector-sha256", "--terminal-result-path"]); for (let i = 0; i < argv.length; i += 2) { if (!argv[i]?.startsWith("--") || values.has(argv[i]) || i + 1 >= argv.length || !allowed.has(argv[i])) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_COMMAND_PREPARATION_FAILED"); values.set(argv[i], argv[i + 1]); } if (requiredFlag(values, "--operation") !== R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_OPERATION) fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_COMMAND_PREPARATION_FAILED"); return values; }
export async function runCurrentCanonicalProductionV3MetadataPreparationCli(argv = process.argv.slice(2), { oauthProfileValidator = validateOfflineWranglerOAuthProfile, accountResolver = resolvePagesAccountId, secureInput = readHiddenCloudflareAccountId, prepare = prepareCurrentCanonicalProductionV3AuthDryRunAttestation, phaseState = createProjectPhaseState() } = {}) {
  const values = parseFlags(argv); const state = phaseState; let auth = null; let account = null; const evidenceRoot = requiredFlag(values, "--evidence-root"); const terminalResultPath = requiredFlag(values, "--terminal-result-path");
  if (!inside(evidenceRoot, terminalResultPath) || path.basename(terminalResultPath) !== "current-canonical-production-v3-metadata-preparation-terminal-result.json") fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE");
  try { try { auth = await oauthProfileValidator(); assertOfflineOAuthProfileReady(auth); } catch (error) { fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_OAUTH_NOT_READY", error?.code ?? null); }
    try { account = await accountResolver({ repositoryRoot: requiredFlag(values, "--repository-root"), requestHiddenInput: async () => { markProjectPhase(state, "promptReached"); return secureInput(); } }); } catch (error) { fail("R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ACCOUNT_INPUT_FAILED", error?.code ?? null); }
    const toolingCommit = requiredFlag(values, "--tooling-commit"); return await prepare({ resolvedAccount: account, auth, attestationRoot: requiredFlag(values, "--attestation-root"), registryRoot: requiredFlag(values, "--registry-root"), journalRoot: requiredFlag(values, "--journal-root"), evidenceRoot, wrapperPath: requiredFlag(values, "--wrapper-path"), executionWorktree: requiredFlag(values, "--execution-worktree"), toolingCommit, wrapperSha256: requiredFlag(values, "--wrapper-sha256"), transportSha256: requiredFlag(values, "--transport-sha256"), parserSelectorSha256: requiredFlag(values, "--parser-selector-sha256"), onRequestSentinel: () => markProjectPhase(state, "requestSentinelReached"), onTransportStart: () => markProjectPhase(state, "transportReached"), onAttestationCreated: ({ path: attestationPath, sha256: attestationSha256, observedAt, expiresAt }) => { markProjectPhase(state, "attestationCreated"); state.attestationPath = attestationPath; state.attestationSha256 = attestationSha256; state.attestationIssuedAt = observedAt; state.attestationExpiresAt = expiresAt; }, onValidateOnlyCompleted: () => markProjectPhase(state, "validateOnlyCompleted"), onAttestationFreshness: (freshness) => Object.assign(state, freshness), validateOnly: ({ attestationPath, attestationSha256 }) => validateDeploymentAttestation({ attestationPath, expectedSha256: attestationSha256, expectedCommit: "b9ec4a06fb4aa67d7963c5d53ccc91e5c3965ed6", expectedToolingCommit: toolingCommit, root: requiredFlag(values, "--attestation-root") }) });
  } finally { if (auth) auth.token = null; if (account) account.accountId = null; }
}
export function isCurrentCanonicalProductionV3MetadataEntrypoint(argvPath, moduleUrl = import.meta.url) { return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href; }
if (isCurrentCanonicalProductionV3MetadataEntrypoint(process.argv[1])) { let values; let resultPath = null; let toolingCommit = "0000000000000000000000000000000000000000"; const state = createProjectPhaseState(); try { values = parseFlags(process.argv.slice(2)); resultPath = requiredFlag(values, "--terminal-result-path"); toolingCommit = requiredFlag(values, "--tooling-commit"); const result = await runCurrentCanonicalProductionV3MetadataPreparationCli(process.argv.slice(2), { phaseState: state }); await writeCurrentCanonicalProductionV3TerminalResult(createCurrentCanonicalProductionV3TerminalResult({ resultPath, toolingCommit, outerClassification: R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_SUCCESS, childExitCode: 0, ...state, ...result.freshness, attestationPath: result.attestation.path, attestationSha256: result.attestation.sha256, commands: [result.commands.authCheckOnly, result.commands.dryRunOnly] }), resultPath); process.stdout.write(`${R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_SUCCESS}\n${result.commands.authCheckOnly}\n${result.commands.dryRunOnly}\n`); } catch (error) { const code = error?.code ?? "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_CONTRACT_UNSAFE"; if (resultPath && COMMIT.test(toolingCommit)) { try { await writeCurrentCanonicalProductionV3TerminalResult(createCurrentCanonicalProductionV3TerminalResult({ resultPath, toolingCommit, outerClassification: code, innerClassification: error?.innerCode ?? null, childExitCode: 1, ...state, commands: [] }), resultPath); } catch {} } process.stderr.write(`${code}\n`); process.exitCode = 1; } }

export { PAGES_CURRENT_CANONICAL_PRODUCTION_V3_SOURCE_CONTRACT_HASHES };
