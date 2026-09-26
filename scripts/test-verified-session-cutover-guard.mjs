import assert from "node:assert/strict";
import { assertCanEnterStateC, assertWorkerDbPairing } from "./lib/verified-session-cutover-guard.mjs";

const old = Object.freeze({
  sourceCommit: "e6c2141be8827d961fc49462d66be8da9b4993eb",
  buildSha256: "a".repeat(64),
  environmentSha256: "b".repeat(64),
  configurationSha256: "c".repeat(64),
});
const next = Object.freeze({
  sourceCommit: "1234567890abcdef1234567890abcdef12345678",
  buildSha256: "d".repeat(64),
  environmentSha256: "e".repeat(64),
  configurationSha256: "f".repeat(64),
});
const locks = Object.freeze({ old, next, reviewedNew: Object.freeze({ ...next }) });
const observed = (identity) => ({ ...identity, provenance: "observed-build" });
for (const [identity, stage, expected] of [
  [observed(old), "PRE_V1", "A"],
  [observed(old), "FOUNDATION", "B"],
  [observed(next), "FOUNDATION", "C"],
  [observed(next), "ENFORCEMENT", "D"],
]) assert.equal(assertWorkerDbPairing({ workerIdentity: identity, dbStage: stage, locks }), expected);

for (const [identity, stage, heldLocks] of [
  [observed(next), "PRE_V1", locks],
  [observed(old), "ENFORCEMENT", locks],
  [observed(next), "UNKNOWN", locks],
  [observed(next), "FOUNDATION", { ...locks, next: { ...next, buildSha256: undefined } }],
  [observed({ ...next, buildSha256: "0".repeat(64) }), "FOUNDATION", locks],
  [observed({ ...next, environmentSha256: "0".repeat(64) }), "FOUNDATION", locks],
  [observed({ ...next, configurationSha256: "0".repeat(64) }), "FOUNDATION", locks],
  [{ ...next, provenance: "source-intent" }, "FOUNDATION", locks],
  [{ ...next, provenance: "observed-build", sourceCommit: "origin/main" }, "FOUNDATION", locks],
  [observed({ ...next, sourceCommit: "f".repeat(40) }), "FOUNDATION", locks],
  [observed(next), "FOUNDATION", { ...locks, old: { ...old, sourceCommit: "origin/main" } }],
  [observed({ ...next, sourceCommit: "0".repeat(40) }), "FOUNDATION", { ...locks, next: { ...next, sourceCommit: "0".repeat(40) } }],
]) assert.throws(() => assertWorkerDbPairing({ workerIdentity: identity, dbStage: stage, locks: heldLocks }), /PAIRING_GUARD_DENY/);

let actions = 0;
function guardedAction(input) {
  assertWorkerDbPairing(input);
  actions++;
}
assert.throws(() => guardedAction({ workerIdentity: observed(next), dbStage: "PRE_V1", locks }), /PAIRING_GUARD_DENY/);
assert.equal(actions, 0, "forbidden pair is rejected before any external action");
assert.throws(() => assertWorkerDbPairing(null), /PAIRING_GUARD_DENY/);
const h = (character) => character.repeat(64);
const complete = {
  dbStage: "FOUNDATION", workerIdentity: observed(next), locks,
  oldRollbackIdentity: observed(old),
  artifacts: { foundationSha256: h("1"), enforcementSha256: h("2"), reviewedEnforcementSha256: h("2"),
    cSmokePlanSha256: h("3"), authDPacketSha256: h("4") },
  matrix: {
    A: { status: "PASS", sourceCommit: old.sourceCommit, workerBuildSha256: old.buildSha256 },
    B: { status: "PASS", sourceCommit: old.sourceCommit, workerBuildSha256: old.buildSha256,
      foundationSha256: h("1") },
    C: { status: "PASS", sourceCommit: next.sourceCommit, workerBuildSha256: next.buildSha256,
      foundationSha256: h("1") },
    D: { status: "PASS", sourceCommit: next.sourceCommit, workerBuildSha256: next.buildSha256,
      foundationSha256: h("1"), enforcementSha256: h("2") },
  },
  enforcementPreflight: { status: "PASS", artifactSha256: h("2") },
  cSmokePlan: { reviewed: true, sha256: h("3") },
  authDPacket: { prepared: true, executionStatus: "NOT_EXECUTED", sha256: h("4") },
  sourceLock: { sourceCommit: next.sourceCommit, buildSha256: next.buildSha256 },
  window: { id: "c-window-local-1", startedAtUtc: "2026-09-26T00:00:00.000Z",
    deadlineAtUtc: "2026-09-26T01:00:00.000Z" },
  nowUtc: "2026-09-26T00:01:00.000Z",
};
assert.equal(assertCanEnterStateC(complete), "STATE_C_ENTRY_ELIGIBLE");
assert.throws(() => assertCanEnterStateC({}), /STATE_C_ENTRY_DENIED/);
for (const mutation of [
  { ...complete, dbStage: "UNKNOWN" },
  { ...complete, workerIdentity: observed(old) },
  { ...complete, oldRollbackIdentity: observed(next) },
  { ...complete, artifacts: { ...complete.artifacts, reviewedEnforcementSha256: h("5") } },
  { ...complete, matrix: { ...complete.matrix, D: { ...complete.matrix.D, status: "MISSING" } } },
  { ...complete, matrix: { ...complete.matrix, B: { ...complete.matrix.B, status: "MISSING" } } },
  { ...complete, matrix: { ...complete.matrix, B: { ...complete.matrix.B, foundationSha256: h("5") } } },
  { ...complete, matrix: { ...complete.matrix, A: { ...complete.matrix.A, workerBuildSha256: h("5") } } },
  { ...complete, enforcementPreflight: { ...complete.enforcementPreflight, artifactSha256: h("5") } },
  { ...complete, cSmokePlan: { ...complete.cSmokePlan, reviewed: false } },
  { ...complete, authDPacket: { ...complete.authDPacket, prepared: false } },
  { ...complete, authDPacket: { ...complete.authDPacket, executionStatus: "EXECUTED" } },
  { ...complete, sourceLock: { ...complete.sourceLock, buildSha256: h("5") } },
  { ...complete, window: { ...complete.window, deadlineAtUtc: "2026-09-26T01:00:01.000Z" } },
  { ...complete, nowUtc: "2026-09-26T01:00:01.000Z" },
]) assert.throws(() => assertCanEnterStateC(mutation), /STATE_C_ENTRY_DENIED/);
console.log("PASS Worker/DB pairing guard: A/B/C/D allowed, forbidden pairs and identity drift denied; C entry evidence gated");
