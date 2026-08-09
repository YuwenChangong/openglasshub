import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AUTHORIZATION_VERSION, CANONICAL_MIGRATION_BYTES, CANONICAL_MIGRATION_SHA256, PACKAGE_VERSION, POSTFLIGHT_SHA256, TRANSPORT_CONTRACT_VERSION } from "./lib/r6-production-reconciliation-transport-contract.mjs";
import { targetIdentityHash, TARGET_PROBE_SQL, targetProbeSha256 } from "./lib/r6-production-reconciliation-target.mjs";
import { createNativePsqlClient, executeOnce, executeWithFinalExecutionGate, finalizeHumanConfirmation, inspectNativePsqlCapability, validateFinalExecutionBinding, validateOnly } from "./qa/r6-production-reconciliation-transport.mjs";
import { resolveCanonicalGitBlob } from "./lib/canonical-git-blob.mjs";

const root = process.cwd();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const commit = "a".repeat(40);
const launcherSha256 = "b".repeat(64);
const transportSha256 = "c".repeat(64);
const confirmation = "transport-test-confirmation";
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

async function fixture() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "r6-production-transport-"));
  const packageRoot = path.join(temp, "package");
  await mkdir(packageRoot, { recursive: true });
  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const migration = resolveCanonicalGitBlob({ repositoryRoot: root, implementationCommit: currentCommit, repositoryRelativePath: "supabase/migrations/20260807073929_reconcile_production_schema_drift.sql" }).bytes;
  const postflight = resolveCanonicalGitBlob({ repositoryRoot: root, implementationCommit: currentCommit, repositoryRelativePath: "docs/ops/legal-consent-production-schema-fingerprint.sql" }).bytes;
  assert.equal(hash(migration), CANONICAL_MIGRATION_SHA256); assert.equal(migration.length, CANONICAL_MIGRATION_BYTES); assert.equal(hash(postflight), POSTFLIGHT_SHA256);
  await Promise.all([writeFile(path.join(packageRoot, "canonical-migration.sql"), migration), writeFile(path.join(packageRoot, "canonical-postflight.sql"), postflight), writeFile(path.join(packageRoot, "canonical-target-probe.sql"), TARGET_PROBE_SQL)]);
  const executionManifest = { schemaVersion: PACKAGE_VERSION, transportContractVersion: TRANSPORT_CONTRACT_VERSION, migration: { artifact: "canonical-migration.sql", sha256: CANONICAL_MIGRATION_SHA256, bytes: CANONICAL_MIGRATION_BYTES }, postflight: { artifact: "canonical-postflight.sql", sha256: POSTFLIGHT_SHA256 }, targetProbe: { artifact: "canonical-target-probe.sql", sha256: targetProbeSha256() } };
  const executionPackagePath = path.join(packageRoot, "production-reconciliation-execution-package.json");
  const packageManifestPath = path.join(packageRoot, "production-reconciliation-package-manifest.json");
  await Promise.all([writeFile(executionPackagePath, JSON.stringify(executionManifest)), writeFile(packageManifestPath, JSON.stringify({ schemaVersion: "test-outer-package-v1", executionPackage: path.basename(executionPackagePath) }))]);
  const observed = '{"database":"postgres","serverVersionNum":"170000","sessionUser":"postgres"}';
  const sqlClientCapability = inspectNativePsqlCapability();
  const authorization = { schemaVersion: AUTHORIZATION_VERSION, authorizationId: randomUUID(), executionTaskId: randomUUID(), authorizationState: "AWAITING_FINAL_HUMAN_CONFIRMATION", executionEligible: false, immutable: true, packageManifestSha256: hash(await readFile(packageManifestPath)), executionPackageSha256: hash(await readFile(executionPackagePath)), transportImplementationCommit: commit, transportLauncherSha256: launcherSha256, transportSha256, targetIdentitySha256: targetIdentityHash(observed), canonicalMigrationSha256: CANONICAL_MIGRATION_SHA256, canonicalPostflightSha256: POSTFLIGHT_SHA256, targetProbeSha256: targetProbeSha256(), requiredConfirmationSha256: hash(confirmation), transportContractVersion: TRANSPORT_CONTRACT_VERSION, sqlClientCapability: "PSQL_NATIVE", sqlClientVersion: sqlClientCapability.version, sqlClientExecutablePath: sqlClientCapability.executablePath, sqlClientExecutableSha256: sqlClientCapability.executableSha256, attempts: 1, automaticRetry: 0, automaticRollback: 0 };
  const authorizationPath = path.join(temp, "candidate.json"); await writeFile(authorizationPath, JSON.stringify(authorization));
  return { temp, packageRoot, authorization, authorizationPath, observed, migration, sqlClientCapability };
}

const core = (f) => ({ authorizationPath: f.authorizationPath, packageRoot: f.packageRoot, implementationCommit: commit, launcherSha256, transportSha256, sqlClientCapability: f.sqlClientCapability });
const fake = (observed, outcome = "COMMITTED", counters = { target: 0 }) => ({ capability: inspectNativePsqlCapability(), targetProbe: async () => { counters.target += 1; return { outcome: "TARGET_SUCCESS", observedProbeOutput: observed }; }, prepare: async () => ({ outcome: "READY" }), submitMigration: async () => ({ outcome }), postflight: async (_bytes, { outputPath } = {}) => { if (outputPath) await writeFile(outputPath, "test-postflight-raw\n"); return { outcome: "POSTFLIGHT_SUCCESS" }; } });
const finalize = (f, finalConfirmationPath, phrase = confirmation) => finalizeHumanConfirmation({ ...core(f), finalConfirmationPath, confirmationPhrase: phrase });
const executeWithSpy = (f, { finalConfirmationPath, receiptRoot, client, factoryCalls, sqlClientCapability = f.sqlClientCapability }) => executeWithFinalExecutionGate({ ...core(f), finalConfirmationPath, receiptRoot, sqlClientCapability, clientFactory: () => { factoryCalls.count += 1; return client; } });

const fixtures = [];
try {
  const capability = inspectNativePsqlCapability(); assert.equal(capability.type, "PSQL_NATIVE");
  assert.throws(() => createNativePsqlClient({ environment: { PGHOST: "host", PGPORT: "5432", PGDATABASE: "postgres", PGUSER: "postgres", PGPASSWORD: "secret", DATABASE_URL: "postgresql://unsafe" }, capability }), /R6_PRODUCTION_RECONCILIATION_CONNECTION_STRING_CHANNEL_FORBIDDEN/);
  const f = await fixture(); fixtures.push(f);
  const candidate = await validateOnly(core(f)); assert.equal(candidate.classification, "R6_PRODUCTION_RECONCILIATION_CANDIDATE_VALIDATED_AWAITING_FINAL_HUMAN_CONFIRMATION"); assert.equal(candidate.networkConnections, 0);
  await writeFile(path.join(f.temp, "legacy-v1.json"), JSON.stringify({ schemaVersion: "r6-production-reconciliation-execution-authorization-v1" }));
  await assert.rejects(validateOnly({ ...core(f), authorizationPath: path.join(f.temp, "legacy-v1.json") }), /R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_TRANSPORT_VERSION_MISMATCH/);
  await assert.rejects(validateOnly({ ...core(f), authorizationPath: path.join(f.temp, "missing.json") }), /R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_MISSING/);
  const counters = { target: 0 }; const candidateOnlyFactory = { count: 0 };
  await assert.rejects(executeWithSpy(f, { finalConfirmationPath: path.join(f.temp, "absent-final.json"), receiptRoot: path.join(f.temp, "receipts"), client: fake(f.observed, "COMMITTED", counters), factoryCalls: candidateOnlyFactory }), /R6_PRODUCTION_RECONCILIATION_FINAL_HUMAN_CONFIRMATION_REQUIRED/);
  assert.equal(candidateOnlyFactory.count, 0, "candidate-only Execute must not create a SQL client");
  assert.equal(counters.target, 0, "candidate plus raw phrase must reject before target probe");
  for (const [index, wrongPhrase] of [`${confirmation} `, `${confirmation}\n`, confirmation.toUpperCase(), `${confirmation}\u0301`].entries()) {
    const wrongFinal = path.join(f.temp, `wrong-final-${index}.json`);
    await assert.rejects(finalize(f, wrongFinal, wrongPhrase), /R6_PRODUCTION_RECONCILIATION_CONFIRMATION_INVALID/);
    await assert.rejects(readFile(wrongFinal), /ENOENT/);
  }
  const fOther = await fixture(); fixtures.push(fOther);
  const otherFinal = path.join(fOther.temp, "final.json"); await finalize(fOther, otherFinal);
  const crossCandidateFactory = { count: 0 };
  await assert.rejects(executeWithSpy(f, { finalConfirmationPath: otherFinal, receiptRoot: path.join(f.temp, "receipts-other"), client: fake(f.observed), factoryCalls: crossCandidateFactory }), /R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_BINDING_FAILED/);
  assert.equal(crossCandidateFactory.count, 0, "cross-candidate final artifact must fail before SQL client creation");
  assert.equal(counters.target, 0);
  const finalPath = path.join(f.temp, "final.json");
  const finalized = await finalize(f, finalPath); assert.equal(finalized.networkConnections, 0); assert.equal(finalized.receiptConsumed, false);
  assert.doesNotMatch(await readFile(finalPath, "utf8"), new RegExp(confirmation));
  await assert.rejects(finalize(f, finalPath), /R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_REPLAY/);
  const combined = await validateFinalExecutionBinding({ ...core(f), finalConfirmationPath: finalPath }); assert.equal(combined.classification, "R6_PRODUCTION_RECONCILIATION_FINAL_EXECUTION_BINDING_READY");
  const validFactory = { count: 0 };
  const mismatch = await executeWithSpy(f, { finalConfirmationPath: finalPath, receiptRoot: path.join(f.temp, "receipts-mismatch"), client: fake("wrong"), factoryCalls: validFactory }); assert.equal(mismatch.executionAttemptConsumed, false); assert.equal(validFactory.count, 1, "valid candidate and final may create exactly one SQL client");
  const missingEnvironmentFactory = { count: 0 };
  const factoryFailureRoot = path.join(f.temp, "factory-failure-evidence");
  const factoryFailure = await executeWithFinalExecutionGate({ ...core(f), finalConfirmationPath: finalPath, receiptRoot: path.join(f.temp, "receipts-missing-environment"), evidenceRoot: factoryFailureRoot, clientFactory: () => { missingEnvironmentFactory.count += 1; throw Object.assign(new Error("R6_PRODUCTION_RECONCILIATION_SECURE_CONNECTION_CHANNEL_UNAVAILABLE"), { code: "R6_PRODUCTION_RECONCILIATION_SECURE_CONNECTION_CHANNEL_UNAVAILABLE" }); } });
  assert.equal(factoryFailure.classification, "R6_PRODUCTION_RECONCILIATION_SECURE_CONNECTION_CHANNEL_UNAVAILABLE");
  assert.equal(missingEnvironmentFactory.count, 1, "secure connection requirements may run only after a valid final binding");
  const factoryPreflight = await readJson(path.join(factoryFailureRoot, "production-reconciliation-execution-preflight.json"));
  const factoryBinding = await readJson(path.join(factoryFailureRoot, "production-reconciliation-execution-evidence-binding.json"));
  const factoryTerminal = await readJson(path.join(factoryFailureRoot, "production-reconciliation-execution-terminal.json"));
  assert.equal(factoryPreflight.sqlClientFactoryCalls, 0); assert.equal(factoryBinding.preflightSha256, hash(await readFile(path.join(factoryFailureRoot, "production-reconciliation-execution-preflight.json"))));
  assert.equal(factoryTerminal.execution.attemptConsumed, false); assert.equal(factoryTerminal.execution.retryCount, 0); assert.equal(factoryTerminal.sqlClient.factoryCalls, 1); assert.equal(factoryTerminal.sqlClient.connectionCount, 0);
  const fIllegal = await fixture(); fixtures.push(fIllegal); fIllegal.authorization.executionEligible = true; await writeFile(fIllegal.authorizationPath, JSON.stringify(fIllegal.authorization));
  await assert.rejects(validateOnly(core(fIllegal)), /R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ILLEGAL_EXECUTABLE_CANDIDATE/);
  const illegalFactory = { count: 0 };
  await assert.rejects(executeWithSpy(fIllegal, { finalConfirmationPath: path.join(fIllegal.temp, "absent-final.json"), receiptRoot: path.join(fIllegal.temp, "receipts"), client: fake(fIllegal.observed), factoryCalls: illegalFactory }), /R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ILLEGAL_EXECUTABLE_CANDIDATE/);
  assert.equal(illegalFactory.count, 0, "illegal candidates must fail before SQL client creation");
  const fPackage = await fixture(); fixtures.push(fPackage); const fPackageFinal = path.join(fPackage.temp, "final.json"); await finalize(fPackage, fPackageFinal); fPackage.authorization.executionPackageSha256 = "0".repeat(64); await writeFile(fPackage.authorizationPath, JSON.stringify(fPackage.authorization));
  const packageFactory = { count: 0 };
  await assert.rejects(executeWithSpy(fPackage, { finalConfirmationPath: fPackageFinal, receiptRoot: path.join(fPackage.temp, "receipts"), client: fake(fPackage.observed), factoryCalls: packageFactory }), /R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_BINDING_FAILED/);
  assert.equal(packageFactory.count, 0, "package-bound final mismatch must fail before SQL client creation");
  const fPre = await fixture(); fixtures.push(fPre); const fPreFinal = path.join(fPre.temp, "final.json"); await finalize(fPre, fPreFinal);
  const pre = await executeOnce({ ...core(fPre), finalConfirmationPath: fPreFinal, receiptRoot: path.join(fPre.temp, "receipts"), client: { ...fake(fPre.observed), prepare: async () => ({ outcome: "PRE_SUBMIT_FAILURE" }) } }); assert.equal(pre.executionAttemptConsumed, false);
  const fRollback = await fixture(); fixtures.push(fRollback); const fRollbackFinal = path.join(fRollback.temp, "final.json"); await finalize(fRollback, fRollbackFinal);
  const rollback = await executeOnce({ ...core(fRollback), finalConfirmationPath: fRollbackFinal, receiptRoot: path.join(fRollback.temp, "receipts"), client: fake(fRollback.observed, "ROLLED_BACK") }); assert.equal(rollback.executionAttemptConsumed, true);
  const fUnknown = await fixture(); fixtures.push(fUnknown); const fUnknownFinal = path.join(fUnknown.temp, "final.json"); await finalize(fUnknown, fUnknownFinal);
  const unknown = await executeOnce({ ...core(fUnknown), finalConfirmationPath: fUnknownFinal, receiptRoot: path.join(fUnknown.temp, "receipts"), client: fake(fUnknown.observed, "COMMIT_STATE_UNKNOWN") }); assert.equal(unknown.classification, "R6_PRODUCTION_RECONCILIATION_COMMIT_STATE_UNKNOWN"); assert.equal(unknown.executionAttemptConsumed, true);
  const fProbeFailure = await fixture(); fixtures.push(fProbeFailure); const fProbeFailureFinal = path.join(fProbeFailure.temp, "final.json"); await finalize(fProbeFailure, fProbeFailureFinal);
  const probeFailure = await executeOnce({ ...core(fProbeFailure), finalConfirmationPath: fProbeFailureFinal, receiptRoot: path.join(fProbeFailure.temp, "receipts"), client: { ...fake(fProbeFailure.observed), targetProbe: async () => { throw new Error("transport down"); } } }); assert.equal(probeFailure.classification, "R6_PRODUCTION_RECONCILIATION_TARGET_PROBE_FAILED"); assert.equal(probeFailure.targetProbeRawSha256, null);
  const fPostflightFailure = await fixture(); fixtures.push(fPostflightFailure); const fPostflightFailureFinal = path.join(fPostflightFailure.temp, "final.json"); await finalize(fPostflightFailure, fPostflightFailureFinal);
  const postflightFailure = await executeOnce({ ...core(fPostflightFailure), finalConfirmationPath: fPostflightFailureFinal, receiptRoot: path.join(fPostflightFailure.temp, "receipts"), client: { ...fake(fPostflightFailure.observed), postflight: async () => ({ outcome: "POSTFLIGHT_FAILURE", errorCategory: "TEST" }) } }); assert.equal(postflightFailure.classification, "R6_PRODUCTION_RECONCILIATION_POSTFLIGHT_FAILED"); assert.equal(postflightFailure.executionAttemptConsumed, true);
  const fSchemaMismatch = await fixture(); fixtures.push(fSchemaMismatch); const fSchemaMismatchFinal = path.join(fSchemaMismatch.temp, "final.json"); await finalize(fSchemaMismatch, fSchemaMismatchFinal);
  const schemaMismatch = await executeOnce({
    ...core(fSchemaMismatch), finalConfirmationPath: fSchemaMismatchFinal, receiptRoot: path.join(fSchemaMismatch.temp, "receipts"),
    client: {
      ...fake(fSchemaMismatch.observed),
      postflight: async (_bytes, { outputPath }) => {
        await writeFile(outputPath, "mismatched-postflight\n");
        return { outcome: "POSTFLIGHT_SUCCESS", comparison: { matchesExpected: false } };
      },
    },
  });
  assert.equal(schemaMismatch.classification, "R6_PRODUCTION_RECONCILIATION_POSTFLIGHT_SCHEMA_MISMATCH_REQUIRES_REVIEW");
  const mismatchEvidence = path.join(fSchemaMismatch.temp, "receipts", "execution-evidence", fSchemaMismatch.authorization.executionTaskId);
  for (const name of ["production-reconciliation-postflight-raw.csv", "production-reconciliation-postflight-fingerprint.json", "production-reconciliation-postflight-comparison.json", "production-reconciliation-postflight-terminal.json", "production-reconciliation-execution-terminal.json"]) await readFile(path.join(mismatchEvidence, name));
  assert.equal((await readJson(path.join(mismatchEvidence, "production-reconciliation-execution-terminal.json"))).execution.retryCount, 0);
  const fComplete = await fixture(); fixtures.push(fComplete); const fCompleteFinal = path.join(fComplete.temp, "final.json"); await finalize(fComplete, fCompleteFinal);
  let executedBytes; const expectedPostflight = await readFile(path.join(fComplete.packageRoot, "canonical-postflight.sql"));
  const replayCounters = { target: 0 };
  const toctou = { ...fake(fComplete.observed, "COMMITTED", replayCounters), submitMigration: async (bytes) => { executedBytes = Buffer.from(bytes); await writeFile(path.join(fComplete.packageRoot, "canonical-migration.sql"), "replaced"); return { outcome: "COMMITTED" }; }, postflight: async (bytes, { outputPath } = {}) => { assert(Buffer.from(bytes).equals(expectedPostflight)); await writeFile(path.join(fComplete.packageRoot, "canonical-postflight.sql"), "replaced"); if (outputPath) await writeFile(outputPath, "test-postflight-raw\n"); return { outcome: "POSTFLIGHT_SUCCESS" }; } };
  const completed = await executeOnce({ ...core(fComplete), finalConfirmationPath: fCompleteFinal, receiptRoot: path.join(fComplete.temp, "receipts"), client: toctou }); assert.equal(completed.postflightCount, 1); assert(executedBytes.equals(fComplete.migration));
  const completeEvidenceRoot = path.join(fComplete.temp, "receipts", "execution-evidence", fComplete.authorization.executionTaskId);
  const receiptReference = await readJson(path.join(completeEvidenceRoot, "production-reconciliation-receipt-reference.json"));
  assert.equal(receiptReference.executionTaskId, fComplete.authorization.executionTaskId);
  assert.equal(receiptReference.candidateSha256, hash(await readFile(fComplete.authorizationPath)));
  assert.equal(receiptReference.receiptSha256.length, 64);
  assert.equal((await readJson(path.join(completeEvidenceRoot, "production-reconciliation-execution-terminal.json"))).receipt.referenceSha256, hash(await readFile(path.join(completeEvidenceRoot, "production-reconciliation-receipt-reference.json"))));
  await writeFile(path.join(fComplete.packageRoot, "canonical-migration.sql"), fComplete.migration); await writeFile(path.join(fComplete.packageRoot, "canonical-postflight.sql"), expectedPostflight);
  const replayFactory = { count: 0 };
  await assert.rejects(executeWithSpy(fComplete, { finalConfirmationPath: fCompleteFinal, receiptRoot: path.join(fComplete.temp, "receipts"), client: toctou, factoryCalls: replayFactory }), /R6_PRODUCTION_RECONCILIATION_RECEIPT_REPLAY/);
  assert.equal(replayFactory.count, 0, "receipt replay must fail before SQL client creation");
  assert.equal(replayCounters.target, 1, "receipt replay must reject before another target probe");
  process.stdout.write("R6_PRODUCTION_RECONCILIATION_TRANSPORT_FAKE_HARNESS_READY\n");
} finally { await Promise.all(fixtures.map((item) => rm(item.temp, { recursive: true, force: true }))); }
