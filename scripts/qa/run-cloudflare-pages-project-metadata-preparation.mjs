import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prepareFixedPagesProjectMetadata } from "./prepare-cloudflare-pages-project-get.mjs";
import { PAGES_PROJECT_GET_SOURCE_CONTRACT_SHA256 } from "./cloudflare-pages-project-get.mjs";
import { assertRunIdNotConsumed, validateConsumedRunId } from "./production-minimal-canary-consumed-run-registry.mjs";
import { validateDeploymentAttestation } from "./production-deployment-attestation.mjs";
import { assertOfflineOAuthProfileReady, OAuthProfileReadinessError, validateOfflineWranglerOAuthProfile } from "./cloudflare-pages-oauth-profile-readiness.mjs";
import { resolvePagesAccountId } from "./cloudflare-pages-account-resolver.mjs";
import { readHiddenCloudflareAccountId } from "./run-cloudflare-pages-metadata-preparation.mjs";

export const R6_PAGES_PROJECT_METADATA_PREPARATION_OPERATION = "PREPARE_PROJECT_AUTH_DRY_RUN_ATTESTATION";
export const R6_PAGES_PROJECT_METADATA_TERMINAL_RESULT_VERSION = "r6-pages-project-metadata-terminal-result-v1";
export const R6_PAGES_PROJECT_METADATA_SUCCESS = "R6_HARDENED_AUTH_AND_DRY_RUN_ATTESTATION_READY_FOR_HUMAN_EXECUTION";
export const R6_PAGES_PROJECT_METADATA_ENTRYPOINT_LOAD_ONLY = "R6_PAGES_PROJECT_METADATA_ENTRYPOINT_LOAD_ONLY_OK";
export const R6_PAGES_PROJECT_METADATA_LOCAL_ONLY = "R6_PAGES_PROJECT_LOCAL_VALIDATION_FAILED";
const EXPECTED_DEPLOYMENT_ID = "6f11bcf1-65a7-4e9c-aa25-30ec1fd7fb8a";
const EXPECTED_SOURCE_COMMIT = "b9ec4a06fb4aa67d7963c5d53ccc91e5c3965ed6";
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const MAX_WINDOW_MS = 15 * 60 * 1000;
const MINIMUM_REMAINING_MS = 13 * 60 * 1000;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code, innerCode = null) => { const error = new Error(code); error.code = code; error.innerCode = innerCode; throw error; };
const inside = (root, candidate) => { const relative = path.relative(path.resolve(root), path.resolve(candidate)); return !relative.startsWith("..") && !path.isAbsolute(relative); };
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const PROJECT_PHASES = Object.freeze(["promptReached", "requestSentinelReached", "transportReached", "attestationCreated", "validateOnlyCompleted"]);

/** A single mutable state object records only monotonic workflow milestones. */
export function createProjectPhaseState() {
  return { promptReached: false, requestSentinelReached: false, transportReached: false, attestationCreated: false, validateOnlyCompleted: false };
}

export function markProjectPhase(state, phase) {
  if (!state || !PROJECT_PHASES.includes(phase)) fail("R6_PAGES_PROJECT_TERMINAL_RESULT_FAILED");
  if ((phase === "transportReached" && !state.requestSentinelReached) || (phase === "attestationCreated" && !state.transportReached) || (phase === "validateOnlyCompleted" && !state.attestationCreated)) fail("R6_PAGES_PROJECT_TERMINAL_RESULT_FAILED");
  state[phase] = true;
  return state;
}

export function createProjectSingleRequestSentinel() { let used = false; return () => { if (used) fail("R6_PAGES_PROJECT_TRANSPORT_FAILED"); used = true; }; }

export async function allocateProjectUnreservedDryRunId({ registryRoot, journalRoot, evidenceRoot, randomUuid = randomUUID, exists = async (candidate) => stat(candidate).then(() => true).catch(() => false) }) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const runId = validateConsumedRunId(`qa-canary-${randomUuid()}`);
    try { await assertRunIdNotConsumed({ root: registryRoot, runId }); }
    catch (error) { if (error?.message === "QA_CANARY_RUN_ID_ALREADY_CONSUMED") continue; throw error; }
    if (await exists(path.join(journalRoot, runId, "journal.json"))) continue;
    if (await exists(path.join(evidenceRoot, runId))) continue;
    return runId;
  }
  fail("R6_PAGES_PROJECT_DRY_RUN_ID_ALLOCATION_FAILED");
}

export async function sealProjectMetadataAttestation({ attestationRoot, attestationId = randomUUID(), selection, accountSource, toolingCommit, wrapperSha256, transportSha256, parserSelectorSha256, endpointSha256, now = () => new Date() }) {
  if (!COMMIT.test(String(toolingCommit)) || ![wrapperSha256, transportSha256, parserSelectorSha256, endpointSha256, accountSource?.accountIdSha256].every((value) => SHA256.test(String(value)))) fail("R6_PAGES_PROJECT_ATTESTATION_SEAL_FAILED");
  const directory = path.join(path.resolve(attestationRoot), `r6-project-auth-dry-${attestationId}`);
  const file = path.join(directory, "production-deployment-attestation.json");
  if (!inside(attestationRoot, file)) fail("R6_PAGES_PROJECT_ATTESTATION_SEAL_FAILED");
  const observedAt = now().toISOString(); const expiresAt = new Date(Date.parse(observedAt) + MAX_WINDOW_MS).toISOString();
  const document = {
    schemaVersion: "r6-production-deployment-attestation-v1", evidenceType: "CLOUDFLARE_PAGES_PROJECT_GET_V1", provider: "cloudflare-pages", projectName: selection.projectName,
    environment: selection.environment, canonicalBaseUrl: selection.canonicalAlias, immutableDeploymentUrl: selection.immutableDeploymentUrl, deploymentId: selection.deploymentId,
    sourceCommit: selection.sourceCommit, productionBranch: selection.productionBranch, triggerBranch: selection.branch, isSkipped: false,
    latestStageName: selection.stage.name, latestStageStatus: selection.stage.status, queryOrProviderEvidenceSha256: selection.rawResponseSha256,
    targetIdentityHash: hash("cloudflare-pages|openglasshub|production|https://openglasshub.pages.dev"), classification: "PRODUCTION_DEPLOYMENT_IDENTITY_EXACT",
    toolingCommit, wrapperSha256, transportSha256, parserSelectorSha256, endpointSha256, accountIdSha256: accountSource.accountIdSha256,
    projectSourceContractSha256: PAGES_PROJECT_GET_SOURCE_CONTRACT_SHA256, sanitizedMetadataSha256: hash(JSON.stringify(selection)), observedAt, expiresAt,
  };
  const raw = Buffer.from(`${JSON.stringify(document, null, 2)}\n`); const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try { await mkdir(directory, { recursive: false }); const handle = await open(temporary, "wx", 0o600); try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); } await rename(temporary, file); }
  catch { await rm(temporary, { force: true }); await rm(directory, { recursive: true, force: true }); fail("R6_PAGES_PROJECT_ATTESTATION_SEAL_FAILED"); }
  return { path: file, sha256: hash(raw), observedAt, expiresAt, document };
}

export function emitProjectAuthDryRunCommands({ wrapperPath, executionWorktree, attestation, dryRunId, evidenceRoot }) {
  const base = `& ${quote(wrapperPath)} -ExecutionWorktree ${quote(executionWorktree)} -DeploymentAttestationPath ${quote(attestation.path)} -DeploymentAttestationSha256 ${attestation.sha256}`;
  return Object.freeze({
    authCheckOnly: `${base} -AuthCheckOnly -EvidenceRoot ${quote(path.join(evidenceRoot, "auth-check"))}`,
    dryRunOnly: `${base} -DryRunOnly -RunId ${dryRunId} -EvidenceRoot ${quote(path.join(evidenceRoot, "dry-run"))}`,
  });
}

function mapOAuthError(error) {
  if (error?.code === "R6_OAUTH_PROFILE_EXPIRED" || error?.code === "R6_OAUTH_PROFILE_INSUFFICIENT_REMAINING_VALIDITY" || error?.code === "R6_OAUTH_PROFILE_REFRESH_REQUIRED") return "R6_PAGES_PROJECT_OAUTH_NOT_READY";
  return "R6_PAGES_PROJECT_OAUTH_NOT_READY";
}

export async function prepareProjectAuthDryRunAttestation(options) {
  const { assertOAuthReady = () => undefined, requestSentinel = createProjectSingleRequestSentinel(), validateOnly, clock = () => new Date(), onRequestSentinel = () => undefined, onTransportStart = () => undefined, onAttestationCreated = () => undefined, onValidateOnlyCompleted = () => undefined } = options;
  if (typeof validateOnly !== "function") fail("R6_PAGES_PROJECT_VALIDATE_ONLY_FAILED");
  try { assertOAuthReady(); } catch (error) { fail(mapOAuthError(error), error?.code ?? null); }
  requestSentinel(); onRequestSentinel();
  let metadata;
  try { metadata = await prepareFixedPagesProjectMetadata({ ...options, deploymentId: EXPECTED_DEPLOYMENT_ID, sourceCommit: EXPECTED_SOURCE_COMMIT, accountId: options.resolvedAccount.accountId, onTransportStart }); }
  catch (error) { fail(error?.code?.includes("TARGET") || error?.code?.includes("REQUIRED_FIELD") || error?.code?.includes("CONFLICT") ? "R6_PAGES_PROJECT_TARGET_MISMATCH" : "R6_PAGES_PROJECT_TRANSPORT_FAILED", error?.diagnosticReference ?? error?.code ?? null); }
  const attestation = await sealProjectMetadataAttestation({ attestationRoot: options.attestationRoot, selection: metadata.selection, accountSource: metadata.request, toolingCommit: options.toolingCommit, wrapperSha256: options.wrapperSha256, transportSha256: options.transportSha256, parserSelectorSha256: options.parserSelectorSha256, endpointSha256: metadata.request.endpointSha256, now: clock });
  onAttestationCreated();
  try { await validateOnly({ attestationPath: attestation.path, attestationSha256: attestation.sha256 }); onValidateOnlyCompleted(); }
  catch { fail("R6_PAGES_PROJECT_VALIDATE_ONLY_FAILED"); }
  const remaining = Date.parse(attestation.expiresAt) - clock().getTime();
  if (remaining < MINIMUM_REMAINING_MS) fail("R6_HARDENED_PREFLIGHT_ATTESTATION_VALIDITY_INSUFFICIENT");
  const dryRunId = await allocateProjectUnreservedDryRunId({ registryRoot: options.registryRoot, journalRoot: options.journalRoot, evidenceRoot: options.evidenceRoot, randomUuid: options.randomUuid, exists: options.exists });
  const commands = emitProjectAuthDryRunCommands({ wrapperPath: options.wrapperPath, executionWorktree: options.executionWorktree, attestation, dryRunId, evidenceRoot: options.evidenceRoot });
  return { classification: "R6_PAGES_PROJECT_METADATA_PREPARATION_OK", metadata, attestation, remainingValidityMilliseconds: remaining, dryRunId, commands };
}

function requiredFlag(values, name) { const value = values.get(name); if (!value) fail("R6_PAGES_PROJECT_LOCAL_VALIDATION_FAILED"); return value; }
function parseFlags(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) { if (!argv[index]?.startsWith("--") || values.has(argv[index]) || index + 1 >= argv.length) fail("R6_PAGES_PROJECT_LOCAL_VALIDATION_FAILED"); values.set(argv[index], argv[index + 1]); }
  const allowed = new Set(["--operation", "--repository-root", "--attestation-root", "--registry-root", "--journal-root", "--evidence-root", "--wrapper-path", "--execution-worktree", "--tooling-commit", "--wrapper-sha256", "--transport-sha256", "--parser-selector-sha256", "--terminal-result-path"]);
  for (const key of values.keys()) if (!allowed.has(key)) fail("R6_PAGES_PROJECT_LOCAL_VALIDATION_FAILED");
  if (requiredFlag(values, "--operation") !== R6_PAGES_PROJECT_METADATA_PREPARATION_OPERATION) fail("R6_PAGES_PROJECT_LOCAL_VALIDATION_FAILED");
  return values;
}

function terminalDigest(value) { const copy = { ...value, resultSha256: null }; return hash(JSON.stringify(copy)); }
export function createProjectTerminalResult({ resultPath, toolingCommit, outerClassification, innerClassification = null, childExitCode, promptReached = false, requestSentinelReached = false, transportReached = false, attestationCreated = false, validateOnlyCompleted = false, commands = [] }) {
  if (!resultPath || !COMMIT.test(String(toolingCommit)) || !Number.isInteger(childExitCode) || !Array.isArray(commands)) fail("R6_PAGES_PROJECT_TERMINAL_RESULT_FAILED");
  const result = { schemaVersion: R6_PAGES_PROJECT_METADATA_TERMINAL_RESULT_VERSION, toolingCommit, outerClassification, innerClassification, childExitCode, promptReached: Boolean(promptReached), requestSentinelReached: Boolean(requestSentinelReached), transportReached: Boolean(transportReached), attestationCreated: Boolean(attestationCreated), validateOnlyCompleted: Boolean(validateOnlyCompleted), commandsEmittedCount: commands.length, commands, sanitizedEvidencePath: resultPath, sanitizedEvidenceDigest: hash(path.resolve(resultPath)), resultSha256: null };
  result.resultSha256 = terminalDigest(result); return result;
}
export async function writeProjectTerminalResult(value, resultPath) {
  if (value.resultSha256 !== terminalDigest(value) || path.resolve(value.sanitizedEvidencePath) !== path.resolve(resultPath)) fail("R6_PAGES_PROJECT_TERMINAL_RESULT_FAILED");
  const raw = Buffer.from(`${JSON.stringify(value)}\n`); const temporary = `${resultPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(resultPath), { recursive: true });
  try { await stat(resultPath); fail("R6_PAGES_PROJECT_TERMINAL_RESULT_FAILED"); } catch (error) { if (error?.code && error.code !== "ENOENT") throw error; }
  try { const handle = await open(temporary, "wx", 0o600); try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); } await rename(temporary, resultPath); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
  return { path: resultPath, sha256: hash(raw), byteLength: raw.length };
}

/** Validates the terminal result itself before a wrapper decides whether to emit commands or surface a safe failure. */
export function validateProjectTerminalResult(value, { resultPath, toolingCommit } = {}) {
  if (!value || value.schemaVersion !== R6_PAGES_PROJECT_METADATA_TERMINAL_RESULT_VERSION || value.toolingCommit !== toolingCommit || path.resolve(value.sanitizedEvidencePath ?? "") !== path.resolve(resultPath ?? "") || value.resultSha256 !== terminalDigest(value) || !Number.isInteger(value.childExitCode) || !Array.isArray(value.commands) || value.commands.length !== value.commandsEmittedCount || !PROJECT_PHASES.every((phase) => typeof value[phase] === "boolean")) fail("R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE");
  const phases = value;
  const success = value.outerClassification === R6_PAGES_PROJECT_METADATA_SUCCESS;
  if (success) {
    if (value.childExitCode !== 0 || value.innerClassification !== null || !phases.promptReached || !phases.requestSentinelReached || !phases.transportReached || !phases.attestationCreated || !phases.validateOnlyCompleted || value.commands.length !== 2) fail("R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE");
    return Object.freeze({ kind: "success", classification: value.outerClassification });
  }
  const knownFailures = new Set(["R6_PAGES_PROJECT_OAUTH_NOT_READY", "R6_PAGES_PROJECT_ACCOUNT_INPUT_FAILED", "R6_PAGES_PROJECT_TARGET_MISMATCH", "R6_PAGES_PROJECT_TRANSPORT_FAILED", "R6_PAGES_PROJECT_ATTESTATION_SEAL_FAILED", "R6_PAGES_PROJECT_VALIDATE_ONLY_FAILED", "R6_HARDENED_PREFLIGHT_ATTESTATION_VALIDITY_INSUFFICIENT", "R6_PAGES_PROJECT_DRY_RUN_ID_ALLOCATION_FAILED"]);
  if (!knownFailures.has(value.outerClassification) || value.childExitCode !== 1 || value.commands.length !== 0) fail("R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE");
  if (value.outerClassification === "R6_PAGES_PROJECT_OAUTH_NOT_READY" && (phases.promptReached || phases.requestSentinelReached || phases.transportReached)) fail("R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE");
  if (value.outerClassification === "R6_PAGES_PROJECT_ACCOUNT_INPUT_FAILED" && (!phases.promptReached || phases.requestSentinelReached || phases.transportReached)) fail("R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE");
  if (["R6_PAGES_PROJECT_TARGET_MISMATCH", "R6_PAGES_PROJECT_TRANSPORT_FAILED", "R6_PAGES_PROJECT_ATTESTATION_SEAL_FAILED"].includes(value.outerClassification) && (!phases.requestSentinelReached || !phases.transportReached || phases.attestationCreated || phases.validateOnlyCompleted)) fail("R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE");
  if (value.outerClassification === "R6_PAGES_PROJECT_TARGET_MISMATCH" && !value.innerClassification) fail("R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE");
  if (value.outerClassification === "R6_PAGES_PROJECT_VALIDATE_ONLY_FAILED" && (!phases.requestSentinelReached || !phases.transportReached || !phases.attestationCreated || phases.validateOnlyCompleted)) fail("R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE");
  if (["R6_HARDENED_PREFLIGHT_ATTESTATION_VALIDITY_INSUFFICIENT", "R6_PAGES_PROJECT_DRY_RUN_ID_ALLOCATION_FAILED"].includes(value.outerClassification) && (!phases.requestSentinelReached || !phases.transportReached || !phases.attestationCreated || !phases.validateOnlyCompleted)) fail("R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE");
  return Object.freeze({ kind: "failure", classification: value.outerClassification });
}

export async function runProjectMetadataPreparationCli(argv = process.argv.slice(2), { oauthProfileValidator = validateOfflineWranglerOAuthProfile, accountResolver = resolvePagesAccountId, secureInput = readHiddenCloudflareAccountId, prepare = prepareProjectAuthDryRunAttestation, phaseState = createProjectPhaseState() } = {}) {
  const values = parseFlags(argv); const state = phaseState; let auth = null; let account = null;
  const terminalResultPath = requiredFlag(values, "--terminal-result-path"); const evidenceRoot = requiredFlag(values, "--evidence-root");
  if (!inside(evidenceRoot, terminalResultPath) || path.basename(terminalResultPath) !== "project-metadata-preparation-terminal-result.json") fail("R6_PAGES_PROJECT_TERMINAL_RESULT_FAILED");
  try {
    try { auth = await oauthProfileValidator(); assertOfflineOAuthProfileReady(auth); } catch (error) { fail(mapOAuthError(error), error?.code ?? null); }
    try { account = await accountResolver({ repositoryRoot: requiredFlag(values, "--repository-root"), requestHiddenInput: async () => { markProjectPhase(state, "promptReached"); return secureInput(); } }); }
    catch (error) { fail("R6_PAGES_PROJECT_ACCOUNT_INPUT_FAILED", error?.code ?? null); }
    const toolingCommit = requiredFlag(values, "--tooling-commit");
    const result = await prepare({ resolvedAccount: account, auth, attestationRoot: requiredFlag(values, "--attestation-root"), registryRoot: requiredFlag(values, "--registry-root"), journalRoot: requiredFlag(values, "--journal-root"), evidenceRoot, wrapperPath: requiredFlag(values, "--wrapper-path"), executionWorktree: requiredFlag(values, "--execution-worktree"), toolingCommit, wrapperSha256: requiredFlag(values, "--wrapper-sha256"), transportSha256: requiredFlag(values, "--transport-sha256"), parserSelectorSha256: requiredFlag(values, "--parser-selector-sha256"), onRequestSentinel: () => markProjectPhase(state, "requestSentinelReached"), onTransportStart: () => markProjectPhase(state, "transportReached"), onAttestationCreated: () => markProjectPhase(state, "attestationCreated"), onValidateOnlyCompleted: () => markProjectPhase(state, "validateOnlyCompleted"), validateOnly: async ({ attestationPath, attestationSha256 }) => validateDeploymentAttestation({ attestationPath, expectedSha256: attestationSha256, expectedCommit: EXPECTED_SOURCE_COMMIT, expectedToolingCommit: toolingCommit, root: requiredFlag(values, "--attestation-root") }) });
    return { classification: R6_PAGES_PROJECT_METADATA_SUCCESS, phaseState: state, ...result };
  } finally { if (auth) auth.token = null; if (account) account.accountId = null; }
}

export function isProjectMetadataEntrypoint(argvPath, moduleUrl = import.meta.url) { return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href; }

if (isProjectMetadataEntrypoint(process.argv[1])) {
  let values; let resultPath = null; let toolingCommit = "0000000000000000000000000000000000000000"; const state = createProjectPhaseState();
  try { values = parseFlags(process.argv.slice(2)); resultPath = requiredFlag(values, "--terminal-result-path"); toolingCommit = requiredFlag(values, "--tooling-commit"); const result = await runProjectMetadataPreparationCli(process.argv.slice(2), { phaseState: state }); await writeProjectTerminalResult(createProjectTerminalResult({ resultPath, toolingCommit, outerClassification: result.classification, childExitCode: 0, ...state, commands: [result.commands.authCheckOnly, result.commands.dryRunOnly] }), resultPath); process.stdout.write(`${R6_PAGES_PROJECT_METADATA_SUCCESS}\n${result.commands.authCheckOnly}\n${result.commands.dryRunOnly}\n`); }
  catch (error) { const code = error?.code ?? "R6_PAGES_PROJECT_TERMINAL_RESULT_FAILED"; if (resultPath && COMMIT.test(toolingCommit)) { try { await writeProjectTerminalResult(createProjectTerminalResult({ resultPath, toolingCommit, outerClassification: code, innerClassification: error?.innerCode ?? null, childExitCode: 1, ...state, commands: [] }), resultPath); } catch {} } process.stderr.write(`${code}\n`); process.exitCode = 1; }
}
