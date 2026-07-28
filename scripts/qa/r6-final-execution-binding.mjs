import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const FINAL_EXECUTION_BINDING_VERSION = "r6-final-execution-binding-v1";
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const RUN_ID = /^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const object = (value, code) => { if (!value || typeof value !== "object" || Array.isArray(value)) fail(code); return value; };
const text = (value, code) => { if (typeof value !== "string" || !value) fail(code); return value; };
const hash = (value, code) => { if (!SHA256.test(String(value))) fail(code); return String(value); };
const commit = (value, code) => { if (!COMMIT.test(String(value))) fail(code); return String(value); };
const exact = (value, expected, code) => { if (Object.keys(value).length !== expected.length || expected.some((key) => !(key in value))) fail(code); };

export function validateFinalExecutionBinding(value) {
  const item = object(value, "R6_FINAL_EXECUTION_BINDING_INVALID");
  const keys = ["schemaVersion", "executionWorktree", "executionCommit", "runnerCommit", "toolingCommit", "wrapperPath", "wrapperSha256", "finalContractGitBlob", "executeRunnerGitBlob", "postflightRunnerGitBlob", "bindingValidatorGitBlob", "bindingLibraryGitBlob", "parentAuthorizationPath", "parentAuthorizationSha256", "parentReceiptPath", "parentReceiptSha256", "parentDryRunRunId", "planSchema", "planSha256", "approvedOperationIds", "plannedMutationCount", "parentActualMutationCount"];
  exact(item, keys, "R6_FINAL_EXECUTION_BINDING_INVALID");
  if (item.schemaVersion !== FINAL_EXECUTION_BINDING_VERSION) fail("R6_FINAL_EXECUTION_BINDING_INVALID");
  for (const key of ["executionWorktree", "wrapperPath", "parentAuthorizationPath", "parentReceiptPath"]) text(item[key], "R6_FINAL_EXECUTION_BINDING_INVALID");
  for (const key of ["executionCommit", "runnerCommit", "toolingCommit"]) commit(item[key], "R6_FINAL_EXECUTION_BINDING_INVALID");
  if (item.executionCommit !== item.runnerCommit || item.executionCommit !== item.toolingCommit) fail("R6_FINAL_EXECUTION_BINDING_COMMIT_MISMATCH");
  for (const key of ["wrapperSha256", "parentAuthorizationSha256", "parentReceiptSha256", "planSha256"]) hash(item[key], "R6_FINAL_EXECUTION_BINDING_INVALID");
  for (const key of ["finalContractGitBlob", "executeRunnerGitBlob", "postflightRunnerGitBlob", "bindingValidatorGitBlob", "bindingLibraryGitBlob"]) commit(item[key], "R6_FINAL_EXECUTION_BINDING_INVALID");
  if (!RUN_ID.test(String(item.parentDryRunRunId))) fail("R6_FINAL_EXECUTION_BINDING_INVALID");
  if (item.planSchema !== "qa-minimal-canary-mutation-plan-v1" || item.plannedMutationCount !== 2 || item.parentActualMutationCount !== 0 || !Array.isArray(item.approvedOperationIds) || item.approvedOperationIds.length !== 2 || item.approvedOperationIds[0] !== "CREATE_POST" || item.approvedOperationIds[1] !== "CREATE_COMMENT") fail("R6_FINAL_EXECUTION_BINDING_SAFETY_INVALID");
  return Object.freeze({ ...item, bindingSha256: sha256(JSON.stringify(item)) });
}

export async function readAndValidateFinalExecutionBinding(file, expectedSha256) {
  const raw = await readFile(file);
  const actual = sha256(raw);
  if (expectedSha256 && actual !== expectedSha256) fail("R6_FINAL_EXECUTION_BINDING_SHA_MISMATCH");
  return validateFinalExecutionBinding(JSON.parse(raw.toString("utf8")));
}
