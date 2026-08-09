import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AUTHORIZATION_VERSION, CANONICAL_MIGRATION_BYTES, CANONICAL_MIGRATION_SHA256, PACKAGE_VERSION, POSTFLIGHT_SHA256, TRANSPORT_CONTRACT_VERSION } from "./lib/r6-production-reconciliation-transport-contract.mjs";
import { targetIdentityHash, TARGET_PROBE_SQL, targetProbeSha256 } from "./lib/r6-production-reconciliation-target.mjs";
import { createNativePsqlClient, executeOnce, finalizeHumanConfirmation, inspectNativePsqlCapability, validateFinalExecutionBinding, validateOnly } from "./qa/r6-production-reconciliation-transport.mjs";
import { resolveCanonicalGitBlob } from "./lib/canonical-git-blob.mjs";

const root = process.cwd();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const commit = "a".repeat(40);
const launcherSha256 = "b".repeat(64);
const transportSha256 = "c".repeat(64);
const confirmation = "transport-test-confirmation";

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
const fake = (observed, outcome = "COMMITTED", counters = { target: 0 }) => ({ capability: inspectNativePsqlCapability(), targetProbe: async () => { counters.target += 1; return { outcome: "TARGET_SUCCESS", observedProbeOutput: observed }; }, prepare: async () => ({ outcome: "READY" }), submitMigration: async () => ({ outcome }), postflight: async () => ({ outcome: "POSTFLIGHT_SUCCESS" }) });
const finalize = (f, finalConfirmationPath, phrase = confirmation) => finalizeHumanConfirmation({ ...core(f), finalConfirmationPath, confirmationPhrase: phrase });

const fixtures = [];
try {
  const capability = inspectNativePsqlCapability(); assert.equal(capability.type, "PSQL_NATIVE");
  assert.throws(() => createNativePsqlClient({ environment: { PGHOST: "host", PGPORT: "5432", PGDATABASE: "postgres", PGUSER: "postgres", PGPASSWORD: "secret", DATABASE_URL: "postgresql://unsafe" }, capability }), /R6_PRODUCTION_RECONCILIATION_CONNECTION_STRING_CHANNEL_FORBIDDEN/);
  const f = await fixture(); fixtures.push(f);
  const candidate = await validateOnly(core(f)); assert.equal(candidate.classification, "R6_PRODUCTION_RECONCILIATION_CANDIDATE_VALIDATED_AWAITING_FINAL_HUMAN_CONFIRMATION"); assert.equal(candidate.networkConnections, 0);
  await writeFile(path.join(f.temp, "legacy-v1.json"), JSON.stringify({ schemaVersion: "r6-production-reconciliation-execution-authorization-v1" }));
  await assert.rejects(validateOnly({ ...core(f), authorizationPath: path.join(f.temp, "legacy-v1.json") }), /R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_TRANSPORT_VERSION_MISMATCH/);
  await assert.rejects(validateOnly({ ...core(f), authorizationPath: path.join(f.temp, "missing.json") }), /R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_MISSING/);
  const counters = { target: 0 };
  await assert.rejects(executeOnce({ ...core(f), finalConfirmationPath: path.join(f.temp, "absent-final.json"), receiptRoot: path.join(f.temp, "receipts"), confirmationPhrase: confirmation, client: fake(f.observed, "COMMITTED", counters) }), /R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_MISSING/);
  assert.equal(counters.target, 0, "candidate plus raw phrase must reject before target probe");
  for (const [index, wrongPhrase] of [`${confirmation} `, `${confirmation}\n`, confirmation.toUpperCase(), `${confirmation}\u0301`].entries()) {
    const wrongFinal = path.join(f.temp, `wrong-final-${index}.json`);
    await assert.rejects(finalize(f, wrongFinal, wrongPhrase), /R6_PRODUCTION_RECONCILIATION_CONFIRMATION_INVALID/);
    await assert.rejects(readFile(wrongFinal), /ENOENT/);
  }
  const fOther = await fixture(); fixtures.push(fOther);
  const otherFinal = path.join(fOther.temp, "final.json"); await finalize(fOther, otherFinal);
  await assert.rejects(executeOnce({ ...core(f), finalConfirmationPath: otherFinal, receiptRoot: path.join(f.temp, "receipts-other"), client: fake(f.observed) }), /R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_BINDING_FAILED/);
  assert.equal(counters.target, 0);
  const finalPath = path.join(f.temp, "final.json");
  const finalized = await finalize(f, finalPath); assert.equal(finalized.networkConnections, 0); assert.equal(finalized.receiptConsumed, false);
  assert.doesNotMatch(await readFile(finalPath, "utf8"), new RegExp(confirmation));
  await assert.rejects(finalize(f, finalPath), /R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_REPLAY/);
  const combined = await validateFinalExecutionBinding({ ...core(f), finalConfirmationPath: finalPath }); assert.equal(combined.classification, "R6_PRODUCTION_RECONCILIATION_FINAL_EXECUTION_BINDING_READY");
  const mismatch = await executeOnce({ ...core(f), finalConfirmationPath: finalPath, receiptRoot: path.join(f.temp, "receipts-mismatch"), client: fake("wrong") }); assert.equal(mismatch.executionAttemptConsumed, false);
  const fIllegal = await fixture(); fixtures.push(fIllegal); fIllegal.authorization.executionEligible = true; await writeFile(fIllegal.authorizationPath, JSON.stringify(fIllegal.authorization));
  await assert.rejects(validateOnly(core(fIllegal)), /R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ILLEGAL_EXECUTABLE_CANDIDATE/);
  const fPre = await fixture(); fixtures.push(fPre); const fPreFinal = path.join(fPre.temp, "final.json"); await finalize(fPre, fPreFinal);
  const pre = await executeOnce({ ...core(fPre), finalConfirmationPath: fPreFinal, receiptRoot: path.join(fPre.temp, "receipts"), client: { ...fake(fPre.observed), prepare: async () => ({ outcome: "PRE_SUBMIT_FAILURE" }) } }); assert.equal(pre.executionAttemptConsumed, false);
  const fRollback = await fixture(); fixtures.push(fRollback); const fRollbackFinal = path.join(fRollback.temp, "final.json"); await finalize(fRollback, fRollbackFinal);
  const rollback = await executeOnce({ ...core(fRollback), finalConfirmationPath: fRollbackFinal, receiptRoot: path.join(fRollback.temp, "receipts"), client: fake(fRollback.observed, "ROLLED_BACK") }); assert.equal(rollback.executionAttemptConsumed, true);
  const fComplete = await fixture(); fixtures.push(fComplete); const fCompleteFinal = path.join(fComplete.temp, "final.json"); await finalize(fComplete, fCompleteFinal);
  let executedBytes; const expectedPostflight = await readFile(path.join(fComplete.packageRoot, "canonical-postflight.sql"));
  const replayCounters = { target: 0 };
  const toctou = { ...fake(fComplete.observed, "COMMITTED", replayCounters), submitMigration: async (bytes) => { executedBytes = Buffer.from(bytes); await writeFile(path.join(fComplete.packageRoot, "canonical-migration.sql"), "replaced"); return { outcome: "COMMITTED" }; }, postflight: async (bytes) => { assert(Buffer.from(bytes).equals(expectedPostflight)); await writeFile(path.join(fComplete.packageRoot, "canonical-postflight.sql"), "replaced"); return { outcome: "POSTFLIGHT_SUCCESS" }; } };
  const completed = await executeOnce({ ...core(fComplete), finalConfirmationPath: fCompleteFinal, receiptRoot: path.join(fComplete.temp, "receipts"), client: toctou }); assert.equal(completed.postflightCount, 1); assert(executedBytes.equals(fComplete.migration));
  await writeFile(path.join(fComplete.packageRoot, "canonical-migration.sql"), fComplete.migration); await writeFile(path.join(fComplete.packageRoot, "canonical-postflight.sql"), expectedPostflight);
  await assert.rejects(executeOnce({ ...core(fComplete), finalConfirmationPath: fCompleteFinal, receiptRoot: path.join(fComplete.temp, "receipts"), client: toctou }), /R6_PRODUCTION_RECONCILIATION_RECEIPT_REPLAY/);
  assert.equal(replayCounters.target, 1, "receipt replay must reject before another target probe");
  process.stdout.write("R6_PRODUCTION_RECONCILIATION_TRANSPORT_FAKE_HARNESS_READY\n");
} finally { await Promise.all(fixtures.map((item) => rm(item.temp, { recursive: true, force: true }))); }
