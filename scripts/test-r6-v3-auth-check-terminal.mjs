import assert from "node:assert/strict";
import { validateR6V3AuthCheckTerminal, R6_V3_AUTH_CHECK_TERMINAL_VERSION } from "./qa/validate-r6-v3-auth-check-terminal.mjs";

const base = () => ({
  schemaVersion: R6_V3_AUTH_CHECK_TERMINAL_VERSION, mode: "AuthCheckOnly", startedAt: "2099-01-01T00:00:00.000Z", completedAt: "2099-01-01T00:00:01.000Z",
  executionWorktree: "C:\\safe\\worktree", executionCommit: "a".repeat(40), worktreeContract: "current-canonical-production-v3", worktreeValidationPassed: true,
  evidenceRoot: "C:\\safe\\auth-check", evidenceRootFresh: true, deploymentAttestationPath: "C:\\safe\\attestation.json", deploymentAttestationSha256: "b".repeat(64), attestationType: "CLOUDFLARE_PAGES_PROJECT_GET_V3", attestationIssuedAt: "2099-01-01T00:00:00.000Z", attestationExpiresAt: "2099-01-01T00:15:00.000Z", attestationValidatedAt: "2099-01-01T00:00:01.000Z", remainingValidityMs: 899000, minimumRequiredValidityMs: 720000, attestationFreshnessPassed: true,
  credentialPromptReached: true, otpPromptReached: false, authenticationAttempted: true, authenticationCompleted: true, sessionCreated: true, sessionValidated: true, authenticatedCheckReached: true, authenticatedCheckCompleted: true,
  pagesRequestCount: 0, deploymentRequestCount: 0, supabaseReadCount: 0, supabaseWriteCount: 0, productionMutationCount: 0, childStarted: true, childExitCode: 0, outerClassification: "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_OK", innerClassification: null, success: true,
});
assert.equal(validateR6V3AuthCheckTerminal(base()).classification, "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_OK");
for (const [name, mutate] of Object.entries({ mutation: (v) => { v.productionMutationCount = 1; }, missingSession: (v) => { v.sessionValidated = false; }, token: (v) => { v.innerClassification = "access_token=synthetic"; }, failureSuccess: (v) => { v.success = false; }, exit: (v) => { v.childExitCode = 1; } })) {
  const value = base(); mutate(value); assert.throws(() => validateR6V3AuthCheckTerminal(value), /^Error: R6_V3_AUTH_CHECK_TERMINAL_/i, name);
}
const failure = base(); failure.success = false; failure.outerClassification = "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_FAILED"; failure.innerClassification = "R6_ATTESTATION_VALIDITY_TOO_SHORT"; failure.childExitCode = 1; failure.authenticationAttempted = false; failure.authenticationCompleted = false; failure.sessionCreated = false; failure.sessionValidated = false; failure.authenticatedCheckReached = false; failure.authenticatedCheckCompleted = false; failure.childStarted = false;
assert.equal(validateR6V3AuthCheckTerminal(failure).classification, failure.outerClassification);
process.stdout.write("R6_V3_AUTH_CHECK_TERMINAL_TEST_OK\n");
