import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArguments } from "./qa/issue-production-reconciliation-authorization-v1.mjs";

const root = process.cwd();
const cli = path.join(root, "scripts", "qa", "issue-production-reconciliation-authorization-v1.mjs");
const parent = await mkdtemp(path.join(os.tmpdir(), "r6-atomic-cli-"));

function argumentsFor(name, extra = []) {
  const base = path.join(parent, name);
  return [cli,
    "--package-root", path.join(base, "package"),
    "--candidate-root", path.join(base, "candidate"),
    "--execution-binding-output", path.join(base, "candidate", "execution-binding-v2.json"),
    "--test-only", "--test-authority-root", path.join(base, "confirmation-authority"),
    ...extra,
  ];
}

async function run(name, extra = []) {
  await mkdir(path.join(parent, name), { recursive: true });
  return spawnSync(process.execPath, argumentsFor(name, extra), { cwd: root, encoding: "utf8" });
}

try {
  const parsed = parseArguments([
    "--package-root", "C:\\temp\\package",
    "--candidate-root", "C:\\temp\\candidate",
    "--execution-binding-output", "C:\\temp\\candidate\\execution-binding-v2.json",
    "--test-only", "--test-authority-root", "C:\\temp\\authority",
  ]);
  assert.equal(parsed["--package-root"], "C:\\temp\\package");
  assert.equal(parsed["--test-only"], true);
  assert.throws(() => parseArguments(["--package-root", "C:\\temp\\package"]), /R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CLI_ARGUMENT_INVALID/);
  assert.throws(() => parseArguments(["--package-root", "C:\\temp\\package", "--candidate-root", "C:\\temp\\candidate", "--execution-binding-output", "C:\\temp\\candidate\\execution-binding-v2.json", "--test-authority-root", "C:\\temp\\authority"]), /R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CLI_ARGUMENT_INVALID/);

  const success = await run("success");
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /R6_PRODUCTION_RECONCILIATION_FINAL_RC_AUTHORIZATION_AWAITING_HUMAN_CONFIRMATION/);
  assert.match(success.stdout, /FRESH_CONFIRMATION_PHRASE:\r?\nCONFIRM_R6_PRODUCTION_RECONCILIATION_[A-F0-9_]+_SINGLE_USE_V5/);
  assert.equal(success.stderr, "");

  for (const [name, stage] of [["wrong-root", "authority-root-mismatch"], ["tamper", "binding-tamper"], ["duplicate", "duplicate-hash"], ["downstream", "downstream-prerequisite"]]) {
    const failure = await run(name, ["--test-failure-stage", stage]);
    assert.notEqual(failure.status, 0);
    assert.doesNotMatch(failure.stdout, /FRESH_CONFIRMATION_PHRASE|CONFIRM_R6_PRODUCTION_RECONCILIATION_/);
  }
  await mkdir(path.join(parent, "missing"), { recursive: true });
  const missingOutput = spawnSync(process.execPath, [cli, "--package-root", path.join(parent, "missing", "package"), "--candidate-root", path.join(parent, "missing", "candidate"), "--test-only", "--test-authority-root", path.join(parent, "missing", "authority")], { cwd: root, encoding: "utf8" });
  assert.notEqual(missingOutput.status, 0);
  assert.doesNotMatch(missingOutput.stdout, /FRESH_CONFIRMATION_PHRASE|CONFIRM_R6_PRODUCTION_RECONCILIATION_/);

  console.log("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CLI_CONTRACT_PASS");
  console.log("TEMP_FINAL_SINGLE_COMMAND_REHEARSAL=PASS");
  console.log("POST_ISSUANCE_OPERATOR_COMMANDS=0");
  console.log("MANUAL_ROOT_INPUT_AFTER_START=0");
  console.log("PERSISTED_EXECUTION_BINDING_V2=PASS");
  console.log("FINAL_PHRASE_DISPLAY=PASS");
} finally {
  await rm(parent, { recursive: true, force: true });
}
