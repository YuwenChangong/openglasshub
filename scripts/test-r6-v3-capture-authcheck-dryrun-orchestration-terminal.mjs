import assert from "node:assert/strict";
import { R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_VERSION, validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal } from "./qa/validate-r6-v3-capture-authcheck-dryrun-orchestration-terminal.mjs";
import { createCanonicalCanaryTargetBinding } from "./qa/canonical-canary-target-binding.mjs";

const target = () => createCanonicalCanaryTargetBinding({ resolvedAtUtc: "2099-01-01T00:00:00.000Z", canonicalCircleId: "11111111-1111-4111-8111-111111111111", canonicalCircleSlug: "canonical-circle", baseMutationPlanSchema: "qa-minimal-canary-mutation-plan-v1", baseMutationPlanHash: "b".repeat(64), executionCommit: "a".repeat(40), toolingCommit: "a".repeat(40) });

const base = () => ({
  schemaVersion: R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_VERSION, startedAt: "2099-01-01T00:00:00.000Z", completedAt: "2099-01-01T00:00:01.000Z", executionCommit: "a".repeat(40), worktreeContract: "current-canonical-production-v3", runId: "qa-canary-11111111-1111-4111-8111-111111111111", outerClassification: "R6_CURRENT_CANONICAL_V3_CAPTURE_AUTH_CHECK_AND_DRY_RUN_READY", innerClassification: null, success: true, failureStage: "complete",
  captureAuthorizedByMode: true, captureStarted: true, captureCompleted: true, captureSuccess: true, captureTerminalPath: "C:\\safe\\capture.json", captureTerminalSha256: "a".repeat(64), captureOuterClassification: "R6_HARDENED_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_CAPTURE_HUMAN_COMMAND_READY", captureInnerClassification: null, captureChildExitCode: 0, capturePagesRequestCount: 1,
  attestationPath: "C:\\safe\\attestation.json", attestationSha256: "b".repeat(64), attestationType: "CLOUDFLARE_PAGES_PROJECT_GET_V3", attestationIssuedAt: "2099-01-01T00:00:00.000Z", attestationExpiresAt: "2099-01-01T00:15:00.000Z",
  authFreshnessCheckedAt: "2099-01-01T00:00:00.000Z", authRemainingValidityMs: 720000, authMinimumRequiredValidityMs: 720000, authAttestationFreshnessPassed: true,
  authenticationCompleted: true, sessionValidated: true, authenticatedCheckCompleted: true,
  authCheckAuthorizedByMode: true, authCheckStarted: true, authCheckCompleted: true, authCheckSuccess: true, authCheckTerminalPath: "C:\\safe\\auth.json", authCheckTerminalSha256: "c".repeat(64), authCheckOuterClassification: "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_OK", authCheckInnerClassification: null, authCheckChildExitCode: 0,
  dryRunFreshnessCheckedAt: "2099-01-01T00:00:00.000Z", dryRunRemainingValidityMs: 720000, dryRunMinimumRequiredValidityMs: 720000, dryRunAttestationFreshnessPassed: true,
  dryRunAuthorizedByMode: true, dryRunStarted: true, dryRunCompleted: true, dryRunSuccess: true, dryRunTerminalPath: "C:\\safe\\dry.json", dryRunTerminalSha256: "d".repeat(64), dryRunOuterClassification: "R6_CURRENT_CANONICAL_V3_DRY_RUN_ONLY_READY", dryRunInnerClassification: null, dryRunChildExitCode: 0, dryRunExecutionCommit: "a".repeat(40), dryRunReceiptRunnerCommit: "a".repeat(40), dryRunExpectedToolingCommit: "a".repeat(40), dryRunPlannedMutationCount: 2, dryRunActualMutationCount: 0, targetBinding: target(), targetBindingPath: "C:\\safe\\canonical-canary-target-binding.json", targetBindingSha256: "e".repeat(64),
  dryRunAuthenticationCompleted: true, targetResolutionStarted: true, targetResolutionCompleted: true, targetResolutionSucceeded: true, targetResolutionFailureCategory: null, targetResultCountClass: "ONE", targetEligibleState: "ELIGIBLE", canonicalCircleIdResolved: true, canonicalCircleSlugResolved: true, targetBindingArtifactPresent: true, targetBindingValidationPassed: true, targetBindingCreated: true, targetBindingHashCreated: true, targetBoundExecutionPlanHashCreated: true,
  pagesProjectGetCount: 1, deploymentGetCount: 0, supabaseReadCount: 0, supabaseWriteCount: 0, productionMutationCount: 0, retryCount: 0,
});
assert.equal(validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal(base()).classification, "R6_CURRENT_CANONICAL_V3_CAPTURE_AUTH_CHECK_AND_DRY_RUN_READY");
const historicV2 = base();
historicV2.schemaVersion = "r6-v3-capture-authcheck-dryrun-orchestration-terminal-result-v2";
for (const key of ["dryRunAuthenticationCompleted", "targetResolutionStarted", "targetResolutionCompleted", "targetResolutionSucceeded", "targetResolutionFailureCategory", "targetResultCountClass", "targetEligibleState", "canonicalCircleIdResolved", "canonicalCircleSlugResolved", "targetBindingArtifactPresent", "targetBindingValidationPassed", "targetBindingCreated", "targetBindingHashCreated", "targetBoundExecutionPlanHashCreated"]) delete historicV2[key];
assert.equal(validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal(historicV2).classification, "R6_CURRENT_CANONICAL_V3_CAPTURE_AUTH_CHECK_AND_DRY_RUN_READY");
const targetResolutionFailure = base();
targetResolutionFailure.success = false;
targetResolutionFailure.outerClassification = "R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED";
targetResolutionFailure.innerClassification = "QA_CANARY_TARGET_NOT_FOUND";
targetResolutionFailure.failureStage = "TARGET_RESOLUTION";
targetResolutionFailure.dryRunSuccess = false;
targetResolutionFailure.dryRunOuterClassification = "R6_CURRENT_CANONICAL_V3_DRY_RUN_FAILED";
targetResolutionFailure.dryRunInnerClassification = "QA_CANARY_TARGET_NOT_FOUND";
targetResolutionFailure.dryRunChildExitCode = 1;
targetResolutionFailure.targetResolutionSucceeded = false;
targetResolutionFailure.targetResolutionFailureCategory = "TARGET_NOT_FOUND";
targetResolutionFailure.targetResultCountClass = "ZERO";
targetResolutionFailure.targetEligibleState = "UNKNOWN";
targetResolutionFailure.canonicalCircleIdResolved = false;
targetResolutionFailure.canonicalCircleSlugResolved = false;
targetResolutionFailure.targetBindingArtifactPresent = false;
targetResolutionFailure.targetBindingValidationPassed = false;
targetResolutionFailure.targetBindingCreated = false;
targetResolutionFailure.targetBindingHashCreated = false;
targetResolutionFailure.targetBoundExecutionPlanHashCreated = false;
targetResolutionFailure.targetBinding = null;
targetResolutionFailure.targetBindingPath = null;
targetResolutionFailure.targetBindingSha256 = null;
targetResolutionFailure.dryRunReceiptRunnerCommit = null;
targetResolutionFailure.dryRunExpectedToolingCommit = null;
assert.equal(validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal(targetResolutionFailure).classification, targetResolutionFailure.outerClassification);
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
reservationFailure.dryRunReceiptRunnerCommit = null;
reservationFailure.dryRunExpectedToolingCommit = null;
assert.equal(validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal(reservationFailure).classification, "R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED");
const preToolingAuthenticationFailure = base();
preToolingAuthenticationFailure.success = false;
preToolingAuthenticationFailure.outerClassification = "R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED";
preToolingAuthenticationFailure.innerClassification = "R6_PROJECT_REF_INVALID";
preToolingAuthenticationFailure.failureStage = "AUTHENTICATION";
preToolingAuthenticationFailure.dryRunSuccess = false;
preToolingAuthenticationFailure.dryRunChildExitCode = 1;
preToolingAuthenticationFailure.dryRunOuterClassification = "R6_CURRENT_CANONICAL_V3_DRY_RUN_FAILED";
preToolingAuthenticationFailure.dryRunInnerClassification = "R6_PROJECT_REF_INVALID";
preToolingAuthenticationFailure.dryRunExpectedToolingCommit = null;
preToolingAuthenticationFailure.dryRunAuthenticationCompleted = false;
preToolingAuthenticationFailure.targetResolutionStarted = false;
preToolingAuthenticationFailure.targetResolutionCompleted = false;
preToolingAuthenticationFailure.targetResolutionSucceeded = false;
preToolingAuthenticationFailure.targetResolutionFailureCategory = null;
preToolingAuthenticationFailure.targetResultCountClass = "UNKNOWN";
preToolingAuthenticationFailure.targetEligibleState = "UNKNOWN";
preToolingAuthenticationFailure.canonicalCircleIdResolved = false;
preToolingAuthenticationFailure.canonicalCircleSlugResolved = false;
preToolingAuthenticationFailure.targetBindingArtifactPresent = false;
preToolingAuthenticationFailure.targetBindingValidationPassed = false;
preToolingAuthenticationFailure.targetBindingCreated = false;
preToolingAuthenticationFailure.targetBindingHashCreated = false;
preToolingAuthenticationFailure.targetBoundExecutionPlanHashCreated = false;
preToolingAuthenticationFailure.targetBinding = null;
preToolingAuthenticationFailure.targetBindingPath = null;
preToolingAuthenticationFailure.targetBindingSha256 = null;
assert.equal(validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal(preToolingAuthenticationFailure).classification, "R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED");
const toolingFailure = base();
toolingFailure.success = false;
toolingFailure.outerClassification = "R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED";
toolingFailure.innerClassification = "QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISMATCH";
toolingFailure.failureStage = "V3_ATTESTATION_VALIDATION";
toolingFailure.dryRunSuccess = false;
toolingFailure.dryRunChildExitCode = 1;
toolingFailure.dryRunInnerClassification = toolingFailure.innerClassification;
assert.equal(validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal(toolingFailure).classification, "R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED");
const authFailure = base();
authFailure.success = false;
authFailure.outerClassification = "R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_AUTH_CHECK_FAILED";
authFailure.innerClassification = "R6_AUTH_HTTP_UNAUTHORIZED";
authFailure.failureStage = "AUTH_PASSWORD_GRANT_REQUEST";
authFailure.authCheckCompleted = true;
authFailure.authCheckSuccess = false;
authFailure.authCheckOuterClassification = "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_FAILED";
authFailure.authCheckInnerClassification = "R6_AUTH_HTTP_UNAUTHORIZED";
authFailure.authCheckChildExitCode = 1;
authFailure.authenticationCompleted = false;
authFailure.sessionValidated = false;
authFailure.authenticatedCheckCompleted = false;
authFailure.dryRunStarted = false;
authFailure.dryRunCompleted = false;
authFailure.dryRunSuccess = false;
authFailure.dryRunTerminalPath = null;
authFailure.dryRunTerminalSha256 = null;
authFailure.dryRunOuterClassification = null;
authFailure.dryRunInnerClassification = null;
authFailure.dryRunChildExitCode = 1;
authFailure.dryRunExecutionCommit = null;
authFailure.dryRunReceiptRunnerCommit = null;
authFailure.dryRunExpectedToolingCommit = null;
authFailure.dryRunAuthenticationCompleted = false;
authFailure.targetResolutionStarted = false;
authFailure.targetResolutionCompleted = false;
authFailure.targetResolutionSucceeded = false;
authFailure.targetResolutionFailureCategory = null;
authFailure.targetResultCountClass = "UNKNOWN";
authFailure.targetEligibleState = "UNKNOWN";
authFailure.canonicalCircleIdResolved = false;
authFailure.canonicalCircleSlugResolved = false;
authFailure.targetBindingArtifactPresent = false;
authFailure.targetBindingValidationPassed = false;
authFailure.targetBindingCreated = false;
authFailure.targetBindingHashCreated = false;
authFailure.targetBoundExecutionPlanHashCreated = false;
authFailure.targetBinding = null;
authFailure.targetBindingPath = null;
authFailure.targetBindingSha256 = null;
assert.equal(validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal(authFailure).classification, authFailure.outerClassification);
for (const [name, mutate] of Object.entries({ capture: (v) => { v.captureSuccess = false; }, auth: (v) => { v.authCheckSuccess = false; }, authState: (v) => { v.sessionValidated = false; }, dry: (v) => { v.dryRunSuccess = false; }, order: (v) => { v.authCheckSuccess = false; }, mutation: (v) => { v.productionMutationCount = 1; }, pages: (v) => { v.pagesProjectGetCount = 2; }, runId: (v) => { v.runId = "bad"; }, tooling: (v) => { v.dryRunExpectedToolingCommit = "b".repeat(40); }, incompleteSuccessBinding: (v) => { v.dryRunExpectedToolingCommit = null; }, toolingWithoutReceipt: (v) => { v.dryRunReceiptRunnerCommit = null; }, targetFailureWrongStage: (v) => { Object.assign(v, targetResolutionFailure); v.failureStage = "AUTHENTICATION"; }, targetPrivacyLeak: (v) => { v.targetResolutionFailureCategory = "target-slug@example.com"; }, authLeak: (v) => { v.success = false; v.outerClassification = "R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED"; v.innerClassification = "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_UNEXPECTED_FAILURE"; v.dryRunSuccess = false; v.dryRunChildExitCode = 1; v.dryRunInnerClassification = "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_UNEXPECTED_FAILURE"; } })) {
  const value = base(); mutate(value); assert.throws(() => validateR6V3CaptureAuthCheckDryRunOrchestrationTerminal(value), /^Error: R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_/, name);
}
process.stdout.write("R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_TEST_OK\n");
