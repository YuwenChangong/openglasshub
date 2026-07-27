import assert from "node:assert/strict";
import {
  R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_VERSION,
  validateR6V3CaptureAuthCheckOrchestrationTerminal,
} from "./qa/validate-r6-v3-capture-auth-check-orchestration-terminal.mjs";

const base = () => ({
  schemaVersion: R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_VERSION, startedAt: "2099-01-01T00:00:00.000Z", completedAt: "2099-01-01T00:00:01.000Z", executionCommit: "a".repeat(40), worktreeContract: "current-canonical-production-v3",
  outerClassification: "R6_CURRENT_CANONICAL_V3_CAPTURE_AND_AUTH_CHECK_ONLY_READY", innerClassification: null, success: true, failureStage: "complete",
  captureStarted: true, captureCompleted: true, captureSuccess: true, captureTerminalPath: "C:\\safe\\capture.json", captureTerminalSha256: "b".repeat(64), captureOuterClassification: "R6_HARDENED_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_CAPTURE_HUMAN_COMMAND_READY", captureInnerClassification: null, captureChildExitCode: 0, capturePagesRequestCount: 1,
  attestationPath: "C:\\safe\\attestation.json", attestationSha256: "c".repeat(64), attestationType: "CLOUDFLARE_PAGES_PROJECT_GET_V3", attestationIssuedAt: "2099-01-01T00:00:00.000Z", attestationExpiresAt: "2099-01-01T00:15:00.000Z", attestationFreshnessPassed: true, remainingValidityMs: 720000, minimumRequiredValidityMs: 720000,
  authCheckAuthorizedByMode: true, authCheckStarted: true, authCheckCompleted: true, authCheckSuccess: true, authCheckTerminalPath: "C:\\safe\\auth.json", authCheckTerminalSha256: "d".repeat(64), authCheckOuterClassification: "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_OK", authCheckInnerClassification: null, authCheckChildExitCode: 0,
  dryRunStarted: false, dryRunExecutionCount: 0, pagesProjectGetCount: 1, deploymentGetCount: 0, supabaseReadCount: 0, supabaseWriteCount: 0, productionMutationCount: 0, retryCount: 0,
});

assert.equal(validateR6V3CaptureAuthCheckOrchestrationTerminal(base()).classification, "R6_CURRENT_CANONICAL_V3_CAPTURE_AND_AUTH_CHECK_ONLY_READY");
for (const [name, mutate] of Object.entries({
  dryRun: (value) => { value.dryRunStarted = true; },
  mutation: (value) => { value.productionMutationCount = 1; },
  secondPagesGet: (value) => { value.pagesProjectGetCount = 2; },
  captureFailedAuthStarted: (value) => { value.captureSuccess = false; },
  freshnessFailedAuthStarted: (value) => { value.attestationFreshnessPassed = false; },
  missingAuthTerminal: (value) => { value.authCheckTerminalPath = null; },
  missingCaptureHash: (value) => { value.captureTerminalSha256 = null; },
})) {
  const value = base(); mutate(value);
  assert.throws(() => validateR6V3CaptureAuthCheckOrchestrationTerminal(value), /^Error: R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_/i, name);
}
const captureFailure = base();
captureFailure.success = false; captureFailure.outerClassification = "R6_CURRENT_CANONICAL_V3_ORCHESTRATION_CAPTURE_FAILED"; captureFailure.innerClassification = "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TARGET_MISMATCH"; captureFailure.failureStage = "capture_execution"; captureFailure.captureCompleted = true; captureFailure.captureSuccess = false; captureFailure.captureOuterClassification = "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TARGET_MISMATCH"; captureFailure.captureChildExitCode = 1; captureFailure.authCheckStarted = false; captureFailure.authCheckCompleted = false; captureFailure.authCheckSuccess = false; captureFailure.authCheckTerminalPath = null; captureFailure.authCheckTerminalSha256 = null; captureFailure.authCheckOuterClassification = null; captureFailure.authCheckInnerClassification = null; captureFailure.authCheckChildExitCode = null; captureFailure.attestationPath = null; captureFailure.attestationSha256 = null; captureFailure.attestationType = null; captureFailure.attestationIssuedAt = null; captureFailure.attestationExpiresAt = null; captureFailure.attestationFreshnessPassed = false; captureFailure.remainingValidityMs = null;
assert.equal(validateR6V3CaptureAuthCheckOrchestrationTerminal(captureFailure).classification, captureFailure.outerClassification);
process.stdout.write("R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_TEST_OK\n");
