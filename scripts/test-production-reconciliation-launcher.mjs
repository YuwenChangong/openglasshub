import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AUTHORIZATION_VERSION, CANONICAL_MIGRATION_BYTES, CANONICAL_MIGRATION_SHA256, PACKAGE_MANIFEST_VERSION, PACKAGE_VERSION, POSTFLIGHT_SHA256, TRANSPORT_CONTRACT_VERSION } from "./lib/r6-production-reconciliation-transport-contract.mjs";
import { TARGET_PROBE_SQL, targetIdentityHash, targetProbeSha256 } from "./lib/r6-production-reconciliation-target.mjs";
import { inspectNativePsqlCapability } from "./qa/r6-production-reconciliation-transport.mjs";
import { resolveCanonicalGitBlob } from "./lib/canonical-git-blob.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "r6-production-reconciliation-launcher-"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
try {
  const transportPath = path.join(root, "scripts", "qa", "r6-production-reconciliation-transport.mjs");
  const launcherPath = path.join(temp, "start-r6-production-reconciliation.ps1");
  const bindingPath = path.join(temp, "launcher-binding.json");
  const configPath = path.join(temp, "config.json");
  const fakeNodePath = path.join(temp, "fake-node.cmd");
  const fakeNodeOutputPath = path.join(temp, "fake-node-args.txt");
  await writeFile(fakeNodePath, `@echo off\r\necho %* > "${fakeNodeOutputPath}"\r\n`);
  const config = { implementationCommit: "a".repeat(40), transportPath, transportSha256: hash(await readFile(transportPath)), nodePath: fakeNodePath, receiptRoot: path.join(temp, "receipts"), launcherBindingPath: bindingPath };
  await writeFile(configPath, JSON.stringify(config));
  execFileSync(process.execPath, ["scripts/qa/render-r6-production-reconciliation-launcher.mjs", "--config", configPath, "--destination", launcherPath], { cwd: root });
  const launcher = await readFile(launcherPath, "utf8");
  assert.doesNotMatch(launcher, /Cloudflare|AuthCheck|DryRun|canary|Capture|OAuth/i);
  assert.match(launcher, /\[ValidateSet\('ValidateOnly', 'FinalizeHumanConfirmation', 'Execute'\)\]\[string\]\$Mode = 'ValidateOnly'/);
  assert.match(launcher, /if \(\$Mode -eq 'ValidateOnly'\)/);
  assert.match(launcher, /if \(\$Mode -eq 'FinalizeHumanConfirmation'\)/);
  assert.match(launcher, /transportPath Execute \$AuthorizationPath \$PackageRoot \$FinalConfirmationPath \$config\.receiptRoot/);
  assert.doesNotMatch(launcher, /\$mode = if \(\$ValidateOnly\) \{ 'ValidateOnly' \} else \{ 'Execute' \}/);
  await writeFile(bindingPath, JSON.stringify({ schemaVersion: "r6-production-reconciliation-launcher-binding-v1", launcherSha256: hash(await readFile(launcherPath)) }));
  const escapedPath = launcherPath.replace(/'/g, "''");
  const parser = `$ErrorActionPreference='Stop'; [ScriptBlock]::Create((Get-Content -LiteralPath '${escapedPath}' -Raw)) | Out-Null`;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", parser], { encoding: "utf8" });
  const authPath = path.join(temp, "candidate.json"); const packageRoot = path.join(temp, "package"); const finalPath = path.join(temp, "final.json");
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launcherPath, "-AuthorizationPath", authPath, "-PackageRoot", packageRoot], { encoding: "utf8" });
  assert.match(await readFile(fakeNodeOutputPath, "utf8"), /ValidateOnly/);
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launcherPath, "-AuthorizationPath", authPath, "-PackageRoot", packageRoot, "-Mode", "Execute", "-FinalConfirmationPath", finalPath], { encoding: "utf8" });
  assert.match(await readFile(fakeNodeOutputPath, "utf8"), /Execute/);

  // This invokes the rendered launcher and real transport with no PG* secrets. A
  // valid candidate plus a missing final artifact must fail before client creation.
  const liveLauncherPath = path.join(temp, "live-start-r6-production-reconciliation.ps1");
  const liveBindingPath = path.join(temp, "live-launcher-binding.json");
  const liveConfigPath = path.join(temp, "live-config.json");
  const liveConfig = { ...config, nodePath: process.execPath, launcherBindingPath: liveBindingPath };
  await writeFile(liveConfigPath, JSON.stringify(liveConfig));
  execFileSync(process.execPath, ["scripts/qa/render-r6-production-reconciliation-launcher.mjs", "--config", liveConfigPath, "--destination", liveLauncherPath], { cwd: root });
  await writeFile(liveBindingPath, JSON.stringify({ schemaVersion: "r6-production-reconciliation-launcher-binding-v1", launcherSha256: hash(await readFile(liveLauncherPath)) }));
  const livePackageRoot = path.join(temp, "live-package"); await mkdir(livePackageRoot, { recursive: true });
  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const migration = resolveCanonicalGitBlob({ repositoryRoot: root, implementationCommit: currentCommit, repositoryRelativePath: "supabase/migrations/20260807073929_reconcile_production_schema_drift.sql" }).bytes;
  const postflight = resolveCanonicalGitBlob({ repositoryRoot: root, implementationCommit: currentCommit, repositoryRelativePath: "docs/ops/legal-consent-production-schema-fingerprint.sql" }).bytes;
  await Promise.all([writeFile(path.join(livePackageRoot, "canonical-migration.sql"), migration), writeFile(path.join(livePackageRoot, "canonical-postflight.sql"), postflight), writeFile(path.join(livePackageRoot, "canonical-target-probe.sql"), TARGET_PROBE_SQL)]);
  const executionPackage = { schemaVersion: PACKAGE_VERSION, transportContractVersion: TRANSPORT_CONTRACT_VERSION, migration: { artifact: "canonical-migration.sql", sha256: CANONICAL_MIGRATION_SHA256, bytes: CANONICAL_MIGRATION_BYTES }, postflight: { artifact: "canonical-postflight.sql", sha256: POSTFLIGHT_SHA256 }, targetProbe: { artifact: "canonical-target-probe.sql", sha256: targetProbeSha256() } };
  const executionPackagePath = path.join(livePackageRoot, "production-reconciliation-execution-package.json");
  const packageManifestPath = path.join(livePackageRoot, "production-reconciliation-package-manifest.json");
  await writeFile(executionPackagePath, JSON.stringify(executionPackage));
  await writeFile(packageManifestPath, JSON.stringify({ schemaVersion: PACKAGE_MANIFEST_VERSION, implementationCommit: config.implementationCommit, transportContractVersion: TRANSPORT_CONTRACT_VERSION, executionPackageArtifact: path.basename(executionPackagePath), executionPackageSha256: hash(await readFile(executionPackagePath)), migration: executionPackage.migration, postflight: executionPackage.postflight, targetProbe: executionPackage.targetProbe, targetIdentitySha256: "5f03b39617d42cf3d1611488a4eaaff4da2687b5a46a69aa49a31042dce5d975", baselineSha256: "adec5b5933cc70869be55efbabb613b555c890f0e755e01b13b28696e67c9b4a", launcherSha256: hash(await readFile(liveLauncherPath)), secureWrapperSha256: "f".repeat(64), executionEligible: false, candidateIssued: false, humanConfirmed: false, executionConsumed: false }));
  const capability = inspectNativePsqlCapability();
  const liveCandidatePath = path.join(temp, "live-candidate.json");
  const liveLauncherSha256 = hash(await readFile(liveLauncherPath));
  const observed = '{"database":"postgres","serverVersionNum":"170000","sessionUser":"postgres"}';
  const candidate = { schemaVersion: AUTHORIZATION_VERSION, authorizationId: randomUUID(), executionTaskId: randomUUID(), authorizationState: "AWAITING_FINAL_HUMAN_CONFIRMATION", executionEligible: false, immutable: true, packageManifestSha256: hash(await readFile(packageManifestPath)), executionPackageSha256: hash(await readFile(executionPackagePath)), transportImplementationCommit: config.implementationCommit, transportLauncherSha256: liveLauncherSha256, transportSha256: config.transportSha256, targetIdentitySha256: targetIdentityHash(observed), canonicalMigrationSha256: CANONICAL_MIGRATION_SHA256, canonicalPostflightSha256: POSTFLIGHT_SHA256, targetProbeSha256: targetProbeSha256(), requiredConfirmationSha256: hash("test-only"), transportContractVersion: TRANSPORT_CONTRACT_VERSION, sqlClientCapability: "PSQL_NATIVE", sqlClientVersion: capability.version, sqlClientExecutablePath: capability.executablePath, sqlClientExecutableSha256: capability.executableSha256, attempts: 1, automaticRetry: 0, automaticRollback: 0 };
  await writeFile(liveCandidatePath, JSON.stringify(candidate));
  const noDatabaseSecrets = { ...process.env }; for (const name of ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "DATABASE_URL", "SUPABASE_DB_URL", "R6_PRODUCTION_RECONCILIATION_DATABASE_URL"]) delete noDatabaseSecrets[name];
  const run = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", liveLauncherPath, "-AuthorizationPath", liveCandidatePath, "-PackageRoot", livePackageRoot, "-Mode", "Execute", "-FinalConfirmationPath", path.join(temp, "missing-final.json")], { encoding: "utf8", env: noDatabaseSecrets, stdio: ["ignore", "pipe", "pipe"] });
  assert.fail(`candidate-only Execute unexpectedly succeeded: ${run}`);
} catch (error) {
  if (error?.status === 1 && /R6_PRODUCTION_RECONCILIATION_FINAL_HUMAN_CONFIRMATION_REQUIRED/.test(`${error.stdout}\n${error.stderr}`)) {
    process.stdout.write("R6_PRODUCTION_RECONCILIATION_LAUNCHER_CANDIDATE_ONLY_OFFLINE_REJECTION_READY\n");
  } else {
    throw error;
  }
}
try {
  process.stdout.write("R6_PRODUCTION_RECONCILIATION_LAUNCHER_FAKE_HARNESS_READY\n");
} finally { await (await import("node:fs/promises")).rm(temp, { recursive: true, force: true }); }
