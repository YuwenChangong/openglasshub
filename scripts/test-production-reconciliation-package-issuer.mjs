import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadBoundExecutionPackage, PACKAGE_VERSION } from "./lib/r6-production-reconciliation-transport-contract.mjs";

const root = process.cwd();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const temp = await mkdtemp(path.join(os.tmpdir(), "r6-production-package-issuer-"));
const configPath = path.join(temp, "config.json");
const packageRoot = path.join(temp, "issued");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const config = { repositoryRoot: root, implementationCommit: commit, launcherSha256: "a".repeat(64), secureWrapperSha256: "b".repeat(64), targetIdentitySha256: "5f03b39617d42cf3d1611488a4eaaff4da2687b5a46a69aa49a31042dce5d975", baselineSha256: "adec5b5933cc70869be55efbabb613b555c890f0e755e01b13b28696e67c9b4a" };

async function loaderAccepts(candidateRoot) {
  const executionPackagePath = path.join(candidateRoot, "production-reconciliation-execution-package.json");
  const manifestPath = path.join(candidateRoot, "production-reconciliation-package-manifest.json");
  return loadBoundExecutionPackage({ packageRoot: candidateRoot, expectedExecutionPackageSha256: hash(await readFile(executionPackagePath)), expectedPackageManifestSha256: hash(await readFile(manifestPath)), expectedImplementationCommit: commit, expectedLauncherSha256: config.launcherSha256, expectedSecureWrapperSha256: config.secureWrapperSha256 });
}

try {
  await writeFile(configPath, JSON.stringify(config));
  const issued = JSON.parse(execFileSync(process.execPath, ["scripts/qa/issue-r6-production-package.mjs", "--config", configPath, "--package-root", packageRoot], { cwd: root, encoding: "utf8" }));
  assert.equal(issued.classification, "R6_PRODUCTION_RECONCILIATION_V3_PACKAGE_ISSUED_OFFLINE");
  const loaded = await loaderAccepts(packageRoot);
  assert.equal(loaded.manifest.schemaVersion, PACKAGE_VERSION);
  for (const name of ["canonical-migration.sql", "canonical-postflight.sql", "canonical-target-probe.sql"]) await readFile(path.join(packageRoot, name));

  async function rejects(label, mutate) {
    const copyRoot = path.join(temp, label);
    await cp(packageRoot, copyRoot, { recursive: true });
    await mutate(copyRoot);
    await assert.rejects(loaderAccepts(copyRoot), /R6_PRODUCTION_RECONCILIATION_PACKAGE_(?:MANIFEST|ARTIFACT|BINDING|PATH)_/);
  }
  await rejects("v2", async (dir) => { const file = path.join(dir, "production-reconciliation-execution-package.json"); const value = JSON.parse(await readFile(file)); value.schemaVersion = "r6-production-reconciliation-execution-package-v2"; await writeFile(file, JSON.stringify(value)); });
  for (const name of ["canonical-migration.sql", "canonical-postflight.sql", "canonical-target-probe.sql"]) await rejects(`missing-${name}`, (dir) => unlink(path.join(dir, name)));
  for (const name of ["canonical-migration.sql", "canonical-postflight.sql", "canonical-target-probe.sql"]) await rejects(`tamper-${name}`, async (dir) => { const file = path.join(dir, name); await writeFile(file, Buffer.concat([await readFile(file), Buffer.from("x")])); });
  await rejects("manifest-commit", async (dir) => { const file = path.join(dir, "production-reconciliation-package-manifest.json"); const value = JSON.parse(await readFile(file)); value.implementationCommit = "c".repeat(40); await writeFile(file, JSON.stringify(value)); });
  await rejects("manifest-launcher", async (dir) => { const file = path.join(dir, "production-reconciliation-package-manifest.json"); const value = JSON.parse(await readFile(file)); value.launcherSha256 = "c".repeat(64); await writeFile(file, JSON.stringify(value)); });
  await rejects("manifest-wrapper", async (dir) => { const file = path.join(dir, "production-reconciliation-package-manifest.json"); const value = JSON.parse(await readFile(file)); value.secureWrapperSha256 = "c".repeat(64); await writeFile(file, JSON.stringify(value)); });
  await rejects("manifest-binding", async (dir) => { const file = path.join(dir, "production-reconciliation-package-manifest.json"); const value = JSON.parse(await readFile(file)); delete value.targetProbe; await writeFile(file, JSON.stringify(value)); });
  process.stdout.write("R6_PRODUCTION_RECONCILIATION_PACKAGE_ISSUER_V3_LOADER_INTEGRATION_READY\n");
} finally {
  await rm(temp, { recursive: true, force: true });
}
