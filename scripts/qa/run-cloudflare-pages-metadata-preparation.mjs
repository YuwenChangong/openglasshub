import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prepareFixedPagesDeploymentMetadata } from "./prepare-cloudflare-pages-deployment-get.mjs";
import { assertRunIdNotConsumed, validateConsumedRunId } from "./production-minimal-canary-consumed-run-registry.mjs";
import { validateDeploymentAttestation } from "./production-deployment-attestation.mjs";
import { assertOfflineOAuthProfileReady, OAuthProfileReadinessError, validateOfflineWranglerOAuthProfile } from "./cloudflare-pages-oauth-profile-readiness.mjs";
import { resolvePagesAccountId } from "./cloudflare-pages-account-resolver.mjs";

export const R6_METADATA_PREPARATION_OPERATION = "PREPARE_AUTH_DRY_RUN_ATTESTATION";
export const R6_METADATA_PREPARATION_VERSION = "r6-pages-metadata-preparation-v1";
export const R6_METADATA_PREPARATION_SUCCESS = "R6_HARDENED_AUTH_AND_DRY_RUN_ATTESTATION_READY_FOR_HUMAN_EXECUTION";
export const R6_METADATA_TERMINAL_RESULT_VERSION = "r6-metadata-preparation-terminal-result-v1";
const MINIMUM_REMAINING_MS = 13 * 60 * 1000;
const MAX_WINDOW_MS = 15 * 60 * 1000;
const SHA256 = /^[a-f0-9]{64}$/;
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const oauthOuterCode = (innerCode) => {
  if (innerCode === "R6_OAUTH_PROFILE_EXPIRED") return "R6_METADATA_PREPARATION_OAUTH_PROFILE_EXPIRED";
  if (innerCode === "R6_OAUTH_PROFILE_INSUFFICIENT_REMAINING_VALIDITY") return "R6_METADATA_PREPARATION_OAUTH_PROFILE_VALIDITY_INSUFFICIENT";
  return "R6_METADATA_PREPARATION_OAUTH_PROFILE_NOT_READY";
};
const failOAuth = (innerCode) => {
  const outerCode = oauthOuterCode(innerCode);
  const error = new Error(`${outerCode}:${innerCode}`);
  error.code = outerCode;
  error.innerCode = innerCode;
  throw error;
};

function inside(root, candidate) { const relative = path.relative(path.resolve(root), path.resolve(candidate)); return !relative.startsWith("..") && !path.isAbsolute(relative); }
function utc(value) { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail("R6_HARDENED_OFFICIAL_GET_ATTESTATION_SEAL_FAILED"); return Date.parse(value); }
function quote(value) { return `'${String(value).replace(/'/g, "''")}'`; }

export function createSingleRequestSentinel() { let used = false; return () => { if (used) fail("R6_HARDENED_OFFICIAL_GET_TRANSPORT_FAILED"); used = true; }; }

export async function allocateUnreservedDryRunId({ registryRoot, journalRoot, randomUuid = randomUUID, exists = async (candidate) => stat(candidate).then(() => true).catch(() => false) }) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const runId = validateConsumedRunId(`qa-canary-${randomUuid()}`);
    try { await assertRunIdNotConsumed({ root: registryRoot, runId }); } catch (error) { if (error?.message === "QA_CANARY_RUN_ID_ALREADY_CONSUMED") continue; throw error; }
    if (await exists(path.join(journalRoot, runId, "journal.json"))) continue;
    return runId;
  }
  fail("R6_HARDENED_OFFICIAL_GET_DRY_RUN_ID_ALLOCATION_FAILED");
}

export async function sealMetadataAttestation({ attestationRoot, attestationId = randomUUID(), selection, accountSource, toolingCommit, wrapperSha256, transportSha256, parserSelectorSha256, endpointSha256, now = () => new Date() }) {
  if (![toolingCommit, wrapperSha256, transportSha256, parserSelectorSha256, endpointSha256].every((value) => SHA256.test(String(value)) || /^[a-f0-9]{40}$/.test(toolingCommit))) fail("R6_HARDENED_OFFICIAL_GET_ATTESTATION_SEAL_FAILED");
  const directory = path.join(path.resolve(attestationRoot), `r6-auth-dry-${attestationId}`); const file = path.join(directory, "production-deployment-attestation.json");
  if (!inside(attestationRoot, file)) fail("R6_HARDENED_OFFICIAL_GET_ATTESTATION_SEAL_FAILED");
  await mkdir(directory, { recursive: false }).catch(() => fail("R6_HARDENED_OFFICIAL_GET_ATTESTATION_SEAL_FAILED"));
  const observedAt = now().toISOString(); const expiresAt = new Date(Date.parse(observedAt) + MAX_WINDOW_MS).toISOString();
  const document = {
    schemaVersion: "r6-production-deployment-attestation-v1", provider: "cloudflare-pages", projectName: selection.projectName, environment: selection.environment,
    canonicalBaseUrl: selection.canonicalAlias, immutableDeploymentUrl: selection.immutableDeploymentUrl, deploymentId: selection.deploymentId, sourceCommit: selection.sourceCommit,
    queryOrProviderEvidenceSha256: selection.rawResponseSha256, targetIdentityHash: hash("cloudflare-pages|openglasshub|production|https://openglasshub.pages.dev"), classification: "PRODUCTION_DEPLOYMENT_IDENTITY_EXACT",
    evidenceType: "CLOUDFLARE_PAGES_DEPLOYMENT_GET_V1", toolingCommit, wrapperSha256, transportSha256, parserSelectorSha256, endpointSha256, accountIdSha256: accountSource.accountIdSha256,
    branch: selection.branch, stage: selection.stage, isSkipped: false, sanitizedMetadataSha256: hash(JSON.stringify(selection)), observedAt, expiresAt,
  };
  const raw = Buffer.from(`${JSON.stringify(document, null, 2)}\n`); const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try { const handle = await open(temporary, "wx", 0o600); try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); } await rename(temporary, file); }
  catch { await rm(temporary, { force: true }); await rm(directory, { recursive: true, force: true }); fail("R6_HARDENED_OFFICIAL_GET_ATTESTATION_SEAL_FAILED"); }
  return { path: file, sha256: hash(raw), observedAt, expiresAt, document };
}

export function emitAuthDryRunCommands({ wrapperPath, executionWorktree, attestation, dryRunId, evidenceRoot }) {
  const base = `& ${quote(wrapperPath)} -ExecutionWorktree ${quote(executionWorktree)} -DeploymentAttestationPath ${quote(attestation.path)} -DeploymentAttestationSha256 ${attestation.sha256}`;
  return { authCheckOnly: `${base} -AuthCheckOnly -EvidenceRoot ${quote(path.join(evidenceRoot, "auth-check"))}`, dryRunOnly: `${base} -DryRunOnly -RunId ${dryRunId} -EvidenceRoot ${quote(path.join(evidenceRoot, "dry-run"))}` };
}

export async function prepareAuthDryRunAttestation(options) {
  const { requestSentinel = createSingleRequestSentinel(), validateOnly, registryRoot, journalRoot, evidenceRoot, wrapperPath, executionWorktree, toolingCommit, wrapperSha256, transportSha256, parserSelectorSha256, endpointSha256, clock = () => new Date(), assertOAuthReady = () => undefined, onRequestSentinel = () => undefined, onTransportStart = () => undefined } = options;
  if (typeof validateOnly !== "function") fail("R6_HARDENED_OFFICIAL_GET_VALIDATE_ONLY_FAILED");
  assertOAuthReady();
  requestSentinel(); onRequestSentinel();
  onTransportStart();
  const metadata = await prepareFixedPagesDeploymentMetadata(options);
  const attestation = await sealMetadataAttestation({ attestationRoot: options.attestationRoot, selection: metadata.deployment, accountSource: metadata.accountSource, toolingCommit, wrapperSha256, transportSha256, parserSelectorSha256, endpointSha256, now: clock });
  try { await validateOnly({ attestationPath: attestation.path, attestationSha256: attestation.sha256 }); }
  catch { fail("R6_HARDENED_OFFICIAL_GET_VALIDATE_ONLY_FAILED"); }
  const remaining = Date.parse(attestation.expiresAt) - clock().getTime(); if (remaining < MINIMUM_REMAINING_MS) fail("R6_HARDENED_PREFLIGHT_ATTESTATION_VALIDITY_INSUFFICIENT");
  const dryRunId = await allocateUnreservedDryRunId({ registryRoot, journalRoot });
  const commands = emitAuthDryRunCommands({ wrapperPath, executionWorktree, attestation, dryRunId, evidenceRoot });
  return { classification: "R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_OK", metadata, attestation, remainingValidityMilliseconds: remaining, dryRunId, commands };
}

/**
 * The PowerShell wrapper consumes line-oriented terminal output. Keep the
 * successful surface deliberately small so it can reject missing or reordered
 * output without parsing provider evidence or credentials.
 */
export function metadataPreparationTerminalLines(value) {
  if (!value || value.classification !== R6_METADATA_PREPARATION_SUCCESS) fail("R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID");
  const commands = value.commands;
  if (!commands || typeof commands.authCheckOnly !== "string" || typeof commands.dryRunOnly !== "string" || commands.authCheckOnly.length === 0 || commands.dryRunOnly.length === 0) {
    fail("R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID");
  }
  if (commands.authCheckOnly.includes("ExecuteApprovedPhase") || commands.dryRunOnly.includes("ExecuteApprovedPhase")) fail("R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID");
  return [R6_METADATA_PREPARATION_SUCCESS, commands.authCheckOnly, commands.dryRunOnly];
}

export function emitMetadataPreparationTerminalOutput(value, output = process.stdout) {
  for (const line of metadataPreparationTerminalLines(value)) output.write(`${line}\n`);
}

function terminalResultDigest(value) {
  const copy = { ...value, resultSha256: null };
  return hash(JSON.stringify(copy));
}

function terminalResultPath(values) {
  const candidate = values.get("--terminal-result-path");
  if (!candidate) return null;
  const evidenceRoot = requiredFlag(values, "--evidence-root");
  if (!inside(evidenceRoot, candidate) || path.basename(candidate) !== "metadata-preparation-terminal-result.json") {
    fail("R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID");
  }
  return path.resolve(candidate);
}

export function createMetadataPreparationTerminalResult({ terminalResultPath: resultPath, toolingCommit, outerClassification, innerClassification = null, childExitCode, promptReached = false, requestSentinelReached = false, transportReached = false, attestationCreated = false, validateOnlyCompleted = false, commands = [] }) {
  if (!resultPath || !/^[a-f0-9]{40}$/.test(String(toolingCommit)) || !Number.isInteger(childExitCode) || typeof outerClassification !== "string" || (innerClassification !== null && typeof innerClassification !== "string")) {
    fail("R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID");
  }
  if (!Array.isArray(commands) || commands.some((command) => typeof command !== "string" || command.includes("ExecuteApprovedPhase"))) {
    fail("R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID");
  }
  const value = {
    schemaVersion: R6_METADATA_TERMINAL_RESULT_VERSION,
    toolingCommit,
    outerClassification,
    innerClassification,
    childExitCode,
    promptReached: Boolean(promptReached),
    requestSentinelReached: Boolean(requestSentinelReached),
    transportReached: Boolean(transportReached),
    attestationCreated: Boolean(attestationCreated),
    validateOnlyCompleted: Boolean(validateOnlyCompleted),
    commandsEmittedCount: commands.length,
    commands,
    sanitizedEvidencePath: resultPath,
    sanitizedEvidenceDigest: hash(resultPath),
    resultSha256: null,
  };
  value.resultSha256 = terminalResultDigest(value);
  return value;
}

export async function writeMetadataPreparationTerminalResult(value, resultPath) {
  if (path.resolve(value.sanitizedEvidencePath) !== path.resolve(resultPath) || value.resultSha256 !== terminalResultDigest(value)) {
    fail("R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID");
  }
  const raw = Buffer.from(`${JSON.stringify(value)}\n`);
  const temporary = `${resultPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(resultPath), { recursive: true }).catch(() => fail("R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID"));
  let resultAlreadyExists = false;
  try { await stat(resultPath); resultAlreadyExists = true; }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (resultAlreadyExists) fail("R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID");
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, resultPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { path: resultPath, sha256: hash(raw), byteLength: raw.length };
}

export function validateMetadataPreparationTerminalResult(value, { resultPath, toolingCommit } = {}) {
  if (!value || value.schemaVersion !== R6_METADATA_TERMINAL_RESULT_VERSION || value.toolingCommit !== toolingCommit || path.resolve(value.sanitizedEvidencePath ?? "") !== path.resolve(resultPath ?? "") || value.sanitizedEvidenceDigest !== hash(path.resolve(resultPath ?? "")) || value.resultSha256 !== terminalResultDigest(value)) {
    fail("R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID");
  }
  if (!Number.isInteger(value.childExitCode) || typeof value.outerClassification !== "string" || !Array.isArray(value.commands) || value.commands.length !== value.commandsEmittedCount || value.commands.some((command) => typeof command !== "string" || command.includes("ExecuteApprovedPhase"))) {
    fail("R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID");
  }
  return value;
}

export function metadataPreparationInnerClassification(error) {
  return error?.diagnosticReference ?? error?.innerCode ?? null;
}

function requiredFlag(values, name) { const value = values.get(name); if (!value) fail("R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID"); return value; }
export async function readHiddenCloudflareAccountId({ input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") fail("R6_METADATA_PREPARATION_ACCOUNT_PROMPT_BLOCKED");
  output.write("Cloudflare account ID (hidden): ");
  let raw = false;
  const characters = [];
  try {
    input.setRawMode(true); raw = true; input.resume();
    const value = await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => { input.off("data", onData); input.off("end", onEnd); };
      const settle = (callback, payload) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(payload);
      };
      const onData = (chunk) => {
        for (const byte of Buffer.from(chunk)) {
          if (byte === 3) { settle(reject, Object.assign(new Error("R6_METADATA_PREPARATION_ACCOUNT_INPUT_FAILED"), { code: "R6_METADATA_PREPARATION_ACCOUNT_INPUT_FAILED" })); return; }
          if (byte === 13 || byte === 10) { settle(resolve, Buffer.from(characters).toString("utf8")); return; }
          if (byte === 8 || byte === 127) { characters.pop(); continue; }
          if (byte >= 32 && byte <= 126) characters.push(byte);
        }
      };
      const onEnd = () => settle(reject, Object.assign(new Error("R6_METADATA_PREPARATION_ACCOUNT_INPUT_FAILED"), { code: "R6_METADATA_PREPARATION_ACCOUNT_INPUT_FAILED" }));
      input.once("end", onEnd); input.on("data", onData);
    });
    return value;
  } catch (error) { fail(error?.code ?? "R6_METADATA_PREPARATION_ACCOUNT_INPUT_FAILED"); }
  finally {
    if (raw) input.setRawMode(false);
    if (typeof input.pause === "function") input.pause();
    characters.fill(0);
    output.write("\n");
  }
}

/** The executable surface accepts no secrets as arguments. Hidden account input arrives once through stdin from the wrapper. */
export async function runMetadataPreparationCli(argv = process.argv.slice(2), { oauthProfileValidator = validateOfflineWranglerOAuthProfile, accountResolver = resolvePagesAccountId, secureInput = readHiddenCloudflareAccountId, prepare = prepareAuthDryRunAttestation, terminalState = {} } = {}) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) { if (!argv[index]?.startsWith("--") || values.has(argv[index]) || index + 1 >= argv.length) fail("R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID"); values.set(argv[index], argv[index + 1]); }
  const allowed = new Set(["--operation", "--repository-root", "--attestation-root", "--registry-root", "--journal-root", "--evidence-root", "--wrapper-path", "--execution-worktree", "--tooling-commit", "--wrapper-sha256", "--transport-sha256", "--parser-selector-sha256", "--deployment-id", "--source-commit", "--terminal-result-path"]);
  for (const key of values.keys()) if (!allowed.has(key)) fail("R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID");
  if (requiredFlag(values, "--operation") !== R6_METADATA_PREPARATION_OPERATION) fail("R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID");
  const repositoryRoot = requiredFlag(values, "--repository-root"); const attestationRoot = requiredFlag(values, "--attestation-root"); const sourceCommit = requiredFlag(values, "--source-commit"); terminalResultPath(values);
  let auth = null; let account = null;
  try {
    try { auth = await oauthProfileValidator(); }
    catch (error) { failOAuth(error?.code ?? "R6_OAUTH_PROFILE_NOT_READY"); }
    try { account = await accountResolver({ repositoryRoot, requestHiddenInput: async () => { terminalState.promptReached = true; return secureInput(); } }); }
    catch (error) { fail(error?.code === "PAGES_ACCOUNT_ID_SOURCE_ABSENT" ? "R6_METADATA_PREPARATION_ACCOUNT_PROMPT_BLOCKED" : error?.code ?? "R6_METADATA_PREPARATION_ACCOUNT_INPUT_FAILED"); }
    const deploymentId = requiredFlag(values, "--deployment-id");
    const endpointSha256 = hash(`https://api.cloudflare.com/client/v4/accounts/${account.accountId}/pages/projects/openglasshub/deployments/${deploymentId}`);
    const result = await prepare({ repositoryRoot, resolvedAccount: account, auth, deploymentId, sourceCommit, attestationRoot, registryRoot: requiredFlag(values, "--registry-root"), journalRoot: requiredFlag(values, "--journal-root"), evidenceRoot: requiredFlag(values, "--evidence-root"), wrapperPath: requiredFlag(values, "--wrapper-path"), executionWorktree: requiredFlag(values, "--execution-worktree"), toolingCommit: requiredFlag(values, "--tooling-commit"), wrapperSha256: requiredFlag(values, "--wrapper-sha256"), transportSha256: requiredFlag(values, "--transport-sha256"), parserSelectorSha256: requiredFlag(values, "--parser-selector-sha256"), endpointSha256, onRequestSentinel: () => { terminalState.requestSentinelReached = true; }, onTransportStart: () => { terminalState.transportReached = true; }, assertOAuthReady: () => {
      try { return assertOfflineOAuthProfileReady(auth); }
      catch (error) {
        if (error instanceof OAuthProfileReadinessError) failOAuth(error.code);
        throw error;
      }
    }, validateOnly: async ({ attestationPath, attestationSha256 }) => validateDeploymentAttestation({ attestationPath, expectedSha256: attestationSha256, expectedCommit: sourceCommit, root: attestationRoot }) });
    terminalState.attestationCreated = true; terminalState.validateOnlyCompleted = true;
    return { classification: R6_METADATA_PREPARATION_SUCCESS, attestation: { path: result.attestation.path, sha256: result.attestation.sha256, observedAt: result.attestation.observedAt, expiresAt: result.attestation.expiresAt }, remainingValidityMilliseconds: result.remainingValidityMilliseconds, dryRunId: result.dryRunId, commands: result.commands };
  } finally { if (auth) auth.token = null; if (account) account.accountId = null; }
}

export function isMetadataPreparationEntrypoint(argvPath, moduleUrl = import.meta.url) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href;
}

if (isMetadataPreparationEntrypoint(process.argv[1])) {
  const argv = process.argv.slice(2);
  const resultIndex = argv.indexOf("--terminal-result-path");
  const resultPath = resultIndex >= 0 ? argv[resultIndex + 1] : null;
  const toolingIndex = argv.indexOf("--tooling-commit");
  const toolingCommit = toolingIndex >= 0 ? argv[toolingIndex + 1] : null;
  const terminalState = {};
  runMetadataPreparationCli(argv, { terminalState }).then(async (value) => {
    if (resultPath) await writeMetadataPreparationTerminalResult(createMetadataPreparationTerminalResult({ terminalResultPath: resultPath, toolingCommit, outerClassification: value.classification, childExitCode: 0, ...terminalState, commands: metadataPreparationTerminalLines(value).slice(1) }), resultPath);
    else emitMetadataPreparationTerminalOutput(value);
  }).catch(async (error) => {
    if (resultPath && toolingCommit) {
      try { await writeMetadataPreparationTerminalResult(createMetadataPreparationTerminalResult({ terminalResultPath: resultPath, toolingCommit, outerClassification: error.code ?? "R6_HARDENED_OFFICIAL_GET_CHILD_PROCESS_FAILED", innerClassification: metadataPreparationInnerClassification(error), childExitCode: 1, ...terminalState }), resultPath); }
      catch { /* The wrapper converts an absent or invalid result into a stable blocker. */ }
    } else process.stderr.write(`${error.code ?? error.message}${error.innerCode ? `:${error.innerCode}` : ""}\n`);
    process.exitCode = 1;
  });
}
