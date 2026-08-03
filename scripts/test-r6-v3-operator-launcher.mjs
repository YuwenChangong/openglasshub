import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateOperatorLaunchTerminal } from "./qa/validate-r6-v3-operator-launch-terminal.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "r6-operator-launcher-"));
const repo = path.resolve(".");
const confirmationSha256 = createHash("sha256").update("synthetic-confirmation").digest("hex");
const runId = (suffix) => `qa-canary-aaaaaaaa-bbbb-4ccc-8ddd-${suffix.padEnd(12, "a")}`;
const exists = async (file) => access(file).then(() => true, () => false);

async function issueCase(name, wrapperKind = "success") {
  const caseRoot = path.join(root, name);
  const operatorRoot = path.join(caseRoot, "operator");
  const wrapper = wrapperKind === "real-inert"
    ? path.join(repo, "scripts", "qa", "r6-detached-secure-wrapper.ps1")
    : path.join(caseRoot, "fake-wrapper.ps1");
  const launcher = path.join(caseRoot, "launcher.ps1");
  const manifest = path.join(operatorRoot, "dryrun-binding-manifest.json");
  const config = path.join(caseRoot, "config.json");
  await mkdir(caseRoot, { recursive: true });
  const wrapperBody = wrapperKind === "failure"
    ? "param([string]$ExecutionWorktree,[switch]$PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly,[string]$RunId,[string]$EvidenceRoot)\nthrow 'R6_CURRENT_CANONICAL_V3_SYNTHETIC_WRAPPER_FAILURE'\n"
    : wrapperKind === "contract-invalid"
      ? "param([string]$ExecutionWorktree)\n"
      : wrapperKind === "wrong-type"
        ? "param([string]$ExecutionWorktree,[switch]$PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly,[Security.SecureString]$RunId,[string]$EvidenceRoot)\n"
        : wrapperKind === "parameter-set-conflict"
          ? "param([Parameter(Mandatory=$true,ParameterSetName='one')][string]$ExecutionWorktree,[Parameter(Mandatory=$true,ParameterSetName='two')][switch]$PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly,[Parameter(Mandatory=$true,ParameterSetName='two')][string]$RunId,[Parameter(Mandatory=$true,ParameterSetName='two')][string]$EvidenceRoot)\n"
          : wrapperKind === "marker-failure"
            ? "param([string]$ExecutionWorktree,[switch]$PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly,[string]$RunId,[string]$EvidenceRoot)\nthrow 'R6_OPERATOR_LAUNCH_MARKER_PATH_INVALID'\n"
            : wrapperKind === "parse-failure"
              ? "param([string]$ExecutionWorktree\n"
    : "param([string]$ExecutionWorktree,[switch]$PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly,[string]$RunId,[string]$EvidenceRoot)\n[IO.File]::WriteAllText($env:R6_OPERATOR_LAUNCHER_ENTRY_MARKER_PATH, '{\\\"schemaVersion\\\":\\\"r6-v3-operator-launch-marker-v1\\\"}', [Text.UTF8Encoding]::new($false))\nWrite-Output 'R6_CURRENT_CANONICAL_V3_CAPTURE_AUTH_CHECK_AND_DRY_RUN_READY'\n";
  if (wrapperKind !== "real-inert") await writeFile(wrapper, wrapperBody, "utf8");
  const wrapperSha256 = createHash("sha256").update(await readFile(wrapper)).digest("hex");
  await writeFile(config, JSON.stringify({ runId: runId(name.replace(/[^a-f]/g, "a").slice(0, 12)), operatorRoot, evidenceRoot: path.join(caseRoot, "evidence"), executionWorktree: caseRoot, wrapperPath: wrapper, wrapperSha256, confirmationSha256 }), "utf8");
  execFileSync(process.execPath, ["scripts/qa/issue-r6-v3-operator-dryrun-package.mjs", "--config", config, "--launcher", launcher, "--manifest", manifest], { cwd: repo, stdio: "pipe" });
  return { caseRoot, operatorRoot, wrapper, launcher, manifest };
}

async function terminalFor(item) { const value = JSON.parse(await readFile(path.join(item.operatorRoot, "launcher-terminal-result.json"), "utf8")); try { validateOperatorLaunchTerminal(value); } catch (error) { throw new Error(`${error.message}:${JSON.stringify(value)}`); } return value; }
function invoke(item, args, env = {}) { return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", item.launcher, ...args], { encoding: "utf8", env: { ...process.env, ...env } }); }

try {
  const validateOnly = await issueCase("validateonly");
  const source = await readFile(validateOnly.launcher, "utf8");
  const manifestValue = JSON.parse(await readFile(validateOnly.manifest, "utf8"));
  assert.equal(manifestValue.launcherSha256, createHash("sha256").update(source).digest("hex"));
  assert.match(source, /try \{/); assert.match(source, /Read-Host/); assert.match(source, /Write-AtomicJson/);
  assert.doesNotMatch(source, /confirmation phrase\s*=|password\s*=|access[_-]?token/i);
  const parser = invoke(validateOnly, ["-ValidateOnly"]);
  assert.equal(parser.status, 0); assert.equal(parser.stdout.trim(), "R6_OPERATOR_LAUNCH_VALIDATE_ONLY_READY"); assert.equal((await terminalFor(validateOnly)).success, true);

  const eof = await issueCase("eof");
  const eofResult = invoke(eof, [], { R6_OPERATOR_LAUNCH_TEST_MODE: "1", R6_OPERATOR_LAUNCH_TEST_INPUT_KIND: "eof" });
  assert.equal(eofResult.status, 1); assert.equal((await terminalFor(eof)).classification, "R6_OPERATOR_LAUNCH_INPUT_EOF");

  const cancel = await issueCase("cancel");
  const cancelResult = invoke(cancel, [], { R6_OPERATOR_LAUNCH_TEST_MODE: "1", R6_OPERATOR_LAUNCH_TEST_INPUT_KIND: "cancel" });
  assert.equal(cancelResult.status, 1); assert.equal((await terminalFor(cancel)).classification, "R6_OPERATOR_LAUNCH_INPUT_CANCELLED");

  const noninteractive = await issueCase("noninteractive");
  const noninteractiveResult = invoke(noninteractive, []);
  assert.equal(noninteractiveResult.status, 1); assert.equal((await terminalFor(noninteractive)).classification, "R6_OPERATOR_LAUNCH_INTERACTIVE_HOST_REQUIRED");

  const success = await issueCase("success");
  const successResult = invoke(success, [], { R6_OPERATOR_LAUNCH_TEST_MODE: "1", R6_OPERATOR_LAUNCH_TEST_INPUT_KIND: "valid" });
  const successTerminal = await terminalFor(success); assert.equal(successResult.status, 0, `${successTerminal.classification}:${successTerminal.currentStage}:${successTerminal.errorClass}`); assert.equal(successTerminal.success, true); assert.equal(successTerminal.wrapperInvocationStarted, true); assert.equal(successTerminal.wrapperEntryConfirmed, true);

  const wrapperFailure = await issueCase("wrapperfailure", "failure");
  const wrapperFailureResult = invoke(wrapperFailure, [], { R6_OPERATOR_LAUNCH_TEST_MODE: "1", R6_OPERATOR_LAUNCH_TEST_INPUT_KIND: "valid" });
  assert.equal(wrapperFailureResult.status, 1); assert.equal((await terminalFor(wrapperFailure)).classification, "R6_CURRENT_CANONICAL_V3_SYNTHETIC_WRAPPER_FAILURE");

  const contractInvalid = await issueCase("contractinvalid", "contract-invalid");
  const contractInvalidResult = invoke(contractInvalid, [], { R6_OPERATOR_LAUNCH_TEST_MODE: "1", R6_OPERATOR_LAUNCH_TEST_INPUT_KIND: "valid" });
  assert.equal(contractInvalidResult.status, 1); assert.equal((await terminalFor(contractInvalid)).classification, "R6_OPERATOR_LAUNCH_WRAPPER_PARAMETER_CONTRACT_INVALID");

  const wrongType = await issueCase("wrongtype", "wrong-type");
  const wrongTypeResult = invoke(wrongType, [], { R6_OPERATOR_LAUNCH_TEST_MODE: "1", R6_OPERATOR_LAUNCH_TEST_INPUT_KIND: "valid" });
  assert.equal(wrongTypeResult.status, 1); assert.equal((await terminalFor(wrongType)).classification, "R6_OPERATOR_LAUNCH_WRAPPER_PARAMETER_CONTRACT_INVALID");

  const parameterSetConflict = await issueCase("parametersetconflict", "parameter-set-conflict");
  const parameterSetConflictResult = invoke(parameterSetConflict, [], { R6_OPERATOR_LAUNCH_TEST_MODE: "1", R6_OPERATOR_LAUNCH_TEST_INPUT_KIND: "valid" });
  assert.equal(parameterSetConflictResult.status, 1); assert.equal((await terminalFor(parameterSetConflict)).classification, "R6_OPERATOR_LAUNCH_WRAPPER_PARAMETER_BINDING_FAILED");

  const markerFailure = await issueCase("markerfailure", "marker-failure");
  const markerFailureResult = invoke(markerFailure, [], { R6_OPERATOR_LAUNCH_TEST_MODE: "1", R6_OPERATOR_LAUNCH_TEST_INPUT_KIND: "valid" });
  assert.equal(markerFailureResult.status, 1); assert.equal((await terminalFor(markerFailure)).classification, "R6_OPERATOR_LAUNCH_WRAPPER_ENTRY_MARKER_FAILED");

  const parseFailure = await issueCase("parsefailure", "parse-failure");
  const parseFailureResult = invoke(parseFailure, [], { R6_OPERATOR_LAUNCH_TEST_MODE: "1", R6_OPERATOR_LAUNCH_TEST_INPUT_KIND: "valid" });
  assert.equal(parseFailureResult.status, 1); assert.equal((await terminalFor(parseFailure)).classification, "R6_OPERATOR_LAUNCH_WRAPPER_SCRIPT_INVALID");

  const missingWrapper = await issueCase("missingwrapper");
  await rm(missingWrapper.wrapper);
  const missingWrapperResult = invoke(missingWrapper, [], { R6_OPERATOR_LAUNCH_TEST_MODE: "1", R6_OPERATOR_LAUNCH_TEST_INPUT_KIND: "valid" });
  assert.equal(missingWrapperResult.status, 1); assert.equal((await terminalFor(missingWrapper)).classification, "R6_OPERATOR_LAUNCH_WRAPPER_SCRIPT_INVALID");

  const realInert = await issueCase("realinert", "real-inert");
  const realInertResult = invoke(realInert, [], { R6_OPERATOR_LAUNCH_TEST_MODE: "1", R6_OPERATOR_LAUNCH_TEST_INPUT_KIND: "valid", R6_OPERATOR_LAUNCHER_INERT_TEST_MODE: "1" });
  const realInertTerminal = await terminalFor(realInert);
  assert.equal(realInertResult.status, 1);
  assert.equal(realInertTerminal.classification, "R6_OPERATOR_LAUNCH_WRAPPER_INERT_STOPPED");
  assert.equal(realInertTerminal.wrapperInvocationStarted, true);
  assert.equal(realInertTerminal.wrapperEntryConfirmed, true);
  assert.equal(await exists(path.join(realInert.caseRoot, "evidence")), false);

  const hardKill = await issueCase("hardkill");
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", hardKill.launcher], { env: { ...process.env, R6_OPERATOR_LAUNCH_TEST_MODE: "1", R6_OPERATOR_LAUNCH_TEST_INPUT_KIND: "block" }, stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(await exists(path.join(hardKill.operatorRoot, "launcher-stage-breadcrumb.json")), true);
  child.kill(); await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(await exists(path.join(hardKill.operatorRoot, "launcher-terminal-result.json")), false);
  console.log("R6_OPERATOR_LAUNCHER_TEMPLATE_RUNTIME_FIXTURES_OK");
} finally { await rm(root, { recursive: true, force: true }); }
