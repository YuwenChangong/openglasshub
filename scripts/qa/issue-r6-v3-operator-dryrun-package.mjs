import { randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, canonicalSha256, createDryRunSourceManifest, validateDryRunSourceManifest } from "./r6-dryrun-source-chain-contract.mjs";

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
function flags(argv) { if (argv.length !== 6 || argv[0] !== "--config" || argv[2] !== "--launcher" || argv[4] !== "--manifest") fail("R6_OPERATOR_LAUNCH_ISSUE_INPUT_INVALID"); return { config: path.resolve(argv[1]), launcher: path.resolve(argv[3]), manifest: path.resolve(argv[5]) }; }
async function absent(candidate, code) { try { await access(candidate); fail(code); } catch (error) { if (error?.code !== "ENOENT") throw error; } }
async function atomicWrite(file, raw) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(raw, "utf8"); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, file);
}

const values = flags(process.argv.slice(2));
const config = JSON.parse(await readFile(values.config, "utf8"));
const testNow = config.__testNow;
const now = testNow ? () => new Date(testNow) : () => new Date();
delete config.__testNow;
config.launcherPath = values.launcher;
config.manifestPath = values.manifest;
config.launcherTerminalPath ??= path.join(path.resolve(config.operatorRoot), "launcher-terminal-result.json");
config.launcherBreadcrumbPath ??= path.join(path.resolve(config.operatorRoot), "launcher-stage-breadcrumb.json");
config.wrapperEntryMarkerPath ??= path.join(path.resolve(config.operatorRoot), "wrapper-entry-marker.json");
config.captureTerminalPath ??= path.join(path.resolve(config.evidenceRoot), "capture-auth-check-orchestration-terminal-result.json");
config.authCheckTerminalPath ??= path.join(path.resolve(config.evidenceRoot), "auth-check", "auth-check-only-terminal-result.json");
config.targetBindingPath ??= path.join(path.resolve(config.evidenceRoot), "dry-run", "canonical-canary-target-binding.json");
config.dryRunTerminalPath ??= path.join(path.resolve(config.evidenceRoot), "dry-run", "dry-run-only-terminal-result.json");
config.orchestrationTerminalPath ??= path.join(path.resolve(config.evidenceRoot), "capture-authcheck-dryrun-orchestration-terminal-result.json");
config.registryPath ??= path.join(path.resolve(config.registryRoot), "consumed-run-registry-v1.json");
config.invocationNonce = randomUUID();
config.receiptPath ??= path.join(path.resolve(config.registryRoot), "consumed-run-receipts-v1", config.runId, `${config.invocationNonce}.json`);

// Every observable target is checked before the operator root or launcher is created.
for (const candidate of [config.operatorRoot, config.evidenceRoot, values.launcher, values.manifest, config.launcherTerminalPath, config.launcherBreadcrumbPath, config.wrapperEntryMarkerPath, config.captureTerminalPath, config.authCheckTerminalPath, config.targetBindingPath, config.dryRunTerminalPath, config.orchestrationTerminalPath, config.receiptPath]) await absent(path.resolve(candidate), "R6_OPERATOR_LAUNCH_SINGLE_USE_PATH_CONFLICT");
const manifest = createDryRunSourceManifest(config, { now, atomicOAuth: config.atomicOAuth === true });
validateDryRunSourceManifest(manifest);
const raw = canonicalJson(manifest);
const manifestSha256 = canonicalSha256(manifest);
let createdOperatorRoot = false;
try {
  await mkdir(path.dirname(values.launcher), { recursive: true });
  await mkdir(config.operatorRoot, { recursive: false }); createdOperatorRoot = true;
  await atomicWrite(values.manifest, raw);
  const renderConfig = { ...config, manifestSha256 };
  const configPath = path.join(os.tmpdir(), `r6-dryrun-render-${process.pid}-${randomUUID()}.json`);
  try {
    await writeFile(configPath, canonicalJson(renderConfig), "utf8");
    execFileSync(process.execPath, [fileURLToPath(new URL("./render-r6-v3-operator-dryrun-launcher.mjs", import.meta.url)), "--config", configPath, "--destination", values.launcher], { stdio: "pipe" });
  } finally { await rm(configPath, { force: true }); }
  process.stdout.write(`${JSON.stringify({ launcher: values.launcher, manifest: values.manifest, launcherSha256: (await import("node:crypto")).createHash("sha256").update(await readFile(values.launcher)).digest("hex"), manifestSha256, terminalPath: manifest.launcherTerminalPath })}\n`);
} catch (error) {
  await rm(values.launcher, { force: true });
  if (createdOperatorRoot) await rm(config.operatorRoot, { recursive: true, force: true });
  throw error;
}
