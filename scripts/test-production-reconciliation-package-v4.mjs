import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  EXECUTION_PACKAGE_ARTIFACT_V4, PACKAGE_V4_VERSION,
  TARGET_IDENTITY_ARTIFACT, issueProductionReconciliationV4Package,
  loadProductionReconciliationV4Package, productionProjectRefFromRepository,
} from "./lib/r6-production-reconciliation-package-v4.mjs";

const repositoryRoot = process.cwd();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
const hash = "a".repeat(64);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "r6-package-v4-"));
const writeToml = value => writeFile(path.join(tempRoot, "wrangler.toml"), value, "utf8");

try {
  await writeToml('SUPABASE_URL = "https://xcbnxzjlsvtgzixurcof.supabase.co"\n');
  assert.equal(await productionProjectRefFromRepository(tempRoot), "xcbnxzjlsvtgzixurcof");
  for (const value of [
    'SUPABASE_URL = "http://xcbnxzjlsvtgzixurcof.supabase.co"\n',
    'SUPABASE_URL = "https://wrong.example.com"\n',
    "[vars]\n",
  ]) {
    await writeToml(value);
    await assert.rejects(() => productionProjectRefFromRepository(tempRoot), /APPROVED_ROUTING_AUTHORITY_MISMATCH/);
  }

  const packageRoot = path.join(tempRoot, "package");
  const result = await issueProductionReconciliationV4Package({
    packageRoot, repositoryRoot, implementationCommit: commit,
    launcherSha256: hash, secureWrapperSha256: hash, baselineSha256: "adec5b5933cc70869be55efbabb613b555c890f0e755e01b13b28696e67c9b4a",
  });
  const loaded = await loadProductionReconciliationV4Package({ packageRoot, repositoryRoot });
  assert.equal(loaded.executionPackage.schemaVersion, PACKAGE_V4_VERSION);
  assert.equal(loaded.executionPackage.expectedProjectRef, "xcbnxzjlsvtgzixurcof");
  assert.equal(loaded.targetIdentity.projectRef, "xcbnxzjlsvtgzixurcof");
  assert.equal(loaded.routingIdentity.database, "postgres");
  assert.match(result.manifestSha256, /^[a-f0-9]{64}$/);

  const packagePath = path.join(packageRoot, EXECUTION_PACKAGE_ARTIFACT_V4);
  const originalPackage = await readFile(packagePath, "utf8");
  for (const mutate of [
    value => ({ ...value, targetIdentitySchemaVersion: "tampered" }),
    value => ({ ...value, runtimeRoutingSchemaVersion: "tampered" }),
    value => ({ ...value, targetIdentityCanonicalSha256: hash }),
    value => ({ ...value, runtimeRoutingArtifactSha256: hash }),
    value => ({ ...value, expectedProjectRef: "aaaaaaaaaaaaaaaaaaaa" }),
  ]) {
    await writeFile(packagePath, `${JSON.stringify(mutate(JSON.parse(originalPackage)))}\n`, "utf8");
    await assert.rejects(() => loadProductionReconciliationV4Package({ packageRoot, repositoryRoot }), /PACKAGE_V4_INVALID|ROUTING_AUTHORITY_MISMATCH/);
  }
  await writeFile(packagePath, originalPackage, "utf8");
  const targetPath = path.join(packageRoot, TARGET_IDENTITY_ARTIFACT);
  const originalTarget = await readFile(targetPath, "utf8");
  await writeFile(targetPath, `${originalTarget} `, "utf8");
  await assert.rejects(() => loadProductionReconciliationV4Package({ packageRoot, repositoryRoot }), /PACKAGE_V4_INVALID/);
  await writeFile(targetPath, originalTarget, "utf8");
  await writeFile(packagePath, '{"schemaVersion":"r6-production-reconciliation-execution-package-v3"}\n', "utf8");
  await assert.rejects(() => loadProductionReconciliationV4Package({ packageRoot, repositoryRoot }), /PACKAGE_V4_INVALID/);
  await writeFile(packagePath, originalPackage, "utf8");
  await loadProductionReconciliationV4Package({ packageRoot, repositoryRoot });
  console.log("R6_PRODUCTION_RECONCILIATION_PACKAGE_V4_UNIT_PASS");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
