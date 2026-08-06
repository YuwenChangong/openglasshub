import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createCanonicalCanaryTargetBinding } from "./qa/canonical-canary-target-binding.mjs";
import { FINAL_AUTHORIZATION_VERSION, getMinimalCanaryMutationPlan } from "./qa/r6-final-canary-execution-contract.mjs";
import { FINAL_EXECUTION_BINDING_VERSION } from "./qa/r6-final-execution-binding.mjs";
import { PARENT_SAME_COMMIT_READY, REISSUE_READY_CLASSIFICATION, finalExecutionBindingPaths, readFinalExecutionBindingForReview, validateReissueTerminal } from "./qa/r6-final-execution-binding-reissue.mjs";

const root = process.cwd();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const git = (worktree, args) => execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8" }).trim();
const parent = await mkdtemp(path.join(os.tmpdir(), "r6-final-binding-reissue-parent-"));
const operator = await mkdtemp(path.join(os.tmpdir(), "r6-final-binding-reissue-operator-"));
try {
  const required = ["r6-final-canary-execution-contract.mjs", "run-production-minimal-canary.mjs", "run-r6-final-canary-read-only-postflight.mjs", "validate-r6-final-execution-binding.mjs", "r6-final-execution-binding.mjs"];
  await mkdir(path.join(parent, "scripts", "qa"), { recursive: true });
  await Promise.all(required.map((name) => copyFile(path.join(root, "scripts", "qa", name), path.join(parent, "scripts", "qa", name))));
  const wrapper = path.join(parent, "wrapper.ps1"); await writeFile(wrapper, "# synthetic wrapper\n");
  execFileSync("git", ["-C", parent, "init", "-q"]); execFileSync("git", ["-C", parent, "config", "user.email", "fixture@example.invalid"]); execFileSync("git", ["-C", parent, "config", "user.name", "fixture"]); execFileSync("git", ["-C", parent, "add", "scripts", "wrapper.ps1"]); execFileSync("git", ["-C", parent, "commit", "-qm", "fixture"]);
  const commit = git(parent, ["rev-parse", "HEAD"]); const runId = "qa-canary-33333333-3333-4333-8333-333333333333"; const plan = getMinimalCanaryMutationPlan();
  const targetBinding = createCanonicalCanaryTargetBinding({ resolvedAtUtc: "2099-01-01T00:00:00.000Z", canonicalCircleId: "33333333-3333-4333-8333-333333333333", canonicalCircleSlug: "synthetic-target", baseMutationPlanSchema: plan.schemaVersion, baseMutationPlanHash: plan.planSha256, executionCommit: commit, toolingCommit: commit });
  const receipt = path.join(operator, "receipt.json"); await writeFile(receipt, JSON.stringify({ state: "CONSUMED", runId, runnerCommit: commit, targetBinding })); const receiptSha = hash(await readFile(receipt));
  const authorization = path.join(operator, "final-dryrun-authorization.json"); const authorizationValue = { schemaVersion: FINAL_AUTHORIZATION_VERSION, dryRunRunId: runId, dryRunReceiptPath: receipt, dryRunReceiptSha256: receiptSha, dryRunTerminalPath: path.join(operator, "dry-run.json"), dryRunTerminalSha256: "a".repeat(64), dryRunOrchestrationTerminalPath: path.join(operator, "orchestration.json"), dryRunOrchestrationTerminalSha256: "b".repeat(64), executionCommit: commit, toolingCommit: commit, plan, targetBinding, plannedMutationCount: 2, actualMutationCount: 0, supabaseWriteCount: 0, productionMutationCount: 0, retryCount: 0, successClassification: "R6_CURRENT_CANONICAL_V3_DRY_RUN_ONLY_READY" }; await writeFile(authorization, JSON.stringify(authorizationValue)); const authorizationSha = hash(await readFile(authorization));
  const paths = finalExecutionBindingPaths(operator); const blob = (relative) => git(parent, ["rev-parse", `HEAD:${relative}`]);
  const canonical = { schemaVersion: FINAL_EXECUTION_BINDING_VERSION, executionWorktree: parent, executionCommit: commit, runnerCommit: commit, toolingCommit: commit, wrapperPath: wrapper, wrapperSha256: hash(await readFile(wrapper)), finalContractGitBlob: blob("scripts/qa/r6-final-canary-execution-contract.mjs"), executeRunnerGitBlob: blob("scripts/qa/run-production-minimal-canary.mjs"), postflightRunnerGitBlob: blob("scripts/qa/run-r6-final-canary-read-only-postflight.mjs"), bindingValidatorGitBlob: blob("scripts/qa/validate-r6-final-execution-binding.mjs"), bindingLibraryGitBlob: blob("scripts/qa/r6-final-execution-binding.mjs"), parentAuthorizationPath: authorization, parentAuthorizationSha256: authorizationSha, parentReceiptPath: receipt, parentReceiptSha256: receiptSha, parentDryRunRunId: runId, planSchema: plan.schemaVersion, planSha256: plan.planSha256, targetBinding, approvedOperationIds: ["CREATE_POST", "CREATE_COMMENT"], plannedMutationCount: 2, parentActualMutationCount: 0 };
  await writeFile(paths.primary, JSON.stringify({ ...canonical, bindingSha256: hash(JSON.stringify(canonical)) }));
  const output = execFileSync(process.execPath, [path.join(root, "scripts", "qa", "reissue-r6-final-execution-binding.mjs"), "--worktree", parent, "--wrapper", wrapper, "--operator-root", operator, "--parent-authorization", authorization, "--parent-authorization-sha256", authorizationSha, "--parent-receipt", receipt, "--primary-binding-sha256", hash(await readFile(paths.primary))], { cwd: root, encoding: "utf8" });
  const envelope = JSON.parse(output); const terminal = validateReissueTerminal(JSON.parse(await readFile(paths.terminal, "utf8")));
  assert.equal(envelope.classification, REISSUE_READY_CLASSIFICATION); assert.equal(envelope.parentSameCommitClassification, PARENT_SAME_COMMIT_READY); assert.equal(terminal.parentExecutionCommit, commit); assert.equal(terminal.parentSameCommitClassification, PARENT_SAME_COMMIT_READY); assert.notEqual(terminal.issuerImplementationCommit, commit);
  const selected = await readFinalExecutionBindingForReview({ operatorRoot: operator, expectedExecutionCommit: commit, expectedParentAuthorizationPath: authorization, expectedParentAuthorizationSha256: authorizationSha });
  assert.equal(selected.selection, "reissue"); assert.equal(selected.parentSameCommitClassification, PARENT_SAME_COMMIT_READY);
} finally { await Promise.all([rm(parent, { recursive: true, force: true }), rm(operator, { recursive: true, force: true })]); }
process.stdout.write("R6_FINAL_EXECUTION_BINDING_REISSUE_ISSUER_TEST_OK\n");
