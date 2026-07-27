import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_VERSION = "r6-v3-capture-authcheck-dryrun-orchestration-terminal-result-v1";
const REQUIRED = [
  "schemaVersion", "startedAt", "completedAt", "executionCommit", "worktreeContract", "runId", "outerClassification", "innerClassification", "success", "failureStage",
  "captureAuthorizedByMode", "captureStarted", "captureCompleted", "captureSuccess", "captureTerminalPath", "captureTerminalSha256", "captureOuterClassification", "captureInnerClassification", "captureChildExitCode", "capturePagesRequestCount",
  "attestationPath", "attestationSha256", "attestationType", "attestationIssuedAt", "attestationExpiresAt",
  "authFreshnessCheckedAt", "authRemainingValidityMs", "authMinimumRequiredValidityMs", "authAttestationFreshnessPassed",
  "authCheckAuthorizedByMode", "authCheckStarted", "authCheckCompleted", "authCheckSuccess", "authCheckTerminalPath", "authCheckTerminalSha256", "authCheckOuterClassification", "authCheckInnerClassification", "authCheckChildExitCode",
  "dryRunFreshnessCheckedAt", "dryRunRemainingValidityMs", "dryRunMinimumRequiredValidityMs", "dryRunAttestationFreshnessPassed",
  "dryRunAuthorizedByMode", "dryRunStarted", "dryRunCompleted", "dryRunSuccess", "dryRunTerminalPath", "dryRunTerminalSha256", "dryRunOuterClassification", "dryRunInnerClassification", "dryRunChildExitCode", "dryRunPlannedMutationCount", "dryRunActualMutationCount",
  "pagesProjectGetCount", "deploymentGetCount", "supabaseReadCount", "supabaseWriteCount", "productionMutationCount", "retryCount",
];
const HASH = /^[a-f0-9]{64}$/;
const RUN_ID = /^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,7})?Z$/;
const SENSITIVE = /(?:password|token|authorization|cookie|apikey|service.?role|@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function pathHash(value, pathKey, hashKey) { return typeof value[pathKey] === "string" && value[pathKey].length > 0 && HASH.test(String(value[hashKey])); }
export function validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== REQUIRED.length || REQUIRED.some((key) => !(key in value))) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_SCHEMA_INVALID");
  if (value.schemaVersion !== R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_VERSION || value.worktreeContract !== "current-canonical-production-v3" || !RUN_ID.test(String(value.runId)) || ![value.startedAt, value.completedAt].every((entry) => TIME.test(String(entry))) || SENSITIVE.test(JSON.stringify(value))) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_SCHEMA_INVALID");
  for (const key of REQUIRED.filter((key) => /(?:AuthorizedByMode|Started|Completed|Success|Passed)$/.test(key))) if (typeof value[key] !== "boolean") fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_SCHEMA_INVALID");
  for (const key of REQUIRED.filter((key) => /(?:Count|Ms|Code)$/.test(key))) if (!Number.isInteger(value[key])) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_SCHEMA_INVALID");
  if (value.pagesProjectGetCount < 0 || value.pagesProjectGetCount > 1 || value.capturePagesRequestCount < 0 || value.capturePagesRequestCount > 1 || value.deploymentGetCount !== 0 || value.supabaseWriteCount !== 0 || value.productionMutationCount !== 0 || value.retryCount !== 0 || value.dryRunActualMutationCount !== 0 || value.dryRunPlannedMutationCount !== 2) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_SAFETY_INVALID");
  if (value.authCheckStarted && (!value.captureSuccess || !value.authAttestationFreshnessPassed)) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_AUTH_ORDER_INVALID");
  if (value.dryRunStarted && (!value.authCheckSuccess || !value.dryRunAttestationFreshnessPassed)) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_DRY_RUN_ORDER_INVALID");
  for (const [pathKey, hashKey] of [["captureTerminalPath", "captureTerminalSha256"], ["authCheckTerminalPath", "authCheckTerminalSha256"], ["dryRunTerminalPath", "dryRunTerminalSha256"]]) if (value.success && !pathHash(value, pathKey, hashKey)) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_EVIDENCE_INVALID");
  if (value.success) {
    if (value.outerClassification !== "R6_CURRENT_CANONICAL_V3_CAPTURE_AUTH_CHECK_AND_DRY_RUN_READY" || value.innerClassification !== null || value.failureStage !== "complete" || !value.captureSuccess || !value.authCheckSuccess || !value.dryRunSuccess || value.capturePagesRequestCount !== 1 || value.pagesProjectGetCount !== 1 || value.authCheckChildExitCode !== 0 || value.dryRunChildExitCode !== 0) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_SUCCESS_CONTRADICTION");
  } else if (!/^R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_[A-Z0-9_]+$/.test(String(value.outerClassification)) || typeof value.innerClassification !== "string" || !value.innerClassification || typeof value.failureStage !== "string" || !value.failureStage) fail("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_FAILURE_CONTRADICTION");
  return Object.freeze({ classification: value.outerClassification });
}
if (process.argv[1] && fileURLToPath(import.meta.url).replaceAll("\\", "/") === process.argv[1].replaceAll("\\", "/")) {
  try { validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal(JSON.parse(await readFile(process.argv[2], "utf8"))); process.stdout.write("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_OK\n"); }
  catch (error) { process.stderr.write(`${error?.code ?? "R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_INVALID"}\n`); process.exitCode = 1; }
}
