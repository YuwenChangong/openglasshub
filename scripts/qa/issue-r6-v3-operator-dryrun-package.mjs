import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(code) { throw Object.assign(new Error(code), { code }); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function flags(argv) { if (argv.length !== 6 || argv[0] !== "--config" || argv[2] !== "--launcher" || argv[4] !== "--manifest") fail("R6_OPERATOR_LAUNCH_ISSUE_INPUT_INVALID"); return { config: path.resolve(argv[1]), launcher: path.resolve(argv[3]), manifest: path.resolve(argv[5]) }; }
const values = flags(process.argv.slice(2));
const config = JSON.parse(await readFile(values.config, "utf8"));
for (const key of ["runId", "operatorRoot", "evidenceRoot", "executionWorktree", "wrapperPath", "wrapperSha256", "confirmationSha256"]) if (typeof config[key] !== "string" || !config[key]) fail("R6_OPERATOR_LAUNCH_ISSUE_CONFIG_INVALID");
if (!/^qa-canary-[0-9a-f-]{36}$/.test(config.runId) || !/^[a-f0-9]{64}$/.test(config.wrapperSha256) || !/^[a-f0-9]{64}$/.test(config.confirmationSha256)) fail("R6_OPERATOR_LAUNCH_ISSUE_CONFIG_INVALID");
for (const candidate of [config.operatorRoot, config.evidenceRoot, values.launcher, values.manifest]) { try { await access(candidate); fail("R6_OPERATOR_LAUNCH_SINGLE_USE_PATH_CONFLICT"); } catch (error) { if (error?.code !== "ENOENT") throw error; } }
config.manifestPath = values.manifest;
config.launcherPath = values.launcher;
if (path.resolve(path.dirname(values.manifest)) !== path.resolve(config.operatorRoot)) fail("R6_OPERATOR_LAUNCH_ISSUE_OPERATOR_ROOT_INVALID");
await mkdir(path.dirname(values.launcher), { recursive: true });
const configPath = path.join(path.dirname(config.operatorRoot), ".launcher-render-config.json");
await writeFile(configPath, JSON.stringify(config), "utf8");
try {
  execFileSync(process.execPath, [fileURLToPath(new URL("./render-r6-v3-operator-dryrun-launcher.mjs", import.meta.url)), "--config", configPath, "--destination", values.launcher], { stdio: "pipe" });
  const launcherSha256 = sha256(await readFile(values.launcher));
  const terminalPath = path.join(config.operatorRoot, "launcher-terminal-result.json");
  const manifest = { schemaVersion: "r6-fresh-dryrun-launcher-binding-v2", runId: config.runId, launcherSha256, wrapperSha256: config.wrapperSha256, confirmationSha256: config.confirmationSha256, launcherTerminalPath: terminalPath, targetSlugStored: false, wrapperInvocation: "inline" };
  await mkdir(config.operatorRoot, { recursive: false });
  await writeFile(values.manifest, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  process.stdout.write(`${JSON.stringify({ launcher: values.launcher, manifest: values.manifest, launcherSha256, manifestSha256: sha256(await readFile(values.manifest)), terminalPath })}\n`);
} finally {
  try { await import("node:fs/promises").then(({ unlink }) => unlink(configPath)); } catch {}
}
