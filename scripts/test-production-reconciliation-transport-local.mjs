import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveCanonicalGitBlob } from "./lib/canonical-git-blob.mjs";
import { loadFrozenDriftInputs, withProductionDriftFixtureRuntime, captureCatalog } from "./lib/production-drift-structural-fixture.mjs";
import { compareFingerprint } from "./compare-production-schema-fingerprint.mjs";
import { AUTHORIZATION_VERSION, CANONICAL_MIGRATION_BYTES, CANONICAL_MIGRATION_SHA256, PACKAGE_VERSION, POSTFLIGHT_SHA256, TRANSPORT_CONTRACT_VERSION } from "./lib/r6-production-reconciliation-transport-contract.mjs";
import { TARGET_PROBE_SQL, targetIdentityHash, targetProbeSha256 } from "./lib/r6-production-reconciliation-target.mjs";
import { executeOnce, finalizeHumanConfirmation, inspectNativePsqlCapability } from "./qa/r6-production-reconciliation-transport.mjs";

const root = process.cwd();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const confirmation = "local-transport-confirmation";
const docker = (args, input) => execFileSync("docker", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
const dockerPsql = (container, sql, tupleOnly = false, discardOutput = false) => docker(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", ...(tupleOnly ? ["-qAt"] : ["-q"]), ...(discardOutput ? ["-o", "/dev/null"] : []), "-U", "postgres", "-d", "postgres"], sql);

async function createPackage(temp) {
  const packageRoot = path.join(temp, "package"); await mkdir(packageRoot, { recursive: true });
  const migration = resolveCanonicalGitBlob({ repositoryRoot: root, implementationCommit: commit, repositoryRelativePath: "supabase/migrations/20260807073929_reconcile_production_schema_drift.sql" }).bytes;
  const postflight = resolveCanonicalGitBlob({ repositoryRoot: root, implementationCommit: commit, repositoryRelativePath: "docs/ops/legal-consent-production-schema-fingerprint.sql" }).bytes;
  assert.equal(hash(migration), CANONICAL_MIGRATION_SHA256); assert.equal(migration.length, CANONICAL_MIGRATION_BYTES); assert.equal(hash(postflight), POSTFLIGHT_SHA256);
  await Promise.all([writeFile(path.join(packageRoot, "canonical-migration.sql"), migration), writeFile(path.join(packageRoot, "canonical-postflight.sql"), postflight), writeFile(path.join(packageRoot, "canonical-target-probe.sql"), TARGET_PROBE_SQL)]);
  const manifest = { schemaVersion: PACKAGE_VERSION, transportContractVersion: TRANSPORT_CONTRACT_VERSION, migration: { artifact: "canonical-migration.sql", sha256: CANONICAL_MIGRATION_SHA256, bytes: CANONICAL_MIGRATION_BYTES }, postflight: { artifact: "canonical-postflight.sql", sha256: POSTFLIGHT_SHA256 }, targetProbe: { artifact: "canonical-target-probe.sql", sha256: targetProbeSha256() } };
  const manifestPath = path.join(packageRoot, "production-reconciliation-execution-package.json");
  const outerManifestPath = path.join(packageRoot, "production-reconciliation-package-manifest.json");
  await Promise.all([writeFile(manifestPath, JSON.stringify(manifest)), writeFile(outerManifestPath, JSON.stringify({ schemaVersion: "test-outer-package-v1" }))]);
  return { packageRoot, executionPackageSha256: hash(await readFile(manifestPath)), packageManifestSha256: hash(await readFile(outerManifestPath)) };
}

const temp = await mkdtemp(path.join(os.tmpdir(), "r6-production-transport-local-"));
try {
  const packageFixture = await createPackage(temp);
  const inputs = await loadFrozenDriftInputs(root);
  const result = await withProductionDriftFixtureRuntime({ root, inputs, label: "transport-local", run: async (runtime) => {
    const observed = dockerPsql(runtime.container, TARGET_PROBE_SQL, true).trim();
    const capability = inspectNativePsqlCapability();
    const authorization = { schemaVersion: AUTHORIZATION_VERSION, authorizationId: randomUUID(), executionTaskId: randomUUID(), authorizationState: "AWAITING_FINAL_HUMAN_CONFIRMATION", executionEligible: false, immutable: true, packageManifestSha256: packageFixture.packageManifestSha256, executionPackageSha256: packageFixture.executionPackageSha256, transportImplementationCommit: commit, transportLauncherSha256: "b".repeat(64), transportSha256: "c".repeat(64), targetIdentitySha256: targetIdentityHash(observed), canonicalMigrationSha256: CANONICAL_MIGRATION_SHA256, canonicalPostflightSha256: POSTFLIGHT_SHA256, targetProbeSha256: targetProbeSha256(), requiredConfirmationSha256: hash(confirmation), transportContractVersion: TRANSPORT_CONTRACT_VERSION, sqlClientCapability: "PSQL_NATIVE", sqlClientVersion: capability.version, sqlClientExecutablePath: capability.executablePath, sqlClientExecutableSha256: capability.executableSha256, attempts: 1, automaticRetry: 0, automaticRollback: 0 };
    const authorizationPath = path.join(temp, "candidate.json"); await writeFile(authorizationPath, JSON.stringify(authorization));
    const finalConfirmationPath = path.join(temp, "final-confirmation.json");
    let targetConnections = 0;
    const client = {
      capability,
      async targetProbe(sql) { targetConnections += 1; return { outcome: "TARGET_SUCCESS", observedProbeOutput: dockerPsql(runtime.container, sql, true).trim() }; },
      async submitMigration(sql) { const process = spawnSync("docker", ["exec", "-i", runtime.container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-U", "postgres", "-d", "postgres"], { input: Buffer.concat([Buffer.from("BEGIN;\n"), sql, Buffer.from("\nCOMMIT;\n")]), encoding: "utf8" }); return process.status === 0 ? { outcome: "COMMITTED" } : { outcome: "COMMIT_STATE_UNKNOWN" }; },
      async postflight(sql) { dockerPsql(runtime.container, sql, false, true); return { outcome: "POSTFLIGHT_SUCCESS" }; },
    };
    await assert.rejects(executeOnce({ authorizationPath, packageRoot: packageFixture.packageRoot, finalConfirmationPath: path.join(temp, "missing.json"), receiptRoot: path.join(temp, "receipts-missing"), implementationCommit: commit, launcherSha256: "b".repeat(64), transportSha256: "c".repeat(64), sqlClientCapability: capability, client }), /R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_MISSING/);
    assert.equal(targetConnections, 0, "candidate-only path must not open a target connection");
    const finalized = await finalizeHumanConfirmation({ authorizationPath, packageRoot: packageFixture.packageRoot, finalConfirmationPath, confirmationPhrase: confirmation, implementationCommit: commit, launcherSha256: "b".repeat(64), transportSha256: "c".repeat(64), sqlClientCapability: capability });
    assert.equal(finalized.networkConnections, 0);
    const execution = await executeOnce({ authorizationPath, packageRoot: packageFixture.packageRoot, finalConfirmationPath, receiptRoot: path.join(temp, "receipts"), implementationCommit: commit, launcherSha256: "b".repeat(64), transportSha256: "c".repeat(64), sqlClientCapability: capability, client });
    const catalog = await captureCatalog(root, runtime.container);
    return { execution, targetConnections, comparison: compareFingerprint(inputs.expected, catalog.rows).counts };
  }});
  assert.equal(result.execution.classification, "R6_PRODUCTION_RECONCILIATION_EXECUTION_AND_POSTFLIGHT_COMPLETE");
  assert.equal(result.targetConnections, 1); assert.equal(result.execution.postflightCount, 1); assert.deepEqual(result.comparison, { MATCH: 1133, MISSING_IN_PRODUCTION: 0, DIVERGENT_IN_PRODUCTION: 0, EXTRA_IN_PRODUCTION: 20, INSUFFICIENT_EVIDENCE: 0 });
  process.stdout.write("R6_PRODUCTION_RECONCILIATION_TRANSPORT_LOCAL_INTEGRATION_READY\n");
} finally { await rm(temp, { recursive: true, force: true }); }
