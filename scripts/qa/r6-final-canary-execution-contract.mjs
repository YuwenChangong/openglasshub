import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const FINAL_AUTHORIZATION_VERSION = "r6-final-canary-authorization-v1";
export const FINAL_TERMINAL_VERSION = "r6-final-canary-execution-terminal-result-v1";
export const FINAL_POSTFLIGHT_VERSION = "r6-final-canary-read-only-postflight-terminal-result-v1";
export const FINAL_ORCHESTRATION_VERSION = "r6-final-canary-execute-and-postflight-orchestration-terminal-result-v1";
export const PLAN_VERSION = "qa-minimal-canary-mutation-plan-v1";
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const RUN_ID = /^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const digest = (value) => sha256(JSON.stringify(value));
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const object = (value, code) => { if (!value || typeof value !== "object" || Array.isArray(value)) fail(code); return value; };
const hash = (value, code) => { if (!SHA256.test(String(value))) fail(code); return String(value); };
const runId = (value, code) => { if (!RUN_ID.test(String(value))) fail(code); return String(value); };
const commit = (value, code) => { if (!COMMIT.test(String(value))) fail(code); return String(value); };
const integer = (value, code, minimum = 0) => { if (!Number.isInteger(value) || value < minimum) fail(code); return value; };
const bool = (value, code) => { if (typeof value !== "boolean") fail(code); return value; };
const timestamp = (value, code, nullable = false) => { if (nullable && value === null) return value; if (!ISO.test(String(value)) || !Number.isFinite(Date.parse(value))) fail(code); return value; };
const pathValue = (value, code, nullable = false) => { if (nullable && value === null) return value; if (typeof value !== "string" || !value) fail(code); return value; };
function exactKeys(item, required, code) { if (Object.keys(item).length !== required.length || required.some((key) => !(key in item))) fail(code); }

export function getMinimalCanaryMutationPlan() {
  const plan = {
    schemaVersion: PLAN_VERSION,
    operationCount: 2,
    operations: [
      { id: "CREATE_POST", method: "POST", route: "/api/forum/posts", targetScope: "approved-circle" },
      { id: "CREATE_COMMENT", method: "POST", route: "/api/forum/comments", targetScope: "created-canary-post" },
    ],
    cleanupContract: "comment-then-post",
    retryPolicy: "zero",
  };
  return Object.freeze({ ...plan, planSha256: digest(plan) });
}

export function validateDryRunAuthorization(value, { productionRunId, executionCommit, toolingCommit, expectedDryRunRunId = null } = {}) {
  const item = object(value, "R6_FINAL_DRY_RUN_AUTHORIZATION_INVALID");
  const required = ["schemaVersion", "dryRunRunId", "dryRunTerminalPath", "dryRunTerminalSha256", "dryRunOrchestrationTerminalPath", "dryRunOrchestrationTerminalSha256", "executionCommit", "toolingCommit", "plan", "plannedMutationCount", "actualMutationCount", "supabaseWriteCount", "productionMutationCount", "retryCount", "successClassification"];
  if (item.schemaVersion !== FINAL_AUTHORIZATION_VERSION) fail("R6_FINAL_DRY_RUN_AUTHORIZATION_INVALID"); exactKeys(item, required, "R6_FINAL_DRY_RUN_AUTHORIZATION_INVALID");
  runId(item.dryRunRunId, "R6_FINAL_DRY_RUN_AUTHORIZATION_INVALID");
  if (expectedDryRunRunId && item.dryRunRunId !== expectedDryRunRunId) fail("R6_FINAL_DRY_RUN_AUTHORIZATION_INVALID");
  if (productionRunId && item.dryRunRunId === runId(productionRunId, "R6_FINAL_PRODUCTION_RUN_ID_INVALID")) fail("DRY_RUN_RUN_ID_NOT_EXECUTION_ELIGIBLE");
  pathValue(item.dryRunTerminalPath, "R6_FINAL_DRY_RUN_AUTHORIZATION_INVALID"); pathValue(item.dryRunOrchestrationTerminalPath, "R6_FINAL_DRY_RUN_AUTHORIZATION_INVALID"); hash(item.dryRunTerminalSha256, "R6_FINAL_DRY_RUN_AUTHORIZATION_INVALID"); hash(item.dryRunOrchestrationTerminalSha256, "R6_FINAL_DRY_RUN_AUTHORIZATION_INVALID");
  commit(item.executionCommit, "R6_FINAL_DRY_RUN_AUTHORIZATION_INVALID"); commit(item.toolingCommit, "R6_FINAL_DRY_RUN_AUTHORIZATION_INVALID");
  if ((executionCommit && item.executionCommit !== commit(executionCommit, "R6_FINAL_DRY_RUN_AUTHORIZATION_INVALID")) || (toolingCommit && item.toolingCommit !== commit(toolingCommit, "R6_FINAL_DRY_RUN_AUTHORIZATION_INVALID"))) fail("R6_FINAL_DRY_RUN_BINDING_MISMATCH");
  const plan = getMinimalCanaryMutationPlan();
  if (JSON.stringify(item.plan) !== JSON.stringify(plan) || item.plannedMutationCount !== 2 || item.actualMutationCount !== 0 || item.supabaseWriteCount !== 0 || item.productionMutationCount !== 0 || item.retryCount !== 0 || item.successClassification !== "R6_CURRENT_CANONICAL_V3_DRY_RUN_ONLY_READY") fail("R6_FINAL_DRY_RUN_SAFETY_INVALID");
  return Object.freeze({ ...item, authorizationSha256: digest(item) });
}

export function createReceiptAuthorizationBinding(authorization, { productionRunId, attestationSha256, executionCommit }) {
  const value = validateDryRunAuthorization(authorization, { productionRunId, executionCommit, toolingCommit: executionCommit });
  return Object.freeze({ schemaVersion: "r6-final-canary-authorization-binding-v1", dryRunRunId: value.dryRunRunId, dryRunTerminalSha256: value.dryRunTerminalSha256, dryRunOrchestrationTerminalSha256: value.dryRunOrchestrationTerminalSha256, planSha256: value.plan.planSha256, attestationSha256: hash(attestationSha256, "R6_FINAL_AUTHORIZATION_BINDING_INVALID"), executionCommit: value.executionCommit });
}

const executionKeys = ["schemaVersion", "startedAt", "completedAt", "outerClassification", "innerClassification", "failureStage", "success", "productionRunId", "parentDryRunRunId", "executionCommit", "toolingCommit", "actualExecutionWorktreeHead", "dryRunTerminalPath", "dryRunTerminalSha256", "dryRunOrchestrationTerminalPath", "dryRunOrchestrationTerminalSha256", "dryRunBindingPassed", "mutationPlanSchema", "mutationPlanHash", "approvedMutationCount", "plannedMutationCount", "freshAttestationPath", "freshAttestationSha256", "freshAttestationIssuedAt", "freshAttestationExpiresAt", "attestationFreshnessPassed", "liveReceiptPath", "liveReceiptSha256", "liveReceiptInitialState", "liveReceiptFinalState", "receiptBindingPassed", "executeStarted", "executeCompleted", "childStarted", "childCompleted", "childExitCode", "childTimedOut", "childTerminalPath", "childTerminalSha256", "childTerminalValidated", "adapterReached", "journalCreated", "journalPath", "journalSha256", "actualMutationCount", "unexpectedMutationCount", "retryCount", "supabaseReadCount", "supabaseWriteCount", "productionMutationCount"];

export function validateFinalExecutionTerminal(value) {
  const item = object(value, "R6_FINAL_EXECUTION_TERMINAL_INVALID");
  if (item.schemaVersion !== FINAL_TERMINAL_VERSION) fail("R6_FINAL_EXECUTION_TERMINAL_INVALID"); exactKeys(item, executionKeys, "R6_FINAL_EXECUTION_TERMINAL_INVALID");
  timestamp(item.startedAt, "R6_FINAL_EXECUTION_TERMINAL_INVALID"); timestamp(item.completedAt, "R6_FINAL_EXECUTION_TERMINAL_INVALID", true); runId(item.productionRunId, "R6_FINAL_EXECUTION_TERMINAL_INVALID"); runId(item.parentDryRunRunId, "R6_FINAL_EXECUTION_TERMINAL_INVALID"); if (item.productionRunId === item.parentDryRunRunId) fail("DRY_RUN_RUN_ID_NOT_EXECUTION_ELIGIBLE");
  for (const key of ["executionCommit", "toolingCommit", "actualExecutionWorktreeHead"]) commit(item[key], "R6_FINAL_EXECUTION_TERMINAL_INVALID");
  for (const key of ["dryRunTerminalSha256", "dryRunOrchestrationTerminalSha256", "mutationPlanHash", "freshAttestationSha256", "liveReceiptSha256"]) hash(item[key], "R6_FINAL_EXECUTION_TERMINAL_INVALID");
  for (const key of ["dryRunTerminalPath", "dryRunOrchestrationTerminalPath", "freshAttestationPath", "liveReceiptPath"]) pathValue(item[key], "R6_FINAL_EXECUTION_TERMINAL_INVALID");
  pathValue(item.childTerminalPath, "R6_FINAL_EXECUTION_TERMINAL_INVALID", true); pathValue(item.journalPath, "R6_FINAL_EXECUTION_TERMINAL_INVALID", true); if (item.childTerminalSha256 !== null) hash(item.childTerminalSha256, "R6_FINAL_EXECUTION_TERMINAL_INVALID"); if (item.journalSha256 !== null) hash(item.journalSha256, "R6_FINAL_EXECUTION_TERMINAL_INVALID");
  if (item.mutationPlanSchema !== PLAN_VERSION || item.liveReceiptInitialState !== "PENDING" || !["CONSUMED", "PENDING", "NOT_CREATED"].includes(item.liveReceiptFinalState)) fail("R6_FINAL_EXECUTION_TERMINAL_INVALID");
  for (const key of ["dryRunBindingPassed", "attestationFreshnessPassed", "receiptBindingPassed", "executeStarted", "executeCompleted", "childStarted", "childCompleted", "childTimedOut", "childTerminalValidated", "adapterReached", "journalCreated", "success"]) bool(item[key], "R6_FINAL_EXECUTION_TERMINAL_INVALID");
  for (const key of ["approvedMutationCount", "plannedMutationCount", "actualMutationCount", "unexpectedMutationCount", "retryCount", "supabaseReadCount", "supabaseWriteCount", "productionMutationCount"]) integer(item[key], "R6_FINAL_EXECUTION_TERMINAL_INVALID");
  if (!Number.isInteger(item.childExitCode) || item.actualMutationCount > 2 || item.productionMutationCount !== item.actualMutationCount) fail("R6_FINAL_EXECUTION_TERMINAL_SAFETY_INVALID");
  if (item.success) {
    if (item.failureStage !== null || item.innerClassification !== null || item.outerClassification !== "R6_FINAL_CANARY_EXECUTION_COMPLETE" || !item.dryRunBindingPassed || !item.attestationFreshnessPassed || !item.receiptBindingPassed || !item.executeStarted || !item.executeCompleted || !item.childStarted || !item.childCompleted || item.childTimedOut || item.childExitCode !== 0 || !item.childTerminalValidated || !item.adapterReached || !item.journalCreated || item.approvedMutationCount !== 2 || item.plannedMutationCount !== 2 || item.actualMutationCount !== 2 || item.unexpectedMutationCount !== 0 || item.retryCount !== 0 || item.productionMutationCount !== 2) fail("R6_FINAL_EXECUTION_TERMINAL_SAFETY_INVALID");
  } else if (item.actualMutationCount > 2 || item.retryCount !== 0) fail("R6_FINAL_EXECUTION_TERMINAL_SAFETY_INVALID");
  return Object.freeze(item);
}

const postflightKeys = ["schemaVersion", "startedAt", "completedAt", "outerClassification", "innerClassification", "failureStage", "success", "productionRunId", "parentDryRunRunId", "executionTerminalPath", "executionTerminalSha256", "executionTerminalValidated", "liveReceiptPath", "liveReceiptSha256", "liveReceiptState", "receiptVerified", "journalPath", "journalSha256", "journalVerified", "mutationPlanHash", "approvedMutationCount", "executionActualMutationCount", "verifiedMutationCount", "unexpectedMutationCount", "duplicateExecutionCount", "executionCommit", "toolingCommit", "commitBindingPassed", "supabaseReadCount", "supabaseWriteCount", "productionMutationCountDuringPostflight"];
export function validateFinalPostflight(value) {
  const item = object(value, "R6_FINAL_POSTFLIGHT_INVALID"); if (item.schemaVersion !== FINAL_POSTFLIGHT_VERSION) fail("R6_FINAL_POSTFLIGHT_INVALID"); exactKeys(item, postflightKeys, "R6_FINAL_POSTFLIGHT_INVALID");
  timestamp(item.startedAt, "R6_FINAL_POSTFLIGHT_INVALID"); timestamp(item.completedAt, "R6_FINAL_POSTFLIGHT_INVALID", true); runId(item.productionRunId, "R6_FINAL_POSTFLIGHT_INVALID"); runId(item.parentDryRunRunId, "R6_FINAL_POSTFLIGHT_INVALID"); if (item.productionRunId === item.parentDryRunRunId) fail("R6_FINAL_POSTFLIGHT_INVALID");
  for (const key of ["executionTerminalSha256", "liveReceiptSha256", "journalSha256", "mutationPlanHash"]) hash(item[key], "R6_FINAL_POSTFLIGHT_INVALID"); for (const key of ["executionCommit", "toolingCommit"]) commit(item[key], "R6_FINAL_POSTFLIGHT_INVALID"); for (const key of ["executionTerminalPath", "liveReceiptPath", "journalPath"]) pathValue(item[key], "R6_FINAL_POSTFLIGHT_INVALID");
  for (const key of ["executionTerminalValidated", "receiptVerified", "journalVerified", "commitBindingPassed", "success"]) bool(item[key], "R6_FINAL_POSTFLIGHT_INVALID"); for (const key of ["approvedMutationCount", "executionActualMutationCount", "verifiedMutationCount", "unexpectedMutationCount", "duplicateExecutionCount", "supabaseReadCount", "supabaseWriteCount", "productionMutationCountDuringPostflight"]) integer(item[key], "R6_FINAL_POSTFLIGHT_INVALID");
  if (item.liveReceiptState !== "CONSUMED" || item.supabaseWriteCount !== 0 || item.productionMutationCountDuringPostflight !== 0) fail("R6_FINAL_POSTFLIGHT_SAFETY_INVALID");
  if (item.success && (item.failureStage !== null || item.innerClassification !== null || item.outerClassification !== "R6_FINAL_CANARY_READ_ONLY_POSTFLIGHT_COMPLETE" || !item.executionTerminalValidated || !item.receiptVerified || !item.journalVerified || !item.commitBindingPassed || item.approvedMutationCount !== 2 || item.executionActualMutationCount !== 2 || item.verifiedMutationCount !== 2 || item.unexpectedMutationCount !== 0 || item.duplicateExecutionCount !== 0 || item.supabaseReadCount < 1)) fail("R6_FINAL_POSTFLIGHT_SAFETY_INVALID");
  return Object.freeze(item);
}

const orchestrationKeys = ["schemaVersion", "startedAt", "completedAt", "outerClassification", "innerClassification", "failureStage", "success", "parentDryRunRunId", "productionRunId", "dryRunAuthorizationValidated", "freshCaptureSuccess", "freshAuthCheckSuccess", "freshAttestationFreshnessPassed", "executeStarted", "executeCompleted", "executeSuccess", "executionTerminalPath", "executionTerminalSha256", "postflightStarted", "postflightCompleted", "postflightSuccess", "postflightTerminalPath", "postflightTerminalSha256", "approvedMutationCount", "actualMutationCount", "verifiedMutationCount", "unexpectedMutationCount", "duplicateExecutionCount", "retryCount", "supabaseReadCount", "supabaseWriteCount", "productionMutationCount", "postflightWriteCount"];
export function validateFinalOrchestrationTerminal(value) {
  const item = object(value, "R6_FINAL_ORCHESTRATION_TERMINAL_INVALID"); if (item.schemaVersion !== FINAL_ORCHESTRATION_VERSION) fail("R6_FINAL_ORCHESTRATION_TERMINAL_INVALID"); exactKeys(item, orchestrationKeys, "R6_FINAL_ORCHESTRATION_TERMINAL_INVALID");
  timestamp(item.startedAt, "R6_FINAL_ORCHESTRATION_TERMINAL_INVALID"); timestamp(item.completedAt, "R6_FINAL_ORCHESTRATION_TERMINAL_INVALID", true); runId(item.parentDryRunRunId, "R6_FINAL_ORCHESTRATION_TERMINAL_INVALID"); runId(item.productionRunId, "R6_FINAL_ORCHESTRATION_TERMINAL_INVALID"); if (item.parentDryRunRunId === item.productionRunId) fail("R6_FINAL_ORCHESTRATION_TERMINAL_INVALID");
  for (const key of ["executionTerminalPath", "postflightTerminalPath"]) pathValue(item[key], "R6_FINAL_ORCHESTRATION_TERMINAL_INVALID", true); for (const key of ["executionTerminalSha256", "postflightTerminalSha256"]) { if (item[key] !== null) hash(item[key], "R6_FINAL_ORCHESTRATION_TERMINAL_INVALID"); }
  for (const key of ["dryRunAuthorizationValidated", "freshCaptureSuccess", "freshAuthCheckSuccess", "freshAttestationFreshnessPassed", "executeStarted", "executeCompleted", "executeSuccess", "postflightStarted", "postflightCompleted", "postflightSuccess", "success"]) bool(item[key], "R6_FINAL_ORCHESTRATION_TERMINAL_INVALID"); for (const key of ["approvedMutationCount", "actualMutationCount", "verifiedMutationCount", "unexpectedMutationCount", "duplicateExecutionCount", "retryCount", "supabaseReadCount", "supabaseWriteCount", "productionMutationCount", "postflightWriteCount"]) integer(item[key], "R6_FINAL_ORCHESTRATION_TERMINAL_INVALID");
  if (item.actualMutationCount > 2 || item.productionMutationCount !== item.actualMutationCount || item.postflightWriteCount !== 0) fail("R6_FINAL_ORCHESTRATION_TERMINAL_SAFETY_INVALID");
  if (item.success && (item.failureStage !== null || item.innerClassification !== null || item.outerClassification !== "R6_FINAL_CANARY_EXECUTE_AND_POSTFLIGHT_COMPLETE" || !item.dryRunAuthorizationValidated || !item.freshCaptureSuccess || !item.freshAuthCheckSuccess || !item.freshAttestationFreshnessPassed || !item.executeStarted || !item.executeCompleted || !item.executeSuccess || !item.postflightStarted || !item.postflightCompleted || !item.postflightSuccess || item.approvedMutationCount !== 2 || item.actualMutationCount !== 2 || item.verifiedMutationCount !== 2 || item.unexpectedMutationCount !== 0 || item.duplicateExecutionCount !== 0 || item.retryCount !== 0 || item.productionMutationCount !== 2 || item.postflightWriteCount !== 0)) fail("R6_FINAL_ORCHESTRATION_TERMINAL_SAFETY_INVALID");
  return Object.freeze(item);
}

export async function readAndValidateFinalAuthorization(file, options) { const raw = await readFile(file, "utf8"); return validateDryRunAuthorization(JSON.parse(raw), options); }
