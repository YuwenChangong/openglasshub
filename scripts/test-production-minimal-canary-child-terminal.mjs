import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MINIMAL_CANARY_CHILD_TERMINAL_VERSION, validateMinimalCanaryChildTerminal } from "./qa/run-production-minimal-canary.mjs";

const digest = (value) => {
  const copy = { ...value };
  delete copy.resultSha256;
  return createHash("sha256").update(JSON.stringify(copy)).digest("hex");
};
const base = () => {
  const value = {
    schemaVersion: MINIMAL_CANARY_CHILD_TERMINAL_VERSION,
    runId: "qa-canary-11111111-1111-4111-8111-111111111111",
    mode: "dry-run",
    runnerCommit: "a".repeat(40),
    expectedToolingCommit: "a".repeat(40),
    success: false,
    classification: "QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISSING",
    failureStage: "V3_ATTESTATION_VALIDATION",
    childExitCode: 1,
    resultSha256: null,
  };
  value.resultSha256 = digest(value);
  return value;
};

assert.equal(validateMinimalCanaryChildTerminal(base()).classification, "QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISSING");
for (const [name, mutate] of Object.entries({ generic: (value) => { value.classification = "QA_CANARY_FAILED"; }, mismatchedExit: (value) => { value.childExitCode = 0; }, malformedTooling: (value) => { value.expectedToolingCommit = "bad"; }, wrongHash: (value) => { value.resultSha256 = "0".repeat(64); } })) {
  const value = base();
  mutate(value);
  assert.throws(() => validateMinimalCanaryChildTerminal(value), /QA_CANARY_CHILD_TERMINAL_INVALID/, name);
}

const root = await mkdtemp(path.join(os.tmpdir(), "qa-child-terminal-"));
try {
  const terminalPath = path.join(root, "minimal-canary-child-terminal-result.json");
  const runId = "qa-canary-22222222-2222-4222-8222-222222222222";
  assert.throws(() => execFileSync(process.execPath, ["scripts/qa/run-production-minimal-canary.mjs", "--dry-run", "--run-id", runId, "--confirm-run", runId, "--child-terminal-path", terminalPath], { stdio: "pipe" }), /Command failed/);
  const observed = JSON.parse(await readFile(terminalPath, "utf8"));
  assert.equal(observed.runId, runId);
  assert.equal(observed.success, false);
  assert.equal(observed.classification, "QA_CANARY_CHILD_UNEXPECTED_FAILURE");
  assert.equal(observed.failureStage, "CHILD_EXECUTION");
  validateMinimalCanaryChildTerminal(observed);
} finally {
  await rm(root, { recursive: true, force: true });
}
process.stdout.write("PRODUCTION_MINIMAL_CANARY_CHILD_TERMINAL_TEST_OK\n");
