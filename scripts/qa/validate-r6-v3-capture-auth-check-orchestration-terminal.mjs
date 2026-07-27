import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_VERSION =
  "r6-v3-capture-auth-check-orchestration-terminal-result-v1";

const REQUIRED = [
  "schemaVersion", "startedAt", "completedAt", "executionCommit", "worktreeContract",
  "outerClassification", "innerClassification", "success", "failureStage",
  "captureStarted", "captureCompleted", "captureSuccess", "captureTerminalPath", "captureTerminalSha256", "captureOuterClassification", "captureInnerClassification", "captureChildExitCode", "capturePagesRequestCount",
  "attestationPath", "attestationSha256", "attestationType", "attestationIssuedAt", "attestationExpiresAt", "attestationFreshnessPassed", "remainingValidityMs", "minimumRequiredValidityMs",
  "authCheckAuthorizedByMode", "authCheckStarted", "authCheckCompleted", "authCheckSuccess", "authCheckTerminalPath", "authCheckTerminalSha256", "authCheckOuterClassification", "authCheckInnerClassification", "authCheckChildExitCode",
  "dryRunStarted", "dryRunExecutionCount", "pagesProjectGetCount", "deploymentGetCount", "supabaseReadCount", "supabaseWriteCount", "productionMutationCount", "retryCount",
];
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,7})?Z$/;
const digest = /^[a-f0-9]{64}$/;
const sensitive = /(?:password|token|authorization|cookie|apikey|service.?role|@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function present(value) { return typeof value === "string" && value.length > 0; }
function optionalDigest(value) { return value === null || digest.test(String(value)); }

export function validateR6V3CaptureAuthCheckOrchestrationTerminal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== REQUIRED.length || REQUIRED.some((key) => !(key in value))) fail("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_SCHEMA_INVALID");
  if (value.schemaVersion !== R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_VERSION || value.worktreeContract !== "current-canonical-production-v3") fail("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_SCHEMA_INVALID");
  if (![value.startedAt, value.completedAt].every((entry) => timestamp.test(String(entry))) || sensitive.test(JSON.stringify(value))) fail("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_SAFETY_INVALID");
  for (const key of ["success", "captureStarted", "captureCompleted", "captureSuccess", "attestationFreshnessPassed", "authCheckAuthorizedByMode", "authCheckStarted", "authCheckCompleted", "authCheckSuccess", "dryRunStarted"]) if (typeof value[key] !== "boolean") fail("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_SCHEMA_INVALID");
  for (const key of ["capturePagesRequestCount", "minimumRequiredValidityMs", "dryRunExecutionCount", "pagesProjectGetCount", "deploymentGetCount", "supabaseReadCount", "supabaseWriteCount", "productionMutationCount", "retryCount"]) if (!Number.isInteger(value[key])) fail("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_SCHEMA_INVALID");
  for (const key of ["captureChildExitCode", "remainingValidityMs", "authCheckChildExitCode"]) if (value[key] !== null && !Number.isInteger(value[key])) fail("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_SCHEMA_INVALID");
  if (value.pagesProjectGetCount < 0 || value.pagesProjectGetCount > 1 || value.capturePagesRequestCount < 0 || value.capturePagesRequestCount > 1 || value.deploymentGetCount !== 0 || value.supabaseWriteCount !== 0 || value.productionMutationCount !== 0 || value.retryCount !== 0 || value.dryRunStarted || value.dryRunExecutionCount !== 0) fail("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_SAFETY_INVALID");
  if (!optionalDigest(value.captureTerminalSha256) || !optionalDigest(value.attestationSha256) || !optionalDigest(value.authCheckTerminalSha256)) fail("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_SCHEMA_INVALID");
  if ((value.captureTerminalPath === null) !== (value.captureTerminalSha256 === null) || (value.captureTerminalPath !== null && (!present(value.captureTerminalPath) || !digest.test(String(value.captureTerminalSha256))))) fail("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_CAPTURE_INVALID");
  if (value.success && (!present(value.captureTerminalPath) || !digest.test(String(value.captureTerminalSha256)))) fail("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_CAPTURE_INVALID");
  if (value.authCheckStarted && (!value.captureSuccess || !value.attestationFreshnessPassed)) fail("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_AUTH_ORDER_INVALID");
  if ((value.authCheckTerminalPath === null) !== (value.authCheckTerminalSha256 === null) || (value.authCheckTerminalPath !== null && (!present(value.authCheckTerminalPath) || !digest.test(String(value.authCheckTerminalSha256))))) fail("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_AUTH_ORDER_INVALID");
  if (!value.attestationFreshnessPassed && value.authCheckStarted) fail("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_FRESHNESS_INVALID");
  if (!value.captureSuccess && (value.authCheckStarted || value.authCheckCompleted || value.authCheckSuccess)) fail("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_CAPTURE_AUTH_CONTRADICTION");
  if (value.success) {
    if (value.outerClassification !== "R6_CURRENT_CANONICAL_V3_CAPTURE_AND_AUTH_CHECK_ONLY_READY" || value.innerClassification !== null || value.failureStage !== "complete" || !value.captureSuccess || !value.attestationFreshnessPassed || !value.authCheckStarted || !value.authCheckCompleted || !value.authCheckSuccess || value.pagesProjectGetCount !== 1 || value.capturePagesRequestCount !== 1 || value.authCheckChildExitCode !== 0 || value.remainingValidityMs < 720000) fail("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_SUCCESS_CONTRADICTION");
  } else if (!/^R6_CURRENT_CANONICAL_V3_ORCHESTRATION_[A-Z0-9_]+$/.test(String(value.outerClassification)) || !present(value.innerClassification) || !present(value.failureStage)) {
    fail("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_FAILURE_CONTRADICTION");
  }
  return Object.freeze({ classification: value.outerClassification });
}

if (process.argv[1] && fileURLToPath(import.meta.url).replaceAll("\\", "/") === process.argv[1].replaceAll("\\", "/")) {
  try {
    validateR6V3CaptureAuthCheckOrchestrationTerminal(JSON.parse(await readFile(process.argv[2], "utf8")));
    process.stdout.write("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_OK\n");
  } catch (error) {
    process.stderr.write(`${error?.code ?? "R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_INVALID"}\n`);
    process.exitCode = 1;
  }
}
