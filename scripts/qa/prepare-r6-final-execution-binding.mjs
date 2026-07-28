import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { validateFinalExecutionBinding, FINAL_EXECUTION_BINDING_VERSION } from "./r6-final-execution-binding.mjs";

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) values.set(process.argv[index], process.argv[index + 1]);
for (const key of ["--worktree", "--wrapper", "--parent-authorization", "--parent-receipt", "--output"]) if (!values.get(key)) fail("R6_FINAL_EXECUTION_BINDING_INPUT_INVALID");
const worktree = path.resolve(values.get("--worktree"));
const wrapper = path.resolve(values.get("--wrapper"));
const parentAuthorizationPath = path.resolve(values.get("--parent-authorization"));
const parentReceiptPath = path.resolve(values.get("--parent-receipt"));
const output = path.resolve(values.get("--output"));
const git = (...args) => execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8" }).trim();
const head = git("rev-parse", "HEAD");
if (!/^[a-f0-9]{40}$/.test(head)) fail("R6_FINAL_EXECUTION_BINDING_HEAD_INVALID");
if (git("status", "--porcelain=v1", "--untracked-files=all")) fail("R6_FINAL_EXECUTION_BINDING_WORKTREE_DIRTY");
if (path.resolve(git("rev-parse", "--show-toplevel")) !== worktree) fail("R6_FINAL_EXECUTION_BINDING_WORKTREE_INVALID");
if (path.basename(output) !== "final-execution-binding.json") fail("R6_FINAL_EXECUTION_BINDING_OUTPUT_INVALID");
try { await access(output); fail("R6_FINAL_EXECUTION_BINDING_OUTPUT_EXISTS"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const [wrapperBytes, authorizationBytes, receiptBytes] = await Promise.all([readFile(wrapper), readFile(parentAuthorizationPath), readFile(parentReceiptPath)]);
const authorization = JSON.parse(authorizationBytes.toString("utf8"));
const receipt = JSON.parse(receiptBytes.toString("utf8"));
if (receipt.state !== "CONSUMED" || receipt.runId !== authorization.dryRunRunId || receipt.runnerCommit !== head || authorization.executionCommit !== head || authorization.toolingCommit !== head || authorization.plannedMutationCount !== 2 || authorization.actualMutationCount !== 0 || authorization.productionMutationCount !== 0 || authorization.retryCount !== 0) fail("R6_FINAL_EXECUTION_BINDING_PARENT_INVALID");
const plan = authorization.plan;
if (!plan || plan.schemaVersion !== "qa-minimal-canary-mutation-plan-v1" || plan.operationCount !== 2 || plan.operations?.map((operation) => operation.id).join(",") !== "CREATE_POST,CREATE_COMMENT") fail("R6_FINAL_EXECUTION_BINDING_PARENT_INVALID");
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
  approvedOperationIds: plan.operations.map((operation) => operation.id),
  plannedMutationCount: authorization.plannedMutationCount,
  parentActualMutationCount: authorization.actualMutationCount,
});
await mkdir(path.dirname(output), { recursive: true });
const temporary = `${output}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(binding)}\n`, { encoding: "utf8", flag: "wx" });
await rename(temporary, output);
process.stdout.write(`${JSON.stringify({ output, sha256: sha256(await readFile(output)), executionCommit: head })}\n`);
