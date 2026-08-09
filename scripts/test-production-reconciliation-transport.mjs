import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AUTHORIZATION_VERSION, CANONICAL_MIGRATION_BYTES, CANONICAL_MIGRATION_SHA256, PACKAGE_VERSION, POSTFLIGHT_SHA256, TRANSPORT_CONTRACT_VERSION } from "./lib/r6-production-reconciliation-transport-contract.mjs";
import { targetIdentityHash, TARGET_PROBE_SQL, targetProbeSha256 } from "./lib/r6-production-reconciliation-target.mjs";
import { createNativePsqlClient, executeOnce, inspectNativePsqlCapability, validateOnly } from "./qa/r6-production-reconciliation-transport.mjs";
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
  await (await import("node:fs/promises")).mkdir(packageRoot, { recursive: true });
  const currentCommit = (await import("node:child_process")).execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const migration = resolveCanonicalGitBlob({ repositoryRoot: root, implementationCommit: currentCommit, repositoryRelativePath: "supabase/migrations/20260807073929_reconcile_production_schema_drift.sql" }).bytes;
  const postflight = resolveCanonicalGitBlob({ repositoryRoot: root, implementationCommit: currentCommit, repositoryRelativePath: "docs/ops/legal-consent-production-schema-fingerprint.sql" }).bytes;
  assert.equal(hash(migration), CANONICAL_MIGRATION_SHA256); assert.equal(migration.length, CANONICAL_MIGRATION_BYTES); assert.equal(hash(postflight), POSTFLIGHT_SHA256);
  await writeFile(path.join(packageRoot, "canonical-migration.sql"), migration);
  await writeFile(path.join(packageRoot, "canonical-postflight.sql"), postflight);
  await writeFile(path.join(packageRoot, "canonical-target-probe.sql"), TARGET_PROBE_SQL);
  const manifest = { schemaVersion: PACKAGE_VERSION, transportContractVersion: TRANSPORT_CONTRACT_VERSION, migration: { artifact: "canonical-migration.sql", sha256: CANONICAL_MIGRATION_SHA256, bytes: CANONICAL_MIGRATION_BYTES }, postflight: { artifact: "canonical-postflight.sql", sha256: POSTFLIGHT_SHA256 }, targetProbe: { artifact: "canonical-target-probe.sql", sha256: targetProbeSha256() } };
  const manifestPath = path.join(packageRoot, "production-reconciliation-execution-package.json"); await writeFile(manifestPath, JSON.stringify(manifest));
  const observed = '{"database":"postgres","serverVersionNum":"170000","sessionUser":"postgres"}';
  const sqlClientCapability = inspectNativePsqlCapability();
  const authorization = { schemaVersion: AUTHORIZATION_VERSION, authorizationId: randomUUID(), executionTaskId: randomUUID(), authorizationSha256: "d".repeat(64), packageManifestSha256: hash(await readFile(manifestPath)), transportImplementationCommit: commit, transportLauncherSha256: launcherSha256, transportSha256, targetIdentitySha256: targetIdentityHash(observed), canonicalMigrationSha256: CANONICAL_MIGRATION_SHA256, postflightSha256: POSTFLIGHT_SHA256, confirmationSha256: hash(confirmation), transportContractVersion: TRANSPORT_CONTRACT_VERSION, sqlClientCapability: "PSQL_NATIVE", sqlClientVersion: sqlClientCapability.version, sqlClientExecutablePath: sqlClientCapability.executablePath, sqlClientExecutableSha256: sqlClientCapability.executableSha256, attempts: 1, automaticRetry: 0, automaticRollback: 0 };
  return { temp, packageRoot, authorization, observed, migration, sqlClientCapability };
}

const inputs = (f, client) => ({ authorization: f.authorization, packageRoot: f.packageRoot, receiptRoot: path.join(f.temp, "receipts"), confirmationPhrase: confirmation, implementationCommit: commit, launcherSha256, transportSha256, sqlClientCapability: f.sqlClientCapability, client });
const fake = (observed, outcome = "COMMITTED") => ({ targetProbe: async () => ({ outcome: "TARGET_SUCCESS", observedProbeOutput: observed }), prepare: async () => ({ outcome: "READY" }), submitMigration: async () => ({ outcome }), postflight: async () => ({ outcome: "POSTFLIGHT_SUCCESS" }) });

const fixtures = [];
const f = await fixture(); fixtures.push(f);
try {
  const capability = inspectNativePsqlCapability(); assert.equal(capability.type, "PSQL_NATIVE");
  assert.throws(() => createNativePsqlClient({ environment: { PGHOST: "host", PGPORT: "5432", PGDATABASE: "postgres", PGUSER: "postgres", PGPASSWORD: "secret", DATABASE_URL: "postgresql://unsafe" }, capability }), /R6_PRODUCTION_RECONCILIATION_CONNECTION_STRING_CHANNEL_FORBIDDEN/);
  const validate = await validateOnly({ ...inputs(f), client: undefined }); assert.equal(validate.executionAttemptConsumed, false); assert.equal(validate.networkConnections, 0);
  await assert.rejects(validateOnly({ ...inputs(f), authorization: { schemaVersion: "r6-production-reconciliation-execution-authorization-v1" } }), /R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_TRANSPORT_VERSION_MISMATCH/);
  const mismatch = await executeOnce(inputs(f, fake("wrong"))); assert.equal(mismatch.executionAttemptConsumed, false); assert.equal(mismatch.productionMutations, 0);
  f.authorization.targetIdentitySha256 = targetIdentityHash(f.observed);
  const pre = await executeOnce(inputs(f, { ...fake(f.observed), prepare: async () => ({ outcome: "PRE_SUBMIT_FAILURE" }) })); assert.equal(pre.executionAttemptConsumed, false);
  const f2 = await fixture(); fixtures.push(f2); f2.authorization.targetIdentitySha256 = targetIdentityHash(f2.observed);
  const rollback = await executeOnce(inputs(f2, fake(f2.observed, "ROLLED_BACK"))); assert.equal(rollback.executionAttemptConsumed, true); assert.equal(rollback.postflightCount, 0);
  const f3 = await fixture(); fixtures.push(f3); f3.authorization.targetIdentitySha256 = targetIdentityHash(f3.observed);
  const unknown = await executeOnce(inputs(f3, fake(f3.observed, "COMMIT_STATE_UNKNOWN"))); assert.equal(unknown.classification, "R6_PRODUCTION_RECONCILIATION_COMMIT_STATE_UNKNOWN");
  const f4 = await fixture(); fixtures.push(f4); f4.authorization.targetIdentitySha256 = targetIdentityHash(f4.observed); let executedBytes;
  const expectedPostflight = await readFile(path.join(f4.packageRoot, "canonical-postflight.sql"));
  const toctou = { ...fake(f4.observed), submitMigration: async (bytes) => { executedBytes = Buffer.from(bytes); await writeFile(path.join(f4.packageRoot, "canonical-migration.sql"), "replaced"); return { outcome: "COMMITTED" }; }, postflight: async (bytes) => { assert(Buffer.from(bytes).equals(expectedPostflight)); await writeFile(path.join(f4.packageRoot, "canonical-postflight.sql"), "replaced"); return { outcome: "POSTFLIGHT_SUCCESS" }; } };
  const completed = await executeOnce(inputs(f4, toctou)); assert.equal(completed.postflightCount, 1); assert(executedBytes.equals(f4.migration)); await writeFile(path.join(f4.packageRoot, "canonical-migration.sql"), f4.migration); await writeFile(path.join(f4.packageRoot, "canonical-postflight.sql"), expectedPostflight); await assert.rejects(executeOnce(inputs(f4, toctou)), /R6_PRODUCTION_RECONCILIATION_RECEIPT_REPLAY/);
  process.stdout.write("R6_PRODUCTION_RECONCILIATION_TRANSPORT_FAKE_HARNESS_READY\n");
} finally { await Promise.all(fixtures.map((item) => rm(item.temp, { recursive: true, force: true }))); }
