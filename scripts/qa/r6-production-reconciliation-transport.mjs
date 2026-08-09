import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBoundExecutionPackage, safeEqual, TRANSPORT_CONTRACT_VERSION, validateAuthorizationV2, validateFinalHumanConfirmation, validatePsqlCapability, fail } from "../lib/r6-production-reconciliation-transport-contract.mjs";
import { assertReceiptEligible, reserveAttempt, transitionReceipt } from "../lib/r6-production-reconciliation-receipt.mjs";
import { verifyTargetIdentity } from "../lib/r6-production-reconciliation-target.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const migrationEnvelope = (bytes) => Buffer.concat([Buffer.from("BEGIN;\n", "utf8"), bytes, Buffer.from("\nCOMMIT;\n", "utf8")]);
const redacted = (value) => String(value ?? "").replace(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, "[redacted-connection-uri]").replace(/password\s*=\s*[^\s]+/gi, "password=[redacted]");

function resolvePsqlExecutable() {
  const command = process.platform === "win32" ? "where.exe" : "which";
  const lookup = execFileSync(command, [process.platform === "win32" ? "psql.exe" : "psql"], { encoding: "utf8" }).split(/\r?\n/).find(Boolean);
  if (!lookup || !path.isAbsolute(lookup)) fail("R6_PRODUCTION_RECONCILIATION_SQL_CLIENT_CAPABILITY_UNAVAILABLE");
  return lookup;
}

export function inspectNativePsqlCapability() {
  try {
    const executablePath = resolvePsqlExecutable();
    const version = execFileSync(executablePath, ["--version"], { encoding: "utf8" }).trim();
    const help = execFileSync(executablePath, ["--help"], { encoding: "utf8" });
    const executableSha256 = hash(readFileSync(executablePath));
    return validatePsqlCapability({ executablePath, version, help, executableSha256 });
  } catch (error) { if (error?.code) throw error; fail("R6_PRODUCTION_RECONCILIATION_SQL_CLIENT_CAPABILITY_UNAVAILABLE"); }
}

function requiredConnectionEnvironment(environment) {
  const names = ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"];
  if (names.some((name) => typeof environment[name] !== "string" || environment[name].length === 0)) fail("R6_PRODUCTION_RECONCILIATION_SECURE_CONNECTION_CHANNEL_UNAVAILABLE");
  if (environment.DATABASE_URL || environment.SUPABASE_DB_URL || environment.R6_PRODUCTION_RECONCILIATION_DATABASE_URL) fail("R6_PRODUCTION_RECONCILIATION_CONNECTION_STRING_CHANNEL_FORBIDDEN");
  return Object.freeze(Object.fromEntries(names.map((name) => [name, environment[name]])));
}

function psqlRun({ executablePath, environment, input, tupleOnly = false, outputPath = null }) {
  return new Promise((resolve) => {
    const args = ["-X", "-v", "ON_ERROR_STOP=1", ...(tupleOnly ? ["-qAt"] : ["-q"]), ...(outputPath ? ["--csv", "-o", outputPath] : [])];
    const child = spawn(executablePath, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...environment, PAGER: "" }, windowsHide: true });
    let stdout = ""; let stderr = ""; let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => finish({ outcome: "TRANSPORT_FAILURE", errorCategory: error.code ?? "PROCESS_START_FAILED" }));
    child.on("close", (code, signal) => finish({ outcome: code === 0 ? "SUCCESS" : "TRANSPORT_FAILURE", code, signal: signal ?? null, stdout, errorCategory: code === 0 ? null : hash(redacted(stderr)) }));
    child.stdin.end(input);
  });
}

export function createNativePsqlClient({ environment = process.env, capability = inspectNativePsqlCapability() } = {}) {
  const connection = requiredConnectionEnvironment(environment);
  return Object.freeze({
    capability,
    async targetProbe(bytes) {
      const result = await psqlRun({ executablePath: capability.executablePath, environment: connection, input: bytes, tupleOnly: true });
      if (result.outcome !== "SUCCESS") return { outcome: "TARGET_FAILURE", errorCategory: result.errorCategory };
      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      return lines.length === 1 ? { outcome: "TARGET_SUCCESS", observedProbeOutput: lines[0] } : { outcome: "TARGET_FAILURE", errorCategory: "TARGET_PROBE_OUTPUT_INVALID" };
    },
    async submitMigration(bytes) {
      const result = await psqlRun({ executablePath: capability.executablePath, environment: connection, input: migrationEnvelope(bytes) });
      return result.outcome === "SUCCESS" ? { outcome: "COMMITTED" } : { outcome: "COMMIT_STATE_UNKNOWN", errorCategory: result.errorCategory };
    },
    async postflight(bytes, { outputPath } = {}) {
      if (!outputPath || !path.isAbsolute(outputPath)) return { outcome: "POSTFLIGHT_FAILURE", errorCategory: "POSTFLIGHT_OUTPUT_PATH_INVALID" };
      const result = await psqlRun({ executablePath: capability.executablePath, environment: connection, input: bytes, tupleOnly: false, outputPath });
      return result.outcome === "SUCCESS" ? { outcome: "POSTFLIGHT_SUCCESS", outputPath } : { outcome: "POSTFLIGHT_FAILURE", errorCategory: result.errorCategory };
    },
  });
}

async function readJsonArtifact(file, missingCode) {
  if (!path.isAbsolute(String(file ?? ""))) fail("R6_PRODUCTION_RECONCILIATION_ARTIFACT_PATH_INVALID");
  const artifactPath = path.resolve(file);
  const bytes = await readFile(artifactPath).catch(() => fail(missingCode));
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail("R6_PRODUCTION_RECONCILIATION_ARTIFACT_INVALID"); }
  return Object.freeze({ path: artifactPath, value, sha256: hash(bytes) });
}

async function writeImmutableJson(file, value) {
  if (!path.isAbsolute(String(file ?? ""))) fail("R6_PRODUCTION_RECONCILIATION_ARTIFACT_PATH_INVALID");
  const artifactPath = path.resolve(file);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  let handle;
  try {
    handle = await open(artifactPath, "wx", 0o600);
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
    await handle.writeFile(bytes);
    await handle.sync();
    return Object.freeze({ path: artifactPath, value: Object.freeze({ ...value }), sha256: hash(bytes) });
  } catch (error) {
    if (error?.code === "EEXIST") fail("R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_REPLAY");
    throw error;
  } finally { await handle?.close(); }
}

async function loadCandidate({ authorizationPath, implementationCommit, launcherSha256, transportSha256, sqlClientCapability }) {
  const artifact = await readJsonArtifact(authorizationPath, "R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_MISSING");
  const candidate = validateAuthorizationV2(artifact.value, { implementationCommit, launcherSha256, transportSha256, sqlClientCapability });
  return Object.freeze({ ...artifact, candidate });
}

async function loadPackageForCandidate(candidate, packageRoot) {
  return loadBoundExecutionPackage({
    packageRoot,
    expectedExecutionPackageSha256: candidate.executionPackageSha256,
    expectedPackageManifestSha256: candidate.packageManifestSha256,
  });
}

export async function validateOnly({ authorizationPath, packageRoot, implementationCommit, launcherSha256, transportSha256, sqlClientCapability = inspectNativePsqlCapability() }) {
  const candidateArtifact = await loadCandidate({ authorizationPath, implementationCommit, launcherSha256, transportSha256, sqlClientCapability });
  const pkg = await loadPackageForCandidate(candidateArtifact.candidate, packageRoot);
  return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_CANDIDATE_VALIDATED_AWAITING_FINAL_HUMAN_CONFIRMATION", executionAttemptConsumed: false, receiptConsumed: false, networkConnections: 0, authorizationCandidateSha256: candidateArtifact.sha256, executionPackageSha256: pkg.manifestSha256, packageManifestSha256: pkg.packageManifestSha256, canonicalMigrationSha256: pkg.migration.sha256, canonicalPostflightSha256: pkg.postflight.sha256 });
}

export async function finalizeHumanConfirmation({ authorizationPath, packageRoot, finalConfirmationPath, confirmationPhrase, implementationCommit, launcherSha256, transportSha256, sqlClientCapability = inspectNativePsqlCapability(), now = new Date().toISOString() }) {
  if (typeof confirmationPhrase !== "string") fail("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_CHANNEL_UNAVAILABLE");
  const candidateArtifact = await loadCandidate({ authorizationPath, implementationCommit, launcherSha256, transportSha256, sqlClientCapability });
  await loadPackageForCandidate(candidateArtifact.candidate, packageRoot);
  if (!safeEqual(hash(confirmationPhrase), candidateArtifact.candidate.requiredConfirmationSha256)) fail("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_INVALID");
  const finalConfirmation = {
    schemaVersion: "qa-production-reconciliation-final-human-confirmation-v1",
    authorizationCandidateSha256: candidateArtifact.sha256,
    authorizationCandidateId: candidateArtifact.candidate.authorizationId,
    implementationCommit,
    packageManifestSha256: candidateArtifact.candidate.packageManifestSha256,
    executionPackageSha256: candidateArtifact.candidate.executionPackageSha256,
    transportContractVersion: TRANSPORT_CONTRACT_VERSION,
    transportImplementationCommit: candidateArtifact.candidate.transportImplementationCommit,
    transportLauncherSha256: candidateArtifact.candidate.transportLauncherSha256,
    canonicalMigrationSha256: candidateArtifact.candidate.canonicalMigrationSha256,
    canonicalPostflightSha256: candidateArtifact.candidate.canonicalPostflightSha256,
    targetProbeSha256: candidateArtifact.candidate.targetProbeSha256,
    approvedTargetIdentitySha256: candidateArtifact.candidate.targetIdentitySha256,
    requiredConfirmationSha256: candidateArtifact.candidate.requiredConfirmationSha256,
    confirmedPhraseSha256: hash(confirmationPhrase),
    singleUse: true,
    attempts: 1,
    retry: 0,
    automaticRollback: 0,
    confirmedAt: now,
    immutable: true,
  };
  validateFinalHumanConfirmation(finalConfirmation, { candidate: candidateArtifact.candidate, candidateSha256: candidateArtifact.sha256, implementationCommit, launcherSha256 });
  const artifact = await writeImmutableJson(finalConfirmationPath, finalConfirmation);
  return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_FINAL_HUMAN_CONFIRMATION_CREATED", executionAttemptConsumed: false, receiptConsumed: false, networkConnections: 0, authorizationCandidateSha256: candidateArtifact.sha256, finalConfirmationSha256: artifact.sha256, finalConfirmationPath: artifact.path });
}

export async function validateFinalExecutionBinding({ authorizationPath, packageRoot, finalConfirmationPath, implementationCommit, launcherSha256, transportSha256, sqlClientCapability = inspectNativePsqlCapability() }) {
  const candidateArtifact = await loadCandidate({ authorizationPath, implementationCommit, launcherSha256, transportSha256, sqlClientCapability });
  const finalArtifact = await readJsonArtifact(finalConfirmationPath, "R6_PRODUCTION_RECONCILIATION_FINAL_HUMAN_CONFIRMATION_REQUIRED");
  const finalConfirmation = validateFinalHumanConfirmation(finalArtifact.value, { candidate: candidateArtifact.candidate, candidateSha256: candidateArtifact.sha256, implementationCommit, launcherSha256 });
  const pkg = await loadPackageForCandidate(candidateArtifact.candidate, packageRoot);
  return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_FINAL_EXECUTION_BINDING_READY", executionAttemptConsumed: false, receiptConsumed: false, networkConnections: 0, authorizationCandidateSha256: candidateArtifact.sha256, finalConfirmationSha256: finalArtifact.sha256, candidate: candidateArtifact.candidate, finalConfirmation, package: pkg });
}

export async function prepareFinalExecution({ authorizationPath, packageRoot, finalConfirmationPath, receiptRoot, implementationCommit, launcherSha256, transportSha256, sqlClientCapability = inspectNativePsqlCapability() }) {
  const binding = await validateFinalExecutionBinding({ authorizationPath, packageRoot, finalConfirmationPath, implementationCommit, launcherSha256, transportSha256, sqlClientCapability });
  const { candidate: authorization, package: pkg } = binding;
  const receiptEligibility = await assertReceiptEligible({ receiptRoot, authorizationId: authorization.authorizationId });
  return Object.freeze({
    invariant: "NO_SQL_CLIENT_BEFORE_FINAL_EXECUTION_BINDING_READY",
    classification: binding.classification,
    binding,
    receiptEligibility,
  });
}

export async function executePrepared({ preparedExecution, client, receiptRoot }) {
  if (!preparedExecution || preparedExecution.invariant !== "NO_SQL_CLIENT_BEFORE_FINAL_EXECUTION_BINDING_READY" || preparedExecution.classification !== "R6_PRODUCTION_RECONCILIATION_FINAL_EXECUTION_BINDING_READY") fail("R6_PRODUCTION_RECONCILIATION_PREBIND_SQL_CLIENT_BOUNDARY_FAILED");
  if (!client || typeof client.targetProbe !== "function" || typeof client.submitMigration !== "function" || typeof client.postflight !== "function") fail("R6_PRODUCTION_RECONCILIATION_SQL_CLIENT_INVALID");
  const binding = preparedExecution.binding;
  const { candidate: authorization, package: pkg } = binding;
  const probe = await client.targetProbe(pkg.targetProbe.bytes);
  if (probe.outcome !== "TARGET_SUCCESS") return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_TARGET_PROBE_FAILED", executionAttemptConsumed: false, productionMutations: 0, postflightCount: 0 });
  try {
    verifyTargetIdentity({ approvedTargetIdentitySha256: authorization.targetIdentitySha256, observedProbeOutput: probe.observedProbeOutput });
  } catch (error) {
    if (error?.code === "R6_PRODUCTION_RECONCILIATION_TARGET_MISMATCH") return Object.freeze({ classification: error.code, executionAttemptConsumed: false, productionMutations: 0, postflightCount: 0 });
    throw error;
  }
  const reservation = await reserveAttempt({ receiptRoot, authorization, authorizationCandidateSha256: binding.authorizationCandidateSha256, finalConfirmationSha256: binding.finalConfirmationSha256, packageManifestSha256: pkg.manifestSha256 });
  let receipt = reservation;
  const prepared = await client.prepare?.();
  if (prepared?.outcome === "PRE_SUBMIT_FAILURE") {
    receipt = await transitionReceipt({ receiptPath: receipt.path, expectedState: "ATTEMPT_RESERVED", nextState: "FAILED_PRE_SUBMIT", patch: { preSubmitFailure: true } });
    return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_PRE_SUBMIT_FAILURE", executionAttemptConsumed: false, productionMutations: 0, postflightCount: 0, receiptPath: receipt.path });
  }
  receipt = await transitionReceipt({ receiptPath: receipt.path, expectedState: "ATTEMPT_RESERVED", nextState: "SQL_SUBMITTED", patch: { attemptConsumed: true, sqlSha256: pkg.migration.sha256 } });
  const migration = await client.submitMigration(pkg.migration.bytes);
  if (migration.outcome !== "COMMITTED") {
    const state = migration.outcome === "ROLLED_BACK" ? "FAILED_NOT_COMMITTED" : "COMMIT_STATE_UNKNOWN";
    await transitionReceipt({ receiptPath: receipt.path, expectedState: "SQL_SUBMITTED", nextState: state, patch: { attemptConsumed: true, terminalFailure: migration.errorCategory ?? migration.outcome } });
    return Object.freeze({ classification: state === "COMMIT_STATE_UNKNOWN" ? "R6_PRODUCTION_RECONCILIATION_COMMIT_STATE_UNKNOWN" : "R6_PRODUCTION_RECONCILIATION_SQL_ROLLED_BACK", executionAttemptConsumed: true, productionMutations: 0, postflightCount: 0, receiptPath: receipt.path });
  }
  receipt = await transitionReceipt({ receiptPath: receipt.path, expectedState: "SQL_SUBMITTED", nextState: "COMMITTED", patch: { transactionCommitted: true, writesAllowed: false } });
  const postflightOutputPath = path.join(path.dirname(receipt.path), `${authorization.authorizationId}.postflight.csv`);
  const postflight = await client.postflight(pkg.postflight.bytes, { outputPath: postflightOutputPath });
  if (postflight.outcome !== "POSTFLIGHT_SUCCESS") {
    receipt = await transitionReceipt({ receiptPath: receipt.path, expectedState: "COMMITTED", nextState: "POSTFLIGHT_FAILED", patch: { postflightCount: 1, postflightFailure: postflight.errorCategory ?? "POSTFLIGHT_FAILURE" } });
    return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_POSTFLIGHT_FAILED", executionAttemptConsumed: true, productionMutations: "COMMITTED_UNKNOWN_COUNT", postflightCount: 1, receiptPath: receipt.path });
  }
  receipt = await transitionReceipt({ receiptPath: receipt.path, expectedState: "COMMITTED", nextState: "POSTFLIGHT_COMPLETE", patch: { postflightCount: 1, postflightSha256: pkg.postflight.sha256, postflightOutputPath } });
  return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_EXECUTION_AND_POSTFLIGHT_COMPLETE", executionAttemptConsumed: true, productionMutations: "COMMITTED", postflightCount: 1, receiptPath: receipt.path, receiptSha256: hash(await readFile(receipt.path)), postflightOutputPath, finalExecutionBinding: binding.classification });
}

export async function executeWithFinalExecutionGate({ authorizationPath, packageRoot, finalConfirmationPath, receiptRoot, implementationCommit, launcherSha256, transportSha256, clientFactory, sqlClientCapability = inspectNativePsqlCapability() }) {
  if (typeof clientFactory !== "function") fail("R6_PRODUCTION_RECONCILIATION_SQL_CLIENT_FACTORY_INVALID");
  const preparedExecution = await prepareFinalExecution({ authorizationPath, packageRoot, finalConfirmationPath, receiptRoot, implementationCommit, launcherSha256, transportSha256, sqlClientCapability });
  const client = clientFactory();
  return executePrepared({ preparedExecution, client, receiptRoot });
}

export async function executeOnce({ authorizationPath, packageRoot, finalConfirmationPath, receiptRoot, implementationCommit, launcherSha256, transportSha256, client, sqlClientCapability }) {
  return executeWithFinalExecutionGate({ authorizationPath, packageRoot, finalConfirmationPath, receiptRoot, implementationCommit, launcherSha256, transportSha256, sqlClientCapability: sqlClientCapability ?? client?.capability ?? inspectNativePsqlCapability(), clientFactory: () => client });
}

async function main() {
  const [mode, authorizationPath, packageRoot, finalConfirmationPath, receiptRoot] = process.argv.slice(2);
  if (!new Set(["ValidateOnly", "FinalizeHumanConfirmation", "Execute"]).has(mode) || !authorizationPath || !packageRoot || ((mode === "FinalizeHumanConfirmation" || mode === "Execute") && !finalConfirmationPath) || (mode === "Execute" && !receiptRoot)) fail("R6_PRODUCTION_RECONCILIATION_TRANSPORT_INPUT_INVALID");
  const implementationCommit = process.env.R6_PRODUCTION_RECONCILIATION_IMPLEMENTATION_COMMIT;
  const launcherSha256 = process.env.R6_PRODUCTION_RECONCILIATION_LAUNCHER_SHA256;
  const transportSha256 = hash(await readFile(fileURLToPath(import.meta.url)));
  const result = mode === "ValidateOnly"
    ? await validateOnly({ authorizationPath, packageRoot, implementationCommit, launcherSha256, transportSha256 })
    : mode === "FinalizeHumanConfirmation"
      ? await finalizeHumanConfirmation({ authorizationPath, packageRoot, finalConfirmationPath, confirmationPhrase: process.env.R6_PRODUCTION_RECONCILIATION_CONFIRMATION, implementationCommit, launcherSha256, transportSha256 })
      : await executeWithFinalExecutionGate({ authorizationPath, packageRoot, finalConfirmationPath, receiptRoot, implementationCommit, launcherSha256, transportSha256, clientFactory: () => createNativePsqlClient() });
  process.stdout.write(`${JSON.stringify(result)}${os.EOL}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error?.code ?? error?.message ?? "R6_PRODUCTION_RECONCILIATION_TRANSPORT_FAILED"}${os.EOL}`); process.exitCode = 1; });
