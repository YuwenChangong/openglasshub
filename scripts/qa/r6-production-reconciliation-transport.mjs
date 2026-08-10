import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBoundExecutionPackage, safeEqual, TRANSPORT_CONTRACT_VERSION, validatePsqlCapability, fail } from "../lib/r6-production-reconciliation-transport-contract.mjs";
import { assertReceiptEligible, reserveAttempt, transitionReceipt } from "../lib/r6-production-reconciliation-receipt.mjs";
import { verifyRuntimeRoutingIdentity } from "../lib/r6-production-target-identity-v2.mjs";
import { validateAuthorizationV3, validateFinalHumanConfirmationV2 } from "../lib/r6-production-reconciliation-authorization-v3.mjs";

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

async function writeImmutableBytes(file, bytes) {
  if (!path.isAbsolute(String(file ?? ""))) fail("R6_PRODUCTION_RECONCILIATION_EVIDENCE_ROOT_INVALID");
  await mkdir(path.dirname(file), { recursive: true });
  let handle;
  try {
    handle = await open(file, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    return Object.freeze({ path: file, sha256: hash(bytes) });
  } catch (error) {
    if (error?.code === "EEXIST") fail("R6_PRODUCTION_RECONCILIATION_EVIDENCE_ARTIFACT_REPLAY");
    throw error;
  } finally { await handle?.close(); }
}

export function validateRuntimeRoutingBeforeSqlClient({ expectedProjectRef, environment }) {
  let validation;
  try {
    validation = verifyRuntimeRoutingIdentity({ expectedProjectRef, observed: {
      pgUser: environment?.PGUSER, pgDatabase: environment?.PGDATABASE,
      pgHost: environment?.PGHOST, pgPort: environment?.PGPORT,
    } });
  } catch (error) {
    if (error?.code) throw error;
    fail("R6_PRODUCTION_RECONCILIATION_RUNTIME_ROUTING_IDENTITY_INVALID");
  }
  if (!validation.targetMatch) fail("R6_PRODUCTION_RECONCILIATION_RUNTIME_ROUTING_PROJECT_REF_MISMATCH");
  return validation;
}

async function writeRuntimeRoutingEvidence({ preparedExecution, environment }) {
  const expectedProjectRef = preparedExecution.binding.package.manifest.expectedProjectRef;
  const expected = await writeImmutableJson(path.join(preparedExecution.evidence.root, "expected-runtime-routing.json"), {
    schemaVersion: "r6-production-runtime-routing-identity-v1", expectedProjectRef,
    provider: "supabase", database: "postgres",
  });
  const observed = await writeImmutableJson(path.join(preparedExecution.evidence.root, "observed-runtime-routing.json"), {
    schemaVersion: "r6-production-runtime-routing-observation-v1", pgHost: String(environment?.PGHOST ?? ""),
    pgPort: String(environment?.PGPORT ?? ""), pgDatabase: String(environment?.PGDATABASE ?? ""),
    pgUser: String(environment?.PGUSER ?? ""),
  });
  try {
    const result = validateRuntimeRoutingBeforeSqlClient({ expectedProjectRef, environment });
    const validation = await writeImmutableJson(path.join(preparedExecution.evidence.root, "runtime-routing-validation.json"), {
      schemaVersion: "r6-production-runtime-routing-validation-v1", expectedProjectRef,
      observedProjectRef: result.observedRoutingIdentity.parsedProjectRef, match: true,
      classification: "R6_PRODUCTION_RECONCILIATION_RUNTIME_ROUTING_VALID",
      expectedSha256: expected.sha256, observedSha256: observed.sha256,
    });
    return Object.freeze({ valid: true, validation, expected, observed, artifact: validation });
  } catch (error) {
    const classification = error?.code === "R6_PRODUCTION_RECONCILIATION_RUNTIME_ROUTING_PROJECT_REF_MISMATCH"
      ? error.code : "R6_PRODUCTION_RECONCILIATION_RUNTIME_ROUTING_IDENTITY_INVALID";
    const validation = await writeImmutableJson(path.join(preparedExecution.evidence.root, "runtime-routing-validation.json"), {
      schemaVersion: "r6-production-runtime-routing-validation-v1", expectedProjectRef,
      observedProjectRef: null, match: false, classification,
      expectedSha256: expected.sha256, observedSha256: observed.sha256,
    });
    return Object.freeze({ valid: false, classification, expected, observed, artifact: validation });
  }
}

async function establishExecutionEvidence({ evidenceRoot, binding, receiptEligibility, launcherSha256 }) {
  if (!path.isAbsolute(String(evidenceRoot ?? ""))) fail("R6_PRODUCTION_RECONCILIATION_EVIDENCE_ROOT_PRECONNECTION_GATE_FAILED");
  const root = path.resolve(evidenceRoot);
  await mkdir(path.dirname(root), { recursive: true });
  try { await mkdir(root, { recursive: false }); } catch (error) { if (error?.code === "EEXIST") fail("R6_PRODUCTION_RECONCILIATION_EVIDENCE_ROOT_PRECONNECTION_GATE_FAILED"); throw error; }
  const candidate = binding.candidate;
  const preflight = await writeImmutableJson(path.join(root, "production-reconciliation-execution-preflight.json"), {
    schemaVersion: "r6-production-reconciliation-execution-preflight-v1", executionTaskId: candidate.executionTaskId, evidenceRoot: root,
    implementationCommit: candidate.transportImplementationCommit, packageManifestSha256: candidate.packageManifestSha256,
    executionPackageSha256: candidate.executionPackageSha256, candidateId: candidate.authorizationId,
    candidateSha256: binding.authorizationCandidateSha256, finalConfirmationSha256: binding.finalConfirmationSha256,
    launcherSha256, transportContractVersion: TRANSPORT_CONTRACT_VERSION,
    canonicalMigrationSha256: candidate.canonicalMigrationSha256, canonicalPostflightSha256: candidate.canonicalPostflightSha256,
    canonicalTargetProbeSha256: candidate.targetProbeSha256, approvedTargetIdentityCanonicalSha256: candidate.targetIdentityCanonicalSha256,
    receiptReplayEligible: receiptEligibility.eligible === true, sqlClientFactoryCalls: 0, productionConnections: 0, createdAt: new Date().toISOString(),
  });
  const evidenceBinding = await writeImmutableJson(path.join(root, "production-reconciliation-execution-evidence-binding.json"), {
    schemaVersion: "r6-production-reconciliation-execution-evidence-binding-v1", executionTaskId: candidate.executionTaskId,
    evidenceRoot: root, preflightSha256: preflight.sha256, implementationCommit: candidate.transportImplementationCommit,
    packageManifestSha256: candidate.packageManifestSha256, candidateSha256: binding.authorizationCandidateSha256,
    finalConfirmationSha256: binding.finalConfirmationSha256, launcherSha256, transportContractVersion: TRANSPORT_CONTRACT_VERSION,
    canonicalMigrationSha256: candidate.canonicalMigrationSha256, canonicalPostflightSha256: candidate.canonicalPostflightSha256,
    canonicalTargetProbeSha256: candidate.targetProbeSha256, artifactMatrixVersion: "r6-production-reconciliation-execution-evidence-matrix-v1",
    immutable: true, singleUse: true,
  });
  return Object.freeze({ root, preflight, evidenceBinding });
}

async function writeExecutionTerminal({ preparedExecution, classification, targetProbe = null, receipt = null, executionAttemptConsumed = false, transactionState = null, postflight = null, sqlClient = { factoryCalls: 1, connectionCount: 0 } }) {
  const { binding, evidence } = preparedExecution;
  const candidate = binding.candidate;
  return writeImmutableJson(path.join(evidence.root, "production-reconciliation-execution-terminal.json"), {
    schemaVersion: "r6-production-reconciliation-execution-terminal-v1", executionTaskId: candidate.executionTaskId, classification,
    implementationCommit: candidate.transportImplementationCommit, packageManifestSha256: candidate.packageManifestSha256,
    candidateId: candidate.authorizationId, candidateSha256: binding.authorizationCandidateSha256,
    finalConfirmationSha256: binding.finalConfirmationSha256, preflightSha256: evidence.preflight.sha256,
    evidenceBindingSha256: evidence.evidenceBinding.sha256, targetProbe, receipt,
    sqlClient: { ...sqlClient, type: candidate.sqlClientCapability, version: candidate.sqlClientVersion },
    execution: { attemptCount: executionAttemptConsumed ? 1 : 0, attemptConsumed: executionAttemptConsumed, sqlSubmitted: executionAttemptConsumed, transactionState, retryCount: 0 },
    postflight, repositoryChanges: 0, historyRepairs: 0, deployment: 0, terminalAt: new Date().toISOString(),
  });
}

async function writeReceiptReference({ preparedExecution, receipt }) {
  const bytes = await readFile(receipt.path).catch(() => fail("R6_PRODUCTION_RECONCILIATION_RECEIPT_MISSING"));
  const authoritative = JSON.parse(bytes.toString("utf8"));
  if (authoritative.executionTaskId !== preparedExecution.binding.candidate.executionTaskId
    || authoritative.authorizationCandidateSha256 !== preparedExecution.binding.authorizationCandidateSha256
    || authoritative.finalConfirmationSha256 !== preparedExecution.binding.finalConfirmationSha256) {
    fail("R6_PRODUCTION_RECONCILIATION_RECEIPT_INVALID");
  }
  return writeImmutableJson(path.join(preparedExecution.evidence.root, "production-reconciliation-receipt-reference.json"), {
    schemaVersion: "r6-production-reconciliation-receipt-reference-v1",
    executionTaskId: authoritative.executionTaskId,
    candidateSha256: authoritative.authorizationCandidateSha256,
    finalConfirmationSha256: authoritative.finalConfirmationSha256,
    receiptAuthorityPath: receipt.path,
    receiptSha256: hash(bytes),
    receiptState: authoritative.state,
    immutable: true,
  });
}

async function writePostflightEvidence({ preparedExecution, outputPath, canonicalPostflightSha256 }) {
  const raw = await readFile(outputPath).catch(() => fail("R6_PRODUCTION_RECONCILIATION_POSTFLIGHT_RAW_EVIDENCE_FAILED"));
  const rawArtifact = Object.freeze({ path: outputPath, sha256: hash(raw) });
  const fingerprint = await writeImmutableJson(path.join(preparedExecution.evidence.root, "production-reconciliation-postflight-fingerprint.json"), {
    schemaVersion: "r6-production-reconciliation-postflight-fingerprint-v1", rawPostflightSha256: rawArtifact.sha256,
    canonicalPostflightSha256, byteLength: raw.length,
  });
  const comparison = await writeImmutableJson(path.join(preparedExecution.evidence.root, "production-reconciliation-postflight-comparison.json"), {
    schemaVersion: "r6-production-reconciliation-postflight-comparison-v1", rawPostflightSha256: rawArtifact.sha256,
    fingerprintSha256: fingerprint.sha256, comparisonSource: "PERSISTED_RAW_POSTFLIGHT", immutable: true,
  });
  const terminal = await writeImmutableJson(path.join(preparedExecution.evidence.root, "production-reconciliation-postflight-terminal.json"), {
    schemaVersion: "r6-production-reconciliation-postflight-terminal-v1", classification: "R6_PRODUCTION_RECONCILIATION_POSTFLIGHT_EVIDENCE_READY",
    rawPostflightSha256: rawArtifact.sha256, fingerprintSha256: fingerprint.sha256, comparisonSha256: comparison.sha256, executions: 1,
  });
  return Object.freeze({ rawArtifact, fingerprint, comparison, terminal });
}

async function loadCandidate({ authorizationPath, implementationCommit, launcherSha256, transportSha256, sqlClientCapability }) {
  const artifact = await readJsonArtifact(authorizationPath, "R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_MISSING");
  const candidate = validateAuthorizationV3(artifact.value);
  if (candidate.transportImplementationCommit !== implementationCommit || candidate.transportLauncherSha256 !== launcherSha256 || candidate.transportSha256 !== transportSha256) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_V3_BINDING_FAILED");
  return Object.freeze({ ...artifact, candidate });
}

async function loadPackageForCandidate(candidate, packageRoot) {
  return loadBoundExecutionPackage({
    packageRoot,
    expectedExecutionPackageSha256: candidate.executionPackageSha256,
    expectedPackageManifestSha256: candidate.packageManifestSha256,
    expectedImplementationCommit: candidate.transportImplementationCommit,
    expectedLauncherSha256: candidate.transportLauncherSha256,
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
    schemaVersion: "qa-production-reconciliation-final-human-confirmation-v2",
    authorizationCandidateSha256: candidateArtifact.sha256,
    authorizationCandidateId: candidateArtifact.candidate.authorizationId,
    implementationCommit,
    packageSchemaVersion: candidateArtifact.candidate.packageSchemaVersion,
    packageManifestSha256: candidateArtifact.candidate.packageManifestSha256,
    executionPackageSha256: candidateArtifact.candidate.executionPackageSha256,
    transportImplementationCommit: candidateArtifact.candidate.transportImplementationCommit,
    transportLauncherSha256: candidateArtifact.candidate.transportLauncherSha256,
    targetIdentitySchemaVersion: candidateArtifact.candidate.targetIdentitySchemaVersion,
    targetIdentityCanonicalSha256: candidateArtifact.candidate.targetIdentityCanonicalSha256,
    runtimeRoutingSchemaVersion: candidateArtifact.candidate.runtimeRoutingSchemaVersion,
    runtimeRoutingArtifactSha256: candidateArtifact.candidate.runtimeRoutingArtifactSha256,
    expectedProjectRef: candidateArtifact.candidate.expectedProjectRef,
    canonicalMigrationSha256: candidateArtifact.candidate.canonicalMigrationSha256,
    canonicalPostflightSha256: candidateArtifact.candidate.canonicalPostflightSha256,
    targetProbeSha256: candidateArtifact.candidate.targetProbeSha256,
    requiredConfirmationSha256: candidateArtifact.candidate.requiredConfirmationSha256,
    confirmedPhraseSha256: hash(confirmationPhrase),
    singleUse: true,
    attempts: 1,
    retry: 0,
    automaticRollback: 0,
    confirmedAt: now,
    immutable: true,
  };
  validateFinalHumanConfirmationV2(finalConfirmation, { candidate: candidateArtifact.candidate, candidateSha256: candidateArtifact.sha256 });
  const artifact = await writeImmutableJson(finalConfirmationPath, finalConfirmation);
  return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_FINAL_HUMAN_CONFIRMATION_CREATED", executionAttemptConsumed: false, receiptConsumed: false, networkConnections: 0, authorizationCandidateSha256: candidateArtifact.sha256, finalConfirmationSha256: artifact.sha256, finalConfirmationPath: artifact.path });
}

export async function validateFinalExecutionBinding({ authorizationPath, packageRoot, finalConfirmationPath, implementationCommit, launcherSha256, transportSha256, sqlClientCapability = inspectNativePsqlCapability() }) {
  const candidateArtifact = await loadCandidate({ authorizationPath, implementationCommit, launcherSha256, transportSha256, sqlClientCapability });
  const finalArtifact = await readJsonArtifact(finalConfirmationPath, "R6_PRODUCTION_RECONCILIATION_FINAL_HUMAN_CONFIRMATION_REQUIRED");
  const finalConfirmation = validateFinalHumanConfirmationV2(finalArtifact.value, { candidate: candidateArtifact.candidate, candidateSha256: candidateArtifact.sha256 });
  const pkg = await loadPackageForCandidate(candidateArtifact.candidate, packageRoot);
  return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_FINAL_EXECUTION_BINDING_READY", executionAttemptConsumed: false, receiptConsumed: false, networkConnections: 0, authorizationCandidateSha256: candidateArtifact.sha256, finalConfirmationSha256: finalArtifact.sha256, candidate: candidateArtifact.candidate, finalConfirmation, package: pkg });
}

export async function prepareFinalExecution({ authorizationPath, packageRoot, finalConfirmationPath, receiptRoot, evidenceRoot, implementationCommit, launcherSha256, transportSha256, sqlClientCapability = inspectNativePsqlCapability() }) {
  const binding = await validateFinalExecutionBinding({ authorizationPath, packageRoot, finalConfirmationPath, implementationCommit, launcherSha256, transportSha256, sqlClientCapability });
  const { candidate: authorization, package: pkg } = binding;
  const receiptEligibility = await assertReceiptEligible({ receiptRoot, authorizationId: authorization.authorizationId });
  const ownedEvidenceRoot = evidenceRoot ?? path.join(path.resolve(receiptRoot), "execution-evidence", authorization.executionTaskId);
  const evidence = await establishExecutionEvidence({ evidenceRoot: ownedEvidenceRoot, binding, receiptEligibility, launcherSha256 });
  return Object.freeze({
    invariant: "EVIDENCE_ROOT_CREATED_AND_BOUND_BEFORE_SQL_CLIENT",
    classification: binding.classification,
    binding,
    receiptEligibility,
    evidence,
  });
}

export async function executePrepared({ preparedExecution, client, receiptRoot }) {
  if (!preparedExecution || preparedExecution.invariant !== "EVIDENCE_ROOT_CREATED_AND_BOUND_BEFORE_SQL_CLIENT" || preparedExecution.classification !== "R6_PRODUCTION_RECONCILIATION_FINAL_EXECUTION_BINDING_READY" || !preparedExecution.evidence?.evidenceBinding) fail("R6_PRODUCTION_RECONCILIATION_PREBIND_SQL_CLIENT_BOUNDARY_FAILED");
  if (!client || typeof client.targetProbe !== "function" || typeof client.submitMigration !== "function" || typeof client.postflight !== "function") fail("R6_PRODUCTION_RECONCILIATION_SQL_CLIENT_INVALID");
  const binding = preparedExecution.binding;
  const { candidate: authorization, package: pkg } = binding;
  let probe;
  try { probe = await client.targetProbe(pkg.targetProbe.bytes); }
  catch (error) {
    const rawProbeArtifact = error?.rawBytes ? await writeImmutableBytes(path.join(preparedExecution.evidence.root, "production-reconciliation-target-probe-raw.txt"), error.rawBytes) : null;
    await writeExecutionTerminal({ preparedExecution, classification: "R6_PRODUCTION_RECONCILIATION_TARGET_PROBE_FAILED", targetProbe: { executedCount: 1, rawSha256: rawProbeArtifact?.sha256 ?? null, match: null } });
    return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_TARGET_PROBE_FAILED", executionAttemptConsumed: false, productionMutations: 0, postflightCount: 0, targetProbeRawSha256: rawProbeArtifact?.sha256 ?? null });
  }
  const rawProbe = probe.rawBytes ?? (typeof probe.observedProbeOutput === "string" ? Buffer.from(probe.observedProbeOutput, "utf8") : null);
  const rawProbeArtifact = rawProbe ? await writeImmutableBytes(path.join(preparedExecution.evidence.root, "production-reconciliation-target-probe-raw.txt"), rawProbe) : null;
  if (probe.outcome !== "TARGET_SUCCESS") {
    await writeExecutionTerminal({ preparedExecution, classification: "R6_PRODUCTION_RECONCILIATION_TARGET_PROBE_FAILED", targetProbe: { executedCount: 1, rawSha256: rawProbeArtifact?.sha256 ?? null, match: null } });
    return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_TARGET_PROBE_FAILED", executionAttemptConsumed: false, productionMutations: 0, postflightCount: 0, targetProbeRawSha256: rawProbeArtifact?.sha256 ?? null });
  }
  const targetValidation = await writeImmutableJson(path.join(preparedExecution.evidence.root, "production-reconciliation-target-validation.json"), {
    schemaVersion: "r6-production-reconciliation-target-validation-v1", executionTaskId: authorization.executionTaskId,
    rawTargetProbeSha256: rawProbeArtifact?.sha256 ?? null, approvedTargetIdentityCanonicalSha256: authorization.targetIdentityCanonicalSha256,
    databaseCorroboration: "PRESENT", probeExecutionCount: 1, readOnly: true,
  });
  const reservation = await reserveAttempt({ receiptRoot, authorization, authorizationCandidateSha256: binding.authorizationCandidateSha256, finalConfirmationSha256: binding.finalConfirmationSha256, packageManifestSha256: pkg.manifestSha256 });
  let receipt = reservation;
  const receiptReference = await writeReceiptReference({ preparedExecution, receipt });
  const prepared = await client.prepare?.();
  if (prepared?.outcome === "PRE_SUBMIT_FAILURE") {
    receipt = await transitionReceipt({ receiptPath: receipt.path, expectedState: "ATTEMPT_RESERVED", nextState: "FAILED_PRE_SUBMIT", patch: { preSubmitFailure: true } });
    await writeExecutionTerminal({ preparedExecution, classification: "R6_PRODUCTION_RECONCILIATION_PRE_SUBMIT_FAILURE", receipt: { path: receipt.path, state: "FAILED_PRE_SUBMIT", referenceSha256: receiptReference.sha256 } });
    return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_PRE_SUBMIT_FAILURE", executionAttemptConsumed: false, productionMutations: 0, postflightCount: 0, receiptPath: receipt.path });
  }
  receipt = await transitionReceipt({ receiptPath: receipt.path, expectedState: "ATTEMPT_RESERVED", nextState: "SQL_SUBMITTED", patch: { attemptConsumed: true, sqlSha256: pkg.migration.sha256 } });
  const migration = await client.submitMigration(pkg.migration.bytes);
  if (migration.outcome !== "COMMITTED") {
    const state = migration.outcome === "ROLLED_BACK" ? "FAILED_NOT_COMMITTED" : "COMMIT_STATE_UNKNOWN";
    await transitionReceipt({ receiptPath: receipt.path, expectedState: "SQL_SUBMITTED", nextState: state, patch: { attemptConsumed: true, terminalFailure: migration.errorCategory ?? migration.outcome } });
    await writeExecutionTerminal({ preparedExecution, classification: state === "COMMIT_STATE_UNKNOWN" ? "R6_PRODUCTION_RECONCILIATION_COMMIT_STATE_UNKNOWN" : "R6_PRODUCTION_RECONCILIATION_SQL_ROLLED_BACK", receipt: { path: receipt.path, state, referenceSha256: receiptReference.sha256 }, executionAttemptConsumed: true, transactionState: state });
    return Object.freeze({ classification: state === "COMMIT_STATE_UNKNOWN" ? "R6_PRODUCTION_RECONCILIATION_COMMIT_STATE_UNKNOWN" : "R6_PRODUCTION_RECONCILIATION_SQL_ROLLED_BACK", executionAttemptConsumed: true, productionMutations: 0, postflightCount: 0, receiptPath: receipt.path });
  }
  receipt = await transitionReceipt({ receiptPath: receipt.path, expectedState: "SQL_SUBMITTED", nextState: "COMMITTED", patch: { transactionCommitted: true, writesAllowed: false } });
  const postflightOutputPath = path.join(preparedExecution.evidence.root, "production-reconciliation-postflight-raw.csv");
  const postflight = await client.postflight(pkg.postflight.bytes, { outputPath: postflightOutputPath });
  if (postflight.outcome !== "POSTFLIGHT_SUCCESS") {
    receipt = await transitionReceipt({ receiptPath: receipt.path, expectedState: "COMMITTED", nextState: "POSTFLIGHT_FAILED", patch: { postflightCount: 1, postflightFailure: postflight.errorCategory ?? "POSTFLIGHT_FAILURE" } });
    await writeExecutionTerminal({ preparedExecution, classification: "R6_PRODUCTION_RECONCILIATION_POSTFLIGHT_FAILED", receipt: { path: receipt.path, state: "POSTFLIGHT_FAILED", referenceSha256: receiptReference.sha256 }, executionAttemptConsumed: true, transactionState: "COMMITTED", postflight: { executedCount: 1, rawSha256: null } });
    return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_POSTFLIGHT_FAILED", executionAttemptConsumed: true, productionMutations: "COMMITTED_UNKNOWN_COUNT", postflightCount: 1, receiptPath: receipt.path });
  }
  const postflightEvidence = await writePostflightEvidence({ preparedExecution, outputPath: postflightOutputPath, canonicalPostflightSha256: pkg.postflight.sha256 });
  if (postflight.comparison?.matchesExpected === false) {
    receipt = await transitionReceipt({ receiptPath: receipt.path, expectedState: "COMMITTED", nextState: "POSTFLIGHT_SCHEMA_MISMATCH", patch: { postflightCount: 1, postflightSha256: pkg.postflight.sha256, postflightOutputPath: postflightEvidence.rawArtifact.path } });
    await writeExecutionTerminal({ preparedExecution, classification: "R6_PRODUCTION_RECONCILIATION_POSTFLIGHT_SCHEMA_MISMATCH_REQUIRES_REVIEW", receipt: { path: receipt.path, sha256: hash(await readFile(receipt.path)), state: "POSTFLIGHT_SCHEMA_MISMATCH", referenceSha256: receiptReference.sha256 }, executionAttemptConsumed: true, transactionState: "COMMITTED", postflight: { executedCount: 1, rawSha256: postflightEvidence.rawArtifact.sha256, fingerprintSha256: postflightEvidence.fingerprint.sha256, comparisonSha256: postflightEvidence.comparison.sha256, matchesExpected: false } });
    return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_POSTFLIGHT_SCHEMA_MISMATCH_REQUIRES_REVIEW", executionAttemptConsumed: true, productionMutations: "COMMITTED", postflightCount: 1, receiptPath: receipt.path, retryCount: 0 });
  }
  receipt = await transitionReceipt({ receiptPath: receipt.path, expectedState: "COMMITTED", nextState: "POSTFLIGHT_COMPLETE", patch: { postflightCount: 1, postflightSha256: pkg.postflight.sha256, postflightOutputPath: postflightEvidence.rawArtifact.path } });
  const result = Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_EXECUTION_AND_POSTFLIGHT_COMPLETE", executionAttemptConsumed: true, productionMutations: "COMMITTED", postflightCount: 1, receiptPath: receipt.path, receiptSha256: hash(await readFile(receipt.path)), postflightOutputPath, finalExecutionBinding: binding.classification });
  await writeExecutionTerminal({ preparedExecution, classification: result.classification, targetProbe: { executedCount: 1, rawSha256: rawProbeArtifact?.sha256 ?? null, validationSha256: targetValidation.sha256, approvedIdentityCanonicalSha256: authorization.targetIdentityCanonicalSha256, databaseCorroboration: "PRESENT" }, receipt: { path: receipt.path, sha256: result.receiptSha256, state: "POSTFLIGHT_COMPLETE", referenceSha256: receiptReference.sha256 }, executionAttemptConsumed: true, transactionState: "COMMITTED", postflight: { executedCount: 1, rawSha256: postflightEvidence.rawArtifact.sha256, fingerprintSha256: postflightEvidence.fingerprint.sha256, comparisonSha256: postflightEvidence.comparison.sha256 } });
  return result;
}

export async function executeWithFinalExecutionGate({ authorizationPath, packageRoot, finalConfirmationPath, receiptRoot, evidenceRoot, implementationCommit, launcherSha256, transportSha256, clientFactory, environment = process.env, sqlClientCapability = inspectNativePsqlCapability() }) {
  if (typeof clientFactory !== "function") fail("R6_PRODUCTION_RECONCILIATION_SQL_CLIENT_FACTORY_INVALID");
  const preparedExecution = await prepareFinalExecution({ authorizationPath, packageRoot, finalConfirmationPath, receiptRoot, evidenceRoot, implementationCommit, launcherSha256, transportSha256, sqlClientCapability });
  const routing = await writeRuntimeRoutingEvidence({ preparedExecution, environment });
  if (!routing.valid) {
    const terminal = await writeExecutionTerminal({ preparedExecution, classification: routing.classification, sqlClient: { factoryCalls: 0, connectionCount: 0 } });
    return Object.freeze({ classification: routing.classification, executionAttemptConsumed: false, productionMutations: 0, postflightCount: 0, retryCount: 0, sqlClientFactoryCalls: 0, evidenceRoot: preparedExecution.evidence.root, executionTerminalPath: terminal.path, executionTerminalSha256: terminal.sha256 });
  }
  let client;
  try { client = clientFactory(); }
  catch (error) {
    const classification = error?.code === "R6_PRODUCTION_RECONCILIATION_SECURE_CONNECTION_CHANNEL_UNAVAILABLE"
      ? error.code
      : "R6_PRODUCTION_RECONCILIATION_SQL_CLIENT_FACTORY_FAILED";
    const terminal = await writeExecutionTerminal({ preparedExecution, classification, sqlClient: { factoryCalls: 1, connectionCount: 0 } });
    return Object.freeze({ classification, executionAttemptConsumed: false, productionMutations: 0, postflightCount: 0, retryCount: 0, evidenceRoot: preparedExecution.evidence.root, executionTerminalPath: terminal.path, executionTerminalSha256: terminal.sha256 });
  }
  return executePrepared({ preparedExecution, client, receiptRoot });
}

export async function executeOnce({ authorizationPath, packageRoot, finalConfirmationPath, receiptRoot, evidenceRoot, implementationCommit, launcherSha256, transportSha256, client, environment = process.env, sqlClientCapability }) {
  return executeWithFinalExecutionGate({ authorizationPath, packageRoot, finalConfirmationPath, receiptRoot, evidenceRoot, implementationCommit, launcherSha256, transportSha256, environment, sqlClientCapability: sqlClientCapability ?? client?.capability ?? inspectNativePsqlCapability(), clientFactory: () => client });
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
