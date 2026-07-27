import assert from "node:assert/strict";
import { R6_V3_DRY_RUN_TERMINAL_VERSION, validateR6V3DryRunTerminal } from "./qa/validate-r6-v3-dry-run-terminal.mjs";

const base = () => ({ schemaVersion: R6_V3_DRY_RUN_TERMINAL_VERSION, startedAt: "2099-01-01T00:00:00.000Z", completedAt: "2099-01-01T00:00:01.000Z", runId: "qa-canary-11111111-1111-4111-8111-111111111111", outerClassification: "R6_CURRENT_CANONICAL_V3_DRY_RUN_ONLY_READY", innerClassification: null, success: true, failureStage: "complete", captureProvenancePassed: true, authProvenancePassed: true, attestationFreshnessPassed: true, minimumRequiredValidityMs: 720000, remainingValidityMs: 720000, runIdValidationPassed: true, reservationAttempted: true, reservationCompleted: true, receiptCreated: true, receiptState: "PENDING", childStarted: true, canaryChildStarted: true, adapterReached: false, journalCreated: false, childExitCode: 0, plannedMutationCount: 2, actualMutationCount: 0, supabaseWriteCount: 0, productionMutationCount: 0, retryCount: 0 });
assert.equal(validateR6V3DryRunTerminal(base()).classification, "R6_CURRENT_CANONICAL_V3_DRY_RUN_ONLY_READY");
const receiptBindingFailure = base();
receiptBindingFailure.success = false;
receiptBindingFailure.outerClassification = "R6_CURRENT_CANONICAL_V3_DRY_RUN_FAILED";
receiptBindingFailure.innerClassification = "QA_CANARY_CONSUMED_RUN_RECEIPT_BINDING_MISMATCH";
receiptBindingFailure.failureStage = "RECEIPT_BINDING_VALIDATION";
receiptBindingFailure.childExitCode = 1;
assert.equal(validateR6V3DryRunTerminal(receiptBindingFailure).classification, "R6_CURRENT_CANONICAL_V3_DRY_RUN_FAILED");
const reservationFailure = base();
reservationFailure.success = false;
reservationFailure.outerClassification = "R6_CURRENT_CANONICAL_V3_DRY_RUN_FAILED";
reservationFailure.innerClassification = "R6_CONSUMED_RUN_TOOL_FAILED";
reservationFailure.failureStage = "RUN_ID_RESERVATION";
reservationFailure.reservationCompleted = false;
reservationFailure.receiptCreated = false;
reservationFailure.receiptState = "NOT_CREATED_OR_UNCONFIRMED";
reservationFailure.childStarted = false;
reservationFailure.canaryChildStarted = false;
reservationFailure.childExitCode = 1;
assert.equal(validateR6V3DryRunTerminal(reservationFailure).classification, "R6_CURRENT_CANONICAL_V3_DRY_RUN_FAILED");
for (const [name, mutate] of Object.entries({ mutation: (v) => { v.actualMutationCount = 1; }, write: (v) => { v.supabaseWriteCount = 1; }, retry: (v) => { v.retryCount = 1; }, stale: (v) => { v.remainingValidityMs = 719999; }, runId: (v) => { v.runId = "bad"; }, authLeak: (v) => { v.success = false; v.outerClassification = "R6_CURRENT_CANONICAL_V3_DRY_RUN_FAILED"; v.innerClassification = "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_UNEXPECTED_FAILURE"; }, receipt: (v) => { v.receiptCreated = false; }, adapter: (v) => { v.adapterReached = true; } })) {
  const value = base(); mutate(value); assert.throws(() => validateR6V3DryRunTerminal(value), /^Error: R6_V3_DRY_RUN_TERMINAL_/, name);
}
process.stdout.write("R6_V3_DRY_RUN_TERMINAL_TEST_OK\n");
