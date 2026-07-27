import assert from "node:assert/strict";
import { R6_V3_DRY_RUN_TERMINAL_VERSION, validateR6V3DryRunTerminal } from "./qa/validate-r6-v3-dry-run-terminal.mjs";

const base = () => ({ schemaVersion: R6_V3_DRY_RUN_TERMINAL_VERSION, startedAt: "2099-01-01T00:00:00.000Z", completedAt: "2099-01-01T00:00:01.000Z", runId: "qa-canary-11111111-1111-4111-8111-111111111111", outerClassification: "R6_CURRENT_CANONICAL_V3_DRY_RUN_ONLY_READY", innerClassification: null, success: true, failureStage: "complete", captureProvenancePassed: true, authProvenancePassed: true, attestationFreshnessPassed: true, minimumRequiredValidityMs: 720000, remainingValidityMs: 720000, childStarted: true, childExitCode: 0, plannedMutationCount: 2, actualMutationCount: 0, supabaseWriteCount: 0, productionMutationCount: 0, retryCount: 0 });
assert.equal(validateR6V3DryRunTerminal(base()).classification, "R6_CURRENT_CANONICAL_V3_DRY_RUN_ONLY_READY");
for (const [name, mutate] of Object.entries({ mutation: (v) => { v.actualMutationCount = 1; }, write: (v) => { v.supabaseWriteCount = 1; }, retry: (v) => { v.retryCount = 1; }, stale: (v) => { v.remainingValidityMs = 719999; }, runId: (v) => { v.runId = "bad"; } })) {
  const value = base(); mutate(value); assert.throws(() => validateR6V3DryRunTerminal(value), /^Error: R6_V3_DRY_RUN_TERMINAL_/, name);
}
process.stdout.write("R6_V3_DRY_RUN_TERMINAL_TEST_OK\n");
