import assert from "node:assert/strict";
import { createLiveDryRunReplayFixture } from "./fixtures/r6-live-dryrun-replay-fixture.mjs";
import { validateR6V3DryRunTerminal } from "./qa/validate-r6-v3-dry-run-terminal.mjs";

const replay = createLiveDryRunReplayFixture();
const terminal = replay.dryRunTerminal;

assert.equal(validateR6V3DryRunTerminal(terminal).classification, "R6_CURRENT_CANONICAL_V3_DRY_RUN_FAILED");
assert.equal(terminal.innerClassification, replay.expected.innerClassification);
assert.equal(terminal.failureStage, replay.expected.failureStage);
assert.equal(terminal.receiptState, "PENDING");
assert.equal(terminal.reservationCompleted, true);
assert.equal(terminal.targetResolutionSucceeded, true);
assert.equal(terminal.childStarted, false);
assert.equal(terminal.childTerminalLocated, false);
assert.equal(terminal.actualMutationCount, 0);
assert.equal(terminal.productionMutationCount, 0);
assert.equal(replay.provenance.realProviderValuesRetained, false);
assert.equal(replay.provenance.targetIdentityRetained, false);

console.log("R6_LIVE_DRYRUN_REPLAY_OK sanitized live failure shape, PENDING receipt, and pre-child divergence reproduced");
