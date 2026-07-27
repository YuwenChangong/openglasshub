import assert from "node:assert/strict";
import { R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_VERSION, validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal } from "./qa/validate-r6-v3-capture-authcheck-dryrun-orchestration-terminal.mjs";

const base = () => ({
  schemaVersion: R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_VERSION, startedAt: "2099-01-01T00:00:00.000Z", completedAt: "2099-01-01T00:00:01.000Z", executionCommit: "a".repeat(40), worktreeContract: "current-canonical-production-v3", runId: "qa-canary-11111111-1111-4111-8111-111111111111", outerClassification: "R6_CURRENT_CANONICAL_V3_CAPTURE_AUTH_CHECK_AND_DRY_RUN_READY", innerClassification: null, success: true, failureStage: "complete",
  captureAuthorizedByMode: true, captureStarted: true, captureCompleted: true, captureSuccess: true, captureTerminalPath: "C:\\safe\\capture.json", captureTerminalSha256: "a".repeat(64), captureOuterClassification: "R6_HARDENED_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_CAPTURE_HUMAN_COMMAND_READY", captureInnerClassification: null, captureChildExitCode: 0, capturePagesRequestCount: 1,
  attestationPath: "C:\\safe\\attestation.json", attestationSha256: "b".repeat(64), attestationType: "CLOUDFLARE_PAGES_PROJECT_GET_V3", attestationIssuedAt: "2099-01-01T00:00:00.000Z", attestationExpiresAt: "2099-01-01T00:15:00.000Z",
  authFreshnessCheckedAt: "2099-01-01T00:00:00.000Z", authRemainingValidityMs: 720000, authMinimumRequiredValidityMs: 720000, authAttestationFreshnessPassed: true,
  authenticationCompleted: true, sessionValidated: true, authenticatedCheckCompleted: true,
  authCheckAuthorizedByMode: true, authCheckStarted: true, authCheckCompleted: true, authCheckSuccess: true, authCheckTerminalPath: "C:\\safe\\auth.json", authCheckTerminalSha256: "c".repeat(64), authCheckOuterClassification: "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_OK", authCheckInnerClassification: null, authCheckChildExitCode: 0,
  dryRunFreshnessCheckedAt: "2099-01-01T00:00:00.000Z", dryRunRemainingValidityMs: 720000, dryRunMinimumRequiredValidityMs: 720000, dryRunAttestationFreshnessPassed: true,
  dryRunAuthorizedByMode: true, dryRunStarted: true, dryRunCompleted: true, dryRunSuccess: true, dryRunTerminalPath: "C:\\safe\\dry.json", dryRunTerminalSha256: "d".repeat(64), dryRunOuterClassification: "R6_CURRENT_CANONICAL_V3_DRY_RUN_ONLY_READY", dryRunInnerClassification: null, dryRunChildExitCode: 0, dryRunPlannedMutationCount: 2, dryRunActualMutationCount: 0,
  pagesProjectGetCount: 1, deploymentGetCount: 0, supabaseReadCount: 0, supabaseWriteCount: 0, productionMutationCount: 0, retryCount: 0,
});
assert.equal(validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal(base()).classification, "R6_CURRENT_CANONICAL_V3_CAPTURE_AUTH_CHECK_AND_DRY_RUN_READY");
const receiptBindingFailure = base();
receiptBindingFailure.success = false;
receiptBindingFailure.outerClassification = "R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED";
receiptBindingFailure.innerClassification = "QA_CANARY_CONSUMED_RUN_RECEIPT_BINDING_MISMATCH";
receiptBindingFailure.failureStage = "RECEIPT_BINDING_VALIDATION";
receiptBindingFailure.dryRunSuccess = false;
receiptBindingFailure.dryRunChildExitCode = 1;
assert.equal(validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal(receiptBindingFailure).classification, "R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED");
const reservationFailure = base();
reservationFailure.success = false;
reservationFailure.outerClassification = "R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED";
reservationFailure.innerClassification = "R6_CONSUMED_RUN_TOOL_FAILED";
reservationFailure.failureStage = "RUN_ID_RESERVATION";
reservationFailure.dryRunSuccess = false;
reservationFailure.dryRunChildExitCode = 1;
reservationFailure.dryRunInnerClassification = "R6_CONSUMED_RUN_TOOL_FAILED";
assert.equal(validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal(reservationFailure).classification, "R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED");
for (const [name, mutate] of Object.entries({ capture: (v) => { v.captureSuccess = false; }, auth: (v) => { v.authCheckSuccess = false; }, authState: (v) => { v.sessionValidated = false; }, dry: (v) => { v.dryRunSuccess = false; }, order: (v) => { v.authCheckSuccess = false; }, mutation: (v) => { v.productionMutationCount = 1; }, pages: (v) => { v.pagesProjectGetCount = 2; }, runId: (v) => { v.runId = "bad"; }, authLeak: (v) => { v.success = false; v.outerClassification = "R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED"; v.innerClassification = "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_UNEXPECTED_FAILURE"; v.dryRunSuccess = false; v.dryRunChildExitCode = 1; v.dryRunInnerClassification = "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_UNEXPECTED_FAILURE"; } })) {
  const value = base(); mutate(value); assert.throws(() => validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal(value), /^Error: R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_/, name);
}
process.stdout.write("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_TEST_OK\n");
