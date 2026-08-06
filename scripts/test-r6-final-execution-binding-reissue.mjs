import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanonicalCanaryTargetBinding } from "./qa/canonical-canary-target-binding.mjs";
import { FINAL_AUTHORIZATION_VERSION, getMinimalCanaryMutationPlan } from "./qa/r6-final-canary-execution-contract.mjs";
import { FINAL_EXECUTION_BINDING_VERSION, validateFinalExecutionBinding } from "./qa/r6-final-execution-binding.mjs";
import { PARENT_SAME_COMMIT_READY, REISSUE_READY_CLASSIFICATION, REISSUE_TERMINAL_VERSION, finalExecutionBindingPaths, readFinalExecutionBindingForReview, validateKnownInvalidPrimaryBinding, validateParentSameCommitBinding, validateReissueTerminal } from "./qa/r6-final-execution-binding-reissue.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const commit = "a".repeat(40);
const issuerCommit = "6".repeat(40);
const runId = "qa-canary-11111111-1111-4111-8111-111111111111";
const plan = getMinimalCanaryMutationPlan();
const target = () => createCanonicalCanaryTargetBinding({ resolvedAtUtc: "2099-01-01T00:00:00.000Z", canonicalCircleId: "11111111-1111-4111-8111-111111111111", canonicalCircleSlug: "synthetic-target", baseMutationPlanSchema: plan.schemaVersion, baseMutationPlanHash: plan.planSha256, executionCommit: commit, toolingCommit: commit });

const root = await mkdtemp(path.join(os.tmpdir(), "r6-final-binding-reissue-"));
try {
  const paths = finalExecutionBindingPaths(root);
  const authorizationPath = path.join(root, "final-dryrun-authorization.json");
  const receiptPath = path.join(root, "receipt.json");
  const targetBinding = target();
  await writeFile(receiptPath, JSON.stringify({ state: "CONSUMED", runId, runnerCommit: commit }));
  const receiptSha = hash(await readFile(receiptPath));
  const authorization = { schemaVersion: FINAL_AUTHORIZATION_VERSION, dryRunRunId: runId, dryRunReceiptPath: receiptPath, dryRunReceiptSha256: receiptSha, dryRunTerminalPath: path.join(root, "dry-run.json"), dryRunTerminalSha256: "d".repeat(64), dryRunOrchestrationTerminalPath: path.join(root, "orchestration.json"), dryRunOrchestrationTerminalSha256: "e".repeat(64), executionCommit: commit, toolingCommit: commit, plan, targetBinding, plannedMutationCount: 2, actualMutationCount: 0, supabaseWriteCount: 0, productionMutationCount: 0, retryCount: 0, successClassification: "R6_CURRENT_CANONICAL_V3_DRY_RUN_ONLY_READY" };
  await writeFile(authorizationPath, JSON.stringify(authorization));
  const authorizationSha = hash(await readFile(authorizationPath));
  const binding = () => ({ schemaVersion: FINAL_EXECUTION_BINDING_VERSION, executionWorktree: path.join(root, "execution-worktree"), executionCommit: commit, runnerCommit: commit, toolingCommit: commit, wrapperPath: path.join(root, "wrapper.ps1"), wrapperSha256: "f".repeat(64), finalContractGitBlob: "1".repeat(40), executeRunnerGitBlob: "2".repeat(40), postflightRunnerGitBlob: "3".repeat(40), bindingValidatorGitBlob: "4".repeat(40), bindingLibraryGitBlob: "5".repeat(40), parentAuthorizationPath: authorizationPath, parentAuthorizationSha256: authorizationSha, parentReceiptPath: receiptPath, parentReceiptSha256: receiptSha, parentDryRunRunId: runId, planSchema: plan.schemaVersion, planSha256: plan.planSha256, targetBinding, approvedOperationIds: ["CREATE_POST", "CREATE_COMMENT"], plannedMutationCount: 2, parentActualMutationCount: 0 });

  const primary = binding();
  await writeFile(paths.primary, JSON.stringify(primary));
  const selectedPrimary = await readFinalExecutionBindingForReview({ operatorRoot: root, expectedExecutionCommit: commit, expectedParentAuthorizationPath: authorizationPath, expectedParentAuthorizationSha256: authorizationSha });
  assert.equal(selectedPrimary.selection, "primary");
  assert.equal(selectedPrimary.parentSameCommitClassification, PARENT_SAME_COMMIT_READY);
  await rm(paths.primary);

  const invalid = binding(); invalid.bindingSha256 = hash(JSON.stringify(invalid));
  await writeFile(paths.primary, JSON.stringify(invalid));
  const known = validateKnownInvalidPrimaryBinding(invalid, hash(await readFile(paths.primary)));
  assert.equal(known.failureReasonCode, "unexpected_field_bindingSha256");
  await assert.rejects(() => readFinalExecutionBindingForReview({ operatorRoot: root, expectedExecutionCommit: commit, expectedParentAuthorizationPath: authorizationPath, expectedParentAuthorizationSha256: authorizationSha }), /R6_FINAL_EXECUTION_BINDING_REISSUE_SELECTION_INVALID/);

  await writeFile(paths.replacement, JSON.stringify(binding()));
  const replacementSha = hash(await readFile(paths.replacement));
  const replacement = validateFinalExecutionBinding(binding());
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const sameCommit = validateParentSameCommitBinding({ binding: replacement, parentAuthorization: authorization, parentReceipt: receipt, executionCommit: commit, parentAuthorizationPath: authorizationPath, parentAuthorizationSha256: authorizationSha, parentReceiptPath: receiptPath, parentReceiptSha256: receiptSha });
  assert.equal(sameCommit.classification, PARENT_SAME_COMMIT_READY);
  assert.throws(() => validateParentSameCommitBinding({ binding: replacement, parentAuthorization: authorization, parentReceipt: receipt, executionCommit: issuerCommit, parentAuthorizationPath: authorizationPath, parentAuthorizationSha256: authorizationSha, parentReceiptPath: receiptPath, parentReceiptSha256: receiptSha }), /R6_FINAL/);
  const terminal = { schemaVersion: REISSUE_TERMINAL_VERSION, runId, classification: REISSUE_READY_CLASSIFICATION, issuedAt: "2099-01-01T00:00:00.000Z", primaryInvalidBindingPath: paths.primary, primaryInvalidBindingSha256: hash(await readFile(paths.primary)), primaryFailureClassification: "R6_FINAL_EXECUTION_BINDING_INVALID", primaryFailureReasonCode: "unexpected_field_bindingSha256", replacementBindingPath: paths.replacement, replacementBindingSha256: replacementSha, replacementBindingSchema: FINAL_EXECUTION_BINDING_VERSION, finalAuthorizationPath: authorizationPath, finalAuthorizationSha256: authorizationSha, parentExecutionCommit: commit, issuerImplementationCommit: issuerCommit, strictValidationClassification: "R6_FINAL_EXECUTION_BINDING_STRICT_VALID", parentSameCommitClassification: PARENT_SAME_COMMIT_READY };
  validateReissueTerminal(terminal);
  assert.throws(() => validateReissueTerminal({ ...terminal, primaryFailureReasonCode: "unexpected-bindingSha256-field" }), /R6_FINAL_EXECUTION_BINDING_REISSUE_TERMINAL_INVALID/);
  await writeFile(paths.terminal, JSON.stringify(terminal));
  const selectedReplacement = await readFinalExecutionBindingForReview({ operatorRoot: root, expectedExecutionCommit: commit, expectedParentAuthorizationPath: authorizationPath, expectedParentAuthorizationSha256: authorizationSha });
  assert.equal(selectedReplacement.selection, "reissue");
  assert.equal(selectedReplacement.parentSameCommitClassification, PARENT_SAME_COMMIT_READY);
  await rm(paths.terminal);
  await assert.rejects(() => readFinalExecutionBindingForReview({ operatorRoot: root, expectedExecutionCommit: commit, expectedParentAuthorizationPath: authorizationPath, expectedParentAuthorizationSha256: authorizationSha }), /R6_FINAL_EXECUTION_BINDING_REISSUE_TERMINAL_REQUIRED/);
  assert.throws(() => validateFinalExecutionBinding(invalid), /R6_FINAL_EXECUTION_BINDING_INVALID/);
  assert.equal("bindingSha256" in validateFinalExecutionBinding(binding()), false);
} finally {
  await rm(root, { recursive: true, force: true });
}
process.stdout.write("R6_FINAL_EXECUTION_BINDING_REISSUE_TEST_OK\n");
