import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanonicalCanaryTargetBinding } from "./qa/canonical-canary-target-binding.mjs";
import { FINAL_EXECUTION_BINDING_VERSION, validateFinalExecutionBinding } from "./qa/r6-final-execution-binding.mjs";
import { finalExecutionBindingPaths, readFinalExecutionBindingForReview, validateKnownInvalidPrimaryBinding, validateReissueTerminal } from "./qa/r6-final-execution-binding-reissue.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const commit = "a".repeat(40);
const authorizationSha = "b".repeat(64);
const target = () => createCanonicalCanaryTargetBinding({ resolvedAtUtc: "2099-01-01T00:00:00.000Z", canonicalCircleId: "11111111-1111-4111-8111-111111111111", canonicalCircleSlug: "synthetic-target", baseMutationPlanSchema: "qa-minimal-canary-mutation-plan-v2", baseMutationPlanHash: "c".repeat(64), executionCommit: commit, toolingCommit: commit });
const binding = () => ({ schemaVersion: FINAL_EXECUTION_BINDING_VERSION, executionWorktree: "C:\\proof\\execution-worktree", executionCommit: commit, runnerCommit: commit, toolingCommit: commit, wrapperPath: "C:\\proof\\wrapper.ps1", wrapperSha256: "d".repeat(64), finalContractGitBlob: "1".repeat(40), executeRunnerGitBlob: "2".repeat(40), postflightRunnerGitBlob: "3".repeat(40), bindingValidatorGitBlob: "4".repeat(40), bindingLibraryGitBlob: "5".repeat(40), parentAuthorizationPath: "C:\\proof\\authorization.json", parentAuthorizationSha256: authorizationSha, parentReceiptPath: "C:\\proof\\receipt.json", parentReceiptSha256: "e".repeat(64), parentDryRunRunId: "qa-canary-11111111-1111-4111-8111-111111111111", planSchema: "qa-minimal-canary-mutation-plan-v2", planSha256: "c".repeat(64), targetBinding: target(), approvedOperationIds: ["CREATE_POST", "CREATE_COMMENT"], plannedMutationCount: 2, parentActualMutationCount: 0 });

const root = await mkdtemp(path.join(os.tmpdir(), "r6-final-binding-reissue-"));
try {
  const paths = finalExecutionBindingPaths(root);
  const primary = binding();
  await writeFile(paths.primary, JSON.stringify(primary));
  const selectedPrimary = await readFinalExecutionBindingForReview({ operatorRoot: root, expectedExecutionCommit: commit, expectedParentAuthorizationPath: primary.parentAuthorizationPath, expectedParentAuthorizationSha256: authorizationSha });
  assert.equal(selectedPrimary.selection, "primary");
  assert.equal(selectedPrimary.bindingSha256, hash(await readFile(paths.primary)));
  await rm(paths.primary);

  const invalid = binding(); invalid.bindingSha256 = hash(JSON.stringify(invalid));
  await writeFile(paths.primary, JSON.stringify(invalid));
  const known = validateKnownInvalidPrimaryBinding(invalid, hash(await readFile(paths.primary)));
  assert.equal(known.failureReasonCode, "unexpected_field_bindingSha256");
  await writeFile(paths.replacement, JSON.stringify(binding()));
  const replacementSha = hash(await readFile(paths.replacement));
  const terminal = { schemaVersion: "r6-final-execution-binding-reissue-terminal-v1", issuedAt: "2099-01-01T00:00:00.000Z", primaryInvalidBindingPath: paths.primary, primaryInvalidBindingSha256: hash(await readFile(paths.primary)), primaryFailureClassification: "R6_FINAL_EXECUTION_BINDING_INVALID", primaryFailureReasonCode: "unexpected_field_bindingSha256", replacementBindingPath: paths.replacement, replacementBindingSha256: replacementSha };
  validateReissueTerminal(terminal);
  await writeFile(paths.terminal, JSON.stringify(terminal));
  const selectedReplacement = await readFinalExecutionBindingForReview({ operatorRoot: root, expectedExecutionCommit: commit, expectedParentAuthorizationPath: invalid.parentAuthorizationPath, expectedParentAuthorizationSha256: authorizationSha });
  assert.equal(selectedReplacement.selection, "reissue");
  assert.equal(selectedReplacement.bindingSha256, replacementSha);
  await writeFile(path.join(root, "final-execution-binding-reissue-v2.json"), "{}");
  await assert.rejects(() => readFinalExecutionBindingForReview({ operatorRoot: root, expectedExecutionCommit: commit, expectedParentAuthorizationPath: invalid.parentAuthorizationPath, expectedParentAuthorizationSha256: authorizationSha }), /R6_FINAL_EXECUTION_BINDING_REISSUE_SELECTION_INVALID/);
  assert.throws(() => validateFinalExecutionBinding(invalid), /R6_FINAL_EXECUTION_BINDING_INVALID/);
  assert.equal("bindingSha256" in validateFinalExecutionBinding(binding()), false);
} finally {
  await rm(root, { recursive: true, force: true });
}
process.stdout.write("R6_FINAL_EXECUTION_BINDING_REISSUE_TEST_OK\n");
