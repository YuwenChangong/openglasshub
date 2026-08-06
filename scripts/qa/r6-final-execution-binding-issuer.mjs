import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { validateDryRunAuthorization } from "./r6-final-canary-execution-contract.mjs";
import { FINAL_EXECUTION_BINDING_VERSION, validateFinalExecutionBinding } from "./r6-final-execution-binding.mjs";

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// The exact outer schema fixes binding key order. Nested target bindings carry
// their own canonical hash, so their serializer order must remain untouched.
export const canonicalJson = (value) => `${JSON.stringify(value)}\n`;

export async function assertAbsent(file, code) {
  try {
    await access(file);
    fail(code);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function writeCanonicalJsonAtomically(file, value) {
  const output = path.resolve(file);
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(canonicalJson(value), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, output);
  return sha256(await readFile(output));
}

export async function createFinalExecutionBindingPayload({ worktree: suppliedWorktree, wrapper: suppliedWrapper, parentAuthorization, parentReceipt }) {
  const worktree = path.resolve(suppliedWorktree);
  const wrapper = path.resolve(suppliedWrapper);
  const parentAuthorizationPath = path.resolve(parentAuthorization);
  const parentReceiptPath = path.resolve(parentReceipt);
  const git = (...args) => execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8" }).trim();
  const head = git("rev-parse", "HEAD");
  if (!/^[a-f0-9]{40}$/.test(head)) fail("R6_FINAL_EXECUTION_BINDING_HEAD_INVALID");
  if (git("status", "--porcelain=v1", "--untracked-files=all")) fail("R6_FINAL_EXECUTION_BINDING_WORKTREE_DIRTY");
  if (path.resolve(git("rev-parse", "--show-toplevel")) !== worktree) fail("R6_FINAL_EXECUTION_BINDING_WORKTREE_INVALID");
  const [wrapperBytes, authorizationBytes, receiptBytes] = await Promise.all([readFile(wrapper), readFile(parentAuthorizationPath), readFile(parentReceiptPath)]);
  const authorization = JSON.parse(authorizationBytes.toString("utf8"));
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  validateDryRunAuthorization(authorization, { executionCommit: head, toolingCommit: head });
  if (receipt.state !== "CONSUMED" || receipt.runId !== authorization.dryRunRunId || receipt.runnerCommit !== head || authorization.executionCommit !== head || authorization.toolingCommit !== head || authorization.plannedMutationCount !== 2 || authorization.actualMutationCount !== 0 || authorization.productionMutationCount !== 0 || authorization.retryCount !== 0 || JSON.stringify(receipt.targetBinding) !== JSON.stringify(authorization.targetBinding)) fail("R6_FINAL_EXECUTION_BINDING_PARENT_INVALID");
  const plan = authorization.plan;
  if (!plan || plan.schemaVersion !== "qa-minimal-canary-mutation-plan-v2" || plan.cleanupContract !== "none" || plan.retryContract !== "none" || plan.rollbackContract !== "none" || plan.persistenceContract !== "retain-created-post-and-comment" || plan.operationCount !== 2 || plan.operations?.map((operation) => operation.id).join(",") !== "CREATE_POST,CREATE_COMMENT") fail("R6_FINAL_EXECUTION_BINDING_PARENT_INVALID");
  const blob = (relative) => git("rev-parse", `HEAD:${relative}`);
  const binding = validateFinalExecutionBinding({
    schemaVersion: FINAL_EXECUTION_BINDING_VERSION,
    executionWorktree: worktree,
    executionCommit: head,
    runnerCommit: head,
    toolingCommit: head,
    wrapperPath: wrapper,
    wrapperSha256: sha256(wrapperBytes),
    finalContractGitBlob: blob("scripts/qa/r6-final-canary-execution-contract.mjs"),
    executeRunnerGitBlob: blob("scripts/qa/run-production-minimal-canary.mjs"),
    postflightRunnerGitBlob: blob("scripts/qa/run-r6-final-canary-read-only-postflight.mjs"),
    bindingValidatorGitBlob: blob("scripts/qa/validate-r6-final-execution-binding.mjs"),
    bindingLibraryGitBlob: blob("scripts/qa/r6-final-execution-binding.mjs"),
    parentAuthorizationPath,
    parentAuthorizationSha256: sha256(authorizationBytes),
    parentReceiptPath,
    parentReceiptSha256: sha256(receiptBytes),
    parentDryRunRunId: authorization.dryRunRunId,
    planSchema: plan.schemaVersion,
    planSha256: plan.planSha256,
    targetBinding: authorization.targetBinding,
    approvedOperationIds: plan.operations.map((operation) => operation.id),
    plannedMutationCount: authorization.plannedMutationCount,
    parentActualMutationCount: authorization.actualMutationCount,
  });
  return Object.freeze({ binding, executionCommit: head });
}
