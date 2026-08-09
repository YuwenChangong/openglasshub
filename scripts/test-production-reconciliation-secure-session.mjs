import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "r6-secure-session-"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
try {
  const launcher = path.join(temp, "fake-launcher.ps1");
  const config = path.join(temp, "config.json");
  const wrapper = path.join(temp, "secure-session.ps1");
  await writeFile(launcher, "exit 0\n");
  await writeFile(config, JSON.stringify({ launcherPath: launcher, launcherSha256: hash(await readFile(launcher)) }));
  execFileSync(process.execPath, ["scripts/qa/render-r6-production-reconciliation-secure-session.mjs", "--config", config, "--destination", wrapper], { cwd: root });
  const source = await readFile(wrapper, "utf8");
  assert.match(source, /ValidateChannelOnly', 'InvokeBoundLauncher/);
  assert.match(source, /evidenceRootAuthority='TRANSPORT_OWNED'/);
  assert.doesNotMatch(source, /R6_TEST_SECRET_DO_NOT_PERSIST/);
  const parser = `$ErrorActionPreference='Stop'; [ScriptBlock]::Create((Get-Content -LiteralPath '${wrapper.replace(/'/g, "''")}' -Raw)) | Out-Null`;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", parser], { encoding: "utf8" });
  process.stdout.write("R6_PRODUCTION_RECONCILIATION_SECURE_SESSION_TEMPLATE_READY\n");
} finally { await rm(temp, { recursive: true, force: true }); }
