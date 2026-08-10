import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { issueProductionReconciliationV4Package } from "./lib/r6-production-reconciliation-package-v4.mjs";
import { buildAuthorizationV4FromPackage, validateLauncherBindingV2 } from "./lib/r6-production-reconciliation-authorization-v3.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "r6-production-reconciliation-launcher-v2-"));
const hash = value => createHash("sha256").update(value).digest("hex");
try {
  const transportPath = path.join(root, "scripts", "qa", "r6-production-reconciliation-transport.mjs");
  const launcherPath = path.join(temp, "start-r6-production-reconciliation.ps1");
  const bindingPath = path.join(temp, "launcher-binding-v2.json");
  const configPath = path.join(temp, "config.json");
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const transportSha256 = hash(await readFile(transportPath));
  const config = { implementationCommit: commit, transportPath, transportSha256, nodePath: process.execPath, receiptRoot: path.join(temp, "receipts"), launcherBindingPath: bindingPath };
  await writeFile(configPath, JSON.stringify(config));
  execFileSync(process.execPath, ["scripts/qa/render-r6-production-reconciliation-launcher.mjs", "--config", configPath, "--destination", launcherPath], { cwd: root });
  const launcherSha256 = hash(await readFile(launcherPath));
  const binding = { schemaVersion: "r6-production-reconciliation-launcher-binding-v2", packageSchemaVersion: "r6-production-reconciliation-execution-package-v4", targetIdentitySchemaVersion: "r6-production-target-identity-v2", targetIdentityCanonicalSha256: hash("target"), runtimeRoutingSchemaVersion: "r6-production-runtime-routing-identity-v1", runtimeRoutingArtifactSha256: hash("routing"), expectedProjectRef: "xcbnxzjlsvtgzixurcof", launcherSha256, secureWrapperSha256: hash("wrapper") };
  validateLauncherBindingV2(binding); await writeFile(bindingPath, JSON.stringify(binding));
  const escaped = launcherPath.replace(/'/g, "''");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; [ScriptBlock]::Create((Get-Content -LiteralPath '${escaped}' -Raw)) | Out-Null`]);
  const packageRoot = path.join(temp, "package");
  await issueProductionReconciliationV4Package({ packageRoot, repositoryRoot: root, implementationCommit: commit, launcherSha256, secureWrapperSha256: binding.secureWrapperSha256, baselineSha256: "adec5b5933cc70869be55efbabb613b555c890f0e755e01b13b28696e67c9b4a" });
  const candidate = await buildAuthorizationV4FromPackage({ packageRoot, repositoryRoot: root, transportImplementationCommit: commit, transportLauncherSha256: launcherSha256, transportSha256, requiredConfirmationPhrase: "test-only" });
  const authorizationPath = path.join(temp, "candidate-v3.json"); await writeFile(authorizationPath, JSON.stringify(candidate));
  const noSecrets = { ...process.env }; for (const key of ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "DATABASE_URL", "SUPABASE_DB_URL", "R6_PRODUCTION_RECONCILIATION_DATABASE_URL"]) delete noSecrets[key];
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launcherPath, "-AuthorizationPath", authorizationPath, "-PackageRoot", packageRoot, "-Mode", "Execute", "-FinalConfirmationPath", path.join(temp, "missing-final.json")], { env: noSecrets, stdio: ["ignore", "pipe", "pipe"] });
    assert.fail("missing final confirmation unexpectedly succeeded");
  } catch (error) {
    assert.equal(error.status, 1); assert.match(`${error.stdout}\n${error.stderr}`, /R6_PRODUCTION_RECONCILIATION_FINAL_HUMAN_CONFIRMATION_REQUIRED/);
  }
  console.log("R6_PRODUCTION_RECONCILIATION_LAUNCHER_V2_FIXTURE_READY");
} finally { await rm(temp, { recursive: true, force: true }); }
