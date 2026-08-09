import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
  process.stdout.write("R6_PRODUCTION_RECONCILIATION_LAUNCHER_FAKE_HARNESS_READY\n");
} finally { await (await import("node:fs/promises")).rm(temp, { recursive: true, force: true }); }
