import assert from "node:assert/strict";
import { FINAL_EXECUTION_BINDING_VERSION, validateFinalExecutionBinding } from "./qa/r6-final-execution-binding.mjs";

const commit = "a".repeat(40);
const hash = "b".repeat(64);
const binding = () => ({
  schemaVersion: FINAL_EXECUTION_BINDING_VERSION,
  executionWorktree: "C:\\proof\\execution-worktree",
  executionCommit: commit,
  runnerCommit: commit,
  toolingCommit: commit,
  wrapperPath: "C:\\proof\\start-r6-detached-secure.ps1",
  wrapperSha256: hash,
  finalContractGitBlob: "c".repeat(40),
  executeRunnerGitBlob: "d".repeat(40),
  postflightRunnerGitBlob: "e".repeat(40),
  bindingValidatorGitBlob: "f".repeat(40),
  bindingLibraryGitBlob: "0".repeat(40),
  parentAuthorizationPath: "C:\\proof\\parent-authorization.json",
  parentAuthorizationSha256: "1".repeat(64),
  parentReceiptPath: "C:\\proof\\parent-receipt.json",
  parentReceiptSha256: "2".repeat(64),
  parentDryRunRunId: "qa-canary-11111111-1111-4111-8111-111111111111",
  planSchema: "qa-minimal-canary-mutation-plan-v1",
  planSha256: "3".repeat(64),
  approvedOperationIds: ["CREATE_POST", "CREATE_COMMENT"],
  plannedMutationCount: 2,
  parentActualMutationCount: 0,
});

assert.equal(validateFinalExecutionBinding(binding()).executionCommit, commit);
for (const mutate of [
  (value) => { delete value.executionWorktree; },
  (value) => { value.executionCommit = "0".repeat(40); },
  (value) => { value.runnerCommit = "0".repeat(40); },
  (value) => { value.toolingCommit = "0".repeat(40); },
  (value) => { value.approvedOperationIds = ["CREATE_COMMENT", "CREATE_POST"]; },
  (value) => { value.plannedMutationCount = 1; },
  (value) => { value.parentActualMutationCount = 1; },
]) {
  const value = binding();
  mutate(value);
  assert.throws(() => validateFinalExecutionBinding(value));
}
process.stdout.write("R6_FINAL_EXECUTION_BINDING_TEST_OK\n");
