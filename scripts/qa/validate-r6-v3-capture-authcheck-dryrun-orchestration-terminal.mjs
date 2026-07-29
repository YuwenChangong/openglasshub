import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateCanonicalCanaryTargetBinding } from "./canonical-canary-target-binding.mjs";

export const R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_VERSION = "r6-v3-capture-authcheck-dryrun-orchestration-terminal-result-v2";
const LEGACY_VERSION = "r6-v3-capture-authcheck-dryrun-orchestration-terminal-result-v1";
const REQUIRED = [
  "schemaVersion", "startedAt", "completedAt", "executionCommit", "worktreeContract", "runId", "outerClassification", "innerClassification", "success", "failureStage",
  "captureAuthorizedByMode", "captureStarted", "captureCompleted", "captureSuccess", "captureTerminalPath", "captureTerminalSha256", "captureOuterClassification", "captureInnerClassification", "captureChildExitCode", "capturePagesRequestCount",
  "attestationPath", "attestationSha256", "attestationType", "attestationIssuedAt", "attestationExpiresAt",
  "authFreshnessCheckedAt", "authRemainingValidityMs", "authMinimumRequiredValidityMs", "authAttestationFreshnessPassed",
  "authCheckAuthorizedByMode", "authCheckStarted", "authCheckCompleted", "authCheckSuccess", "authenticationCompleted", "sessionValidated", "authenticatedCheckCompleted", "authCheckTerminalPath", "authCheckTerminalSha256", "authCheckOuterClassification", "authCheckInnerClassification", "authCheckChildExitCode",
  "dryRunFreshnessCheckedAt", "dryRunRemainingValidityMs", "dryRunMinimumRequiredValidityMs", "dryRunAttestationFreshnessPassed",
  "dryRunAuthorizedByMode", "dryRunStarted", "dryRunCompleted", "dryRunSuccess", "dryRunTerminalPath", "dryRunTerminalSha256", "dryRunOuterClassification", "dryRunInnerClassification", "dryRunChildExitCode", "dryRunExecutionCommit", "dryRunReceiptRunnerCommit", "dryRunExpectedToolingCommit", "dryRunPlannedMutationCount", "dryRunActualMutationCount", "targetBinding", "targetBindingPath", "targetBindingSha256",
  "pagesProjectGetCount", "deploymentGetCount", "supabaseReadCount", "supabaseWriteCount", "productionMutationCount", "retryCount",
];
const HASH = /^[a-f0-9]{64}$/;
const RUN_ID = /^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,7})?Z$/;
const SENSITIVE = /(?:password|token|authorization|cookie|apikey|service.?role|@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function pathHash(value, pathKey, hashKey) { return typeof value[pathKey] === "string" && value[pathKey].length > 0 && HASH.test(String(value[hashKey])); }
function containsSensitiveValue(value) {
  return Object.entries(value).some(([key, entry]) => typeof entry === "string" && !["schemaVersion", "worktreeContract", "outerClassification", "innerClassification", "failureStage", "captureOuterClassification", "captureInnerClassification", "authCheckOuterClassification", "authCheckInnerClassification", "dryRunOuterClassification", "dryRunInnerClassification"].includes(key) && SENSITIVE.test(entry));
}
export function validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal(value) {
  const required = value?.schemaVersion === LEGACY_VERSION ? REQUIRED.filter((key) => !["targetBinding", "targetBindingPath", "targetBindingSha256"].includes(key)) : REQUIRED;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== required.length || required.some((key) => !(key in value))) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_SCHEMA_INVALID");
  if (![LEGACY_VERSION, R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_VERSION].includes(value.schemaVersion) || value.worktreeContract !== "current-canonical-production-v3" || !RUN_ID.test(String(value.runId)) || ![value.startedAt, value.completedAt].every((entry) => TIME.test(String(entry))) || containsSensitiveValue(value)) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_SCHEMA_INVALID");
  for (const key of REQUIRED.filter((key) => /(?:AuthorizedByMode|Started|Completed|Success|Passed)$/.test(key))) if (typeof value[key] !== "boolean") fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_SCHEMA_INVALID");
  for (const key of REQUIRED.filter((key) => /(?:Count|Ms|Code)$/.test(key))) if (!Number.isInteger(value[key])) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_SCHEMA_INVALID");
  if (value.pagesProjectGetCount < 0 || value.pagesProjectGetCount > 1 || value.capturePagesRequestCount < 0 || value.capturePagesRequestCount > 1 || value.deploymentGetCount !== 0 || value.supabaseWriteCount !== 0 || value.productionMutationCount !== 0 || value.retryCount !== 0 || value.dryRunActualMutationCount !== 0 || value.dryRunPlannedMutationCount !== 2) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_SAFETY_INVALID");
  if (value.authCheckStarted && (!value.captureSuccess || !value.authAttestationFreshnessPassed)) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_AUTH_ORDER_INVALID");
  if (value.dryRunStarted && (!value.authCheckSuccess || !value.dryRunAttestationFreshnessPassed)) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_DRY_RUN_ORDER_INVALID");
  if (value.authCheckSuccess && (!value.authenticationCompleted || !value.sessionValidated || !value.authenticatedCheckCompleted)) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_AUTH_STATE_INVALID");
  if (!value.authCheckSuccess && (value.dryRunStarted || value.dryRunCompleted || value.dryRunSuccess || value.dryRunTerminalPath !== null || value.dryRunTerminalSha256 !== null || value.dryRunOuterClassification !== null || value.dryRunInnerClassification !== null)) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_AUTH_ISOLATION_INVALID");
  if (value.dryRunInnerClassification === "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_UNEXPECTED_FAILURE") fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_STAGE_LEAK");
  if (value.schemaVersion === R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_VERSION) {
    if (value.targetBindingPath !== null && typeof value.targetBindingPath !== "string") fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_SCHEMA_INVALID");
    if (value.targetBindingSha256 !== null && !HASH.test(String(value.targetBindingSha256))) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_SCHEMA_INVALID");
    try { if (value.targetBinding !== null) validateCanonicalCanaryTargetBinding(value.targetBinding, { executionCommit: value.executionCommit, toolingCommit: value.dryRunExpectedToolingCommit ?? value.executionCommit }); }
    catch { fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_TARGET_BINDING_INVALID"); }
  }
  const receiptBindingStarted = value.dryRunReceiptRunnerCommit !== null;
  const toolingBindingStarted = value.dryRunExpectedToolingCommit !== null;
  if ((!value.dryRunStarted && (receiptBindingStarted || toolingBindingStarted)) ||
      (receiptBindingStarted && (value.dryRunExecutionCommit !== value.executionCommit || value.dryRunReceiptRunnerCommit !== value.executionCommit)) ||
      (toolingBindingStarted && (value.dryRunExecutionCommit !== value.executionCommit || value.dryRunExpectedToolingCommit !== value.executionCommit)) ||
      (toolingBindingStarted && !receiptBindingStarted) ||
      (value.dryRunSuccess && (!receiptBindingStarted || !toolingBindingStarted))) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_TOOLING_BINDING_INVALID");
  for (const [pathKey, hashKey] of [["captureTerminalPath", "captureTerminalSha256"], ["authCheckTerminalPath", "authCheckTerminalSha256"], ["dryRunTerminalPath", "dryRunTerminalSha256"]]) if (value.success && !pathHash(value, pathKey, hashKey)) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_EVIDENCE_INVALID");
  if (value.success) {
    if (value.outerClassification !== "R6_CURRENT_CANONICAL_V3_CAPTURE_AUTH_CHECK_AND_DRY_RUN_READY" || value.innerClassification !== null || value.failureStage !== "complete" || !value.captureSuccess || !value.authCheckSuccess || !value.dryRunSuccess || value.capturePagesRequestCount !== 1 || value.pagesProjectGetCount !== 1 || value.authCheckChildExitCode !== 0 || value.dryRunChildExitCode !== 0 || (value.schemaVersion === R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_VERSION && (value.targetBinding === null || value.targetBindingPath === null || value.targetBindingSha256 === null))) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_SUCCESS_CONTRADICTION");
  } else if (value.outerClassification === "R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_AUTH_CHECK_FAILED") {
    if (!value.captureSuccess || !value.authCheckStarted || !value.authCheckCompleted || value.authCheckSuccess || value.authCheckInnerClassification !== value.innerClassification || !/^AUTH_PASSWORD_GRANT_/.test(String(value.failureStage)) || value.dryRunStarted || value.dryRunSuccess) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_FAILURE_CONTRADICTION");
  } else if (!/^R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_[A-Z0-9_]+$/.test(String(value.outerClassification)) || typeof value.innerClassification !== "string" || !value.innerClassification || typeof value.failureStage !== "string" || !value.failureStage) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_FAILURE_CONTRADICTION");
  if (["QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISSING", "QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISMATCH"].includes(value.innerClassification) && (!value.captureSuccess || !value.authCheckSuccess || value.dryRunSuccess || value.failureStage !== "V3_ATTESTATION_VALIDATION")) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_TOOLING_FAILURE_CONTRADICTION");
  return Object.freeze({ classification: value.outerClassification });
}
if (process.argv[1] && fileURLToPath(import.meta.url).replaceAll("\\", "/") === process.argv[1].replaceAll("\\", "/")) {
  try { validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal(JSON.parse(await readFile(process.argv[2], "utf8"))); process.stdout.write("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_OK\n"); }
  catch (error) { process.stderr.write(`${error?.code ?? "R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_INVALID"}\n`); process.exitCode = 1; }
}
