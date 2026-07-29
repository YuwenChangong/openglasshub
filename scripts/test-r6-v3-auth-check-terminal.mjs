import assert from "node:assert/strict";
import {
  validateR6V3AuthCheckTerminal,
  R6_V3_AUTH_CHECK_TERMINAL_LEGACY_VERSION,
  R6_V3_AUTH_CHECK_TERMINAL_V2_VERSION,
  R6_V3_AUTH_CHECK_TERMINAL_VERSION,
} from "./qa/validate-r6-v3-auth-check-terminal.mjs";

const base = () => ({
  schemaVersion: R6_V3_AUTH_CHECK_TERMINAL_VERSION, mode: "AuthCheckOnly", startedAt: "2099-01-01T00:00:00.000Z", completedAt: "2099-01-01T00:00:01.000Z",
  executionWorktree: "C:\\safe\\worktree", executionCommit: "a".repeat(40), worktreeContract: "current-canonical-production-v3", worktreeValidationPassed: true,
  evidenceRoot: "C:\\safe\\auth-check", evidenceRootFresh: true, deploymentAttestationPath: "C:\\safe\\attestation.json", deploymentAttestationSha256: "b".repeat(64), attestationType: "CLOUDFLARE_PAGES_PROJECT_GET_V3", attestationIssuedAt: "2099-01-01T00:00:00.000Z", attestationExpiresAt: "2099-01-01T00:15:00.000Z", attestationValidatedAt: "2099-01-01T00:00:01.000Z", remainingValidityMs: 899000, minimumRequiredValidityMs: 720000, attestationFreshnessPassed: true,
  captureTerminalLocated: true, captureTerminalShaValidated: true, captureTerminalSchemaAccepted: true, captureTerminalClassificationAccepted: true, captureTerminalFreshnessAccepted: true, captureParentRootMatched: true, captureCommandProvenanceMatched: true, attestationPathMatched: true, attestationShaMatched: true, captureProvenancePassed: true,
  credentialPromptReached: true, otpPromptReached: false, authenticationStageReached: true, endpointBindingPassed: true, projectConfigurationPassed: true, requestAttempted: true, requestDispatched: true, responseReceived: true, networkFailureKind: "none", tlsFailureKind: "none", httpStatusCode: null, providerReasonClass: "not_observed", providerReasonRecognized: false, authenticationAttempted: true, authenticationCompleted: true, sessionCreated: true, sessionValidated: true, authenticatedCheckReached: true, authenticatedCheckCompleted: true,
  pagesRequestCount: 0, deploymentRequestCount: 0, supabaseReadCount: 0, supabaseWriteCount: 0, productionMutationCount: 0, childStarted: true, childExitCode: 0, outerClassification: "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_OK", innerClassification: null, failureStage: "complete", exceptionType: null, success: true,
});
const failed = (classification, reasonClass, recognized = true) => {
  const value = base();
  value.success = false; value.outerClassification = "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_FAILED"; value.innerClassification = classification; value.failureStage = "AUTH_PASSWORD_GRANT_REQUEST"; value.exceptionType = "System.Management.Automation.RuntimeException"; value.childExitCode = 1; value.httpStatusCode = 400; value.providerReasonClass = reasonClass; value.providerReasonRecognized = recognized; value.authenticationCompleted = false; value.sessionCreated = false; value.sessionValidated = false; value.authenticatedCheckReached = false; value.authenticatedCheckCompleted = false; value.childStarted = false;
  return value;
};

assert.equal(validateR6V3AuthCheckTerminal(base()).classification, "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_OK");
for (const [classification, reasonClass] of [
  ["R6_AUTH_CREDENTIAL_REJECTED", "credential_rejection"],
  ["R6_AUTH_EMAIL_CONFIRMATION_REQUIRED", "email_confirmation_required"],
  ["R6_AUTH_ACCOUNT_DISABLED_OR_BANNED", "account_disabled_or_banned"],
  ["R6_AUTH_PROJECT_OR_PUBLIC_KEY_REJECTED", "project_or_public_key_rejection"],
  ["R6_AUTH_VERIFICATION_REQUIRED", "verification_required"],
  ["R6_AUTH_RATE_LIMITED", "rate_limited"],
  ["R6_AUTH_TEMPORARY_PROVIDER_REJECTION", "temporary_provider_rejection"],
]) assert.equal(validateR6V3AuthCheckTerminal(failed(classification, reasonClass)).classification, "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_FAILED", classification);
const unknown = failed("R6_AUTH_HTTP_BAD_REQUEST", "provider_rejection_other", false);
assert.equal(validateR6V3AuthCheckTerminal(unknown).classification, unknown.outerClassification);
for (const [name, mutate] of Object.entries({
  unknownReason: (v) => { v.providerReasonClass = "unreviewed"; },
  mismatch: (v) => { v.providerReasonClass = "verification_required"; },
  otherRecognized: (v) => { v.providerReasonRecognized = true; },
  unrecognizedSpecific: (v) => { v.providerReasonRecognized = false; },
  genericRecognized: (v) => { v.providerReasonRecognized = true; },
  rawProviderResponse: (v) => { v.providerResponse = "synthetic"; },
  secret: (v) => { v.evidenceRoot = "access_token=synthetic"; },
  invalidHttp: (v) => { v.httpStatusCode = "400"; },
  authState: (v) => { v.sessionCreated = true; },
})) {
  const value = ["genericRecognized", "otherRecognized"].includes(name) ? structuredClone(unknown) : failed("R6_AUTH_CREDENTIAL_REJECTED", "credential_rejection");
  mutate(value); assert.throws(() => validateR6V3AuthCheckTerminal(value), /^Error: R6_V3_AUTH_CHECK_TERMINAL_/, name);
}
const rate429 = failed("R6_AUTH_HTTP_RATE_LIMITED", "rate_limited"); rate429.httpStatusCode = 429;
assert.equal(validateR6V3AuthCheckTerminal(rate429).classification, rate429.outerClassification);
for (const [status, classification] of [[401, "R6_AUTH_HTTP_UNAUTHORIZED"], [403, "R6_AUTH_HTTP_FORBIDDEN"], [429, "R6_AUTH_HTTP_RATE_LIMITED"], [500, "R6_AUTH_HTTP_SERVER_ERROR"]]) {
  const value = failed(classification, "not_observed", false); value.httpStatusCode = status;
  assert.equal(validateR6V3AuthCheckTerminal(value).classification, value.outerClassification);
}
const v2 = base();
v2.schemaVersion = R6_V3_AUTH_CHECK_TERMINAL_V2_VERSION; delete v2.providerReasonClass; delete v2.providerReasonRecognized; v2.providerErrorCodeClass = "not_observed";
assert.equal(validateR6V3AuthCheckTerminal(v2).classification, v2.outerClassification);
const legacy = structuredClone(v2); legacy.schemaVersion = R6_V3_AUTH_CHECK_TERMINAL_LEGACY_VERSION;
for (const key of ["authenticationStageReached", "endpointBindingPassed", "projectConfigurationPassed", "requestAttempted", "requestDispatched", "responseReceived", "networkFailureKind", "tlsFailureKind", "httpStatusCode", "providerErrorCodeClass"]) delete legacy[key];
assert.equal(validateR6V3AuthCheckTerminal(legacy).classification, legacy.outerClassification);
process.stdout.write("R6_V3_AUTH_CHECK_TERMINAL_TEST_OK\n");
