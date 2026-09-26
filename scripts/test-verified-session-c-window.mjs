import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assertSafeToReenter, classifyCWindowIntegrity, classifyStateCExit } from "./lib/verified-session-c-window.mjs";

const start = "2026-09-26T00:00:00.000Z";
const end = "2026-09-26T00:20:00.000Z";
const deadline = "2026-09-26T01:00:00.000Z";
const window = { id: "c-window-local-1", startedAtUtc: start, deadlineAtUtc: deadline, endedAtUtc: end };
const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const verificationProof = { windowId: window.id, evidenceSha256: "c".repeat(64),
  challenge: "PASS", activation: "PASS", signedMapping: "PASS", bypass: "PASS" };
const base = { window, cause: "PUBLIC_READ_UI_ONLY", verificationProof };
assert.equal(classifyCWindowIntegrity(base), "PROVEN");
for (const cause of ["CHALLENGE_FAILURE", "ACTIVATION_FAILURE", "SIGNED_MAPPING_FAILURE", "BYPASS_FAILURE"])
  assert.equal(classifyCWindowIntegrity({ ...base, cause }), "SUSPECT");
assert.equal(classifyCWindowIntegrity({ ...base, cause: "UNKNOWN" }), "UNKNOWN");
assert.equal(classifyCWindowIntegrity({ ...base, verificationProof: null }), "SUSPECT");
assert.equal(classifyCWindowIntegrity({ ...base, verificationProof: { ...verificationProof, bypass: "UNKNOWN" } }), "SUSPECT");
for (const invalid of [
  { ...window, deadlineAtUtc: "2026-09-26T01:00:00+00:00" },
  { ...window, deadlineAtUtc: "2026-09-26T01:00:01.000Z" },
  { ...window, endedAtUtc: "2026-09-25T23:59:59.000Z" },
]) assert.equal(classifyCWindowIntegrity({ ...base, window: invalid }), "UNKNOWN");

assert.equal(classifyStateCExit({ window, nowUtc: end, dbStage: "ENFORCEMENT", dProof: "PASS", rollbackBReady: false }), "ADVANCE_D");
assert.equal(classifyStateCExit({ window, nowUtc: end, dbStage: "FOUNDATION", dProof: "UNKNOWN", rollbackBReady: true }), "ROLLBACK_B");
assert.equal(classifyStateCExit({ window, nowUtc: end, dbStage: "FOUNDATION", dProof: "UNKNOWN", rollbackBReady: false }), "BLOCKED");
assert.equal(classifyStateCExit({ window, nowUtc: "2026-09-26T01:00:01.000Z", dbStage: "FOUNDATION", dProof: "PASS", rollbackBReady: true }), "ROLLBACK_B");
assert.equal(classifyStateCExit({ window, nowUtc: "2026-09-26T01:00:01.000Z", dbStage: "ENFORCEMENT", dProof: "PASS", rollbackBReady: false }), "BLOCKED");

assert.equal(assertSafeToReenter(base), "PROVEN");
const rows = [
  { sessionId: "11111111-1111-4111-8111-111111111111", verifiedAtUtc: "2026-09-26T00:05:00.000Z" },
  { sessionId: "22222222-2222-4222-8222-222222222222", verifiedAtUtc: "2026-09-26T00:06:00.000Z" },
];
const inventory = { windowId: window.id, rows, sha256: sha(rows) };
const revokedRow = { ...rows[1], revokedAtUtc: "2026-09-26T00:20:30.000Z" };
const postcondition = { windowId: window.id, observedAtUtc: "2026-09-26T00:21:00.000Z",
  queryTemplateId: "C_WINDOW_AFFECTED_ROWS_V1", separateReadAuthorizationId: "read-only-proof-1",
  separateReadAuthorizationSha256: "d".repeat(64),
  unrevokedRows: [rows[0]], revokedRows: [revokedRow],
  sha256: sha({ unrevokedRows: [rows[0]], revokedRows: [revokedRow] }) };
const suspect = { ...base, cause: "ACTIVATION_FAILURE", inventory,
  validRowProofs: [{ sessionId: rows[0].sessionId, evidenceSha256: "a".repeat(64),
    source: "provider-session-proof", reviewed: true }],
  revocationReceipt: { authorizationId: "separate-revocation-1", windowId: window.id,
    authorizationSha256: "e".repeat(64), authorizedSessionIdsSha256: sha([rows[1].sessionId]),
    maxRows: 1, maxAttempts: 1, executionResult: "COMMITTED",
    inventorySha256: inventory.sha256, revokedSessionIds: [rows[1].sessionId],
    postcondition } };
assert.equal(assertSafeToReenter(suspect), "SUSPECT_C_WINDOW_ROWS_REVOKED");
for (const mutation of [
  { ...suspect, inventory: { ...inventory, sha256: "0".repeat(64) } },
  { ...suspect, validRowProofs: [] },
  { ...suspect, validRowProofs: [{ ...suspect.validRowProofs[0], reviewed: false }] },
  { ...suspect, revocationReceipt: { ...suspect.revocationReceipt, authorizationId: "" } },
  { ...suspect, revocationReceipt: { ...suspect.revocationReceipt, maxRows: 2 } },
  { ...suspect, revocationReceipt: { ...suspect.revocationReceipt, maxAttempts: 2 } },
  { ...suspect, revocationReceipt: { ...suspect.revocationReceipt, authorizedSessionIdsSha256: "0".repeat(64) } },
  { ...suspect, revocationReceipt: { ...suspect.revocationReceipt, revokedSessionIds: [] } },
  { ...suspect, revocationReceipt: { ...suspect.revocationReceipt,
    postcondition: { ...suspect.revocationReceipt.postcondition,
      unrevokedRows: [rows[1]] } } },
  { ...suspect, revocationReceipt: { ...suspect.revocationReceipt,
    postcondition: { ...postcondition, unrevokedRows: [], sha256: sha([]) } } },
  { ...suspect, revocationReceipt: { ...suspect.revocationReceipt,
    postcondition: { ...postcondition, revokedRows: [] } } },
  { ...suspect, revocationReceipt: { ...suspect.revocationReceipt,
    postcondition: { ...postcondition, revokedRows: [{ ...revokedRow,
      revokedAtUtc: "2026-09-26T00:00:00.000Z" }] } } },
  { ...suspect, revocationReceipt: { ...suspect.revocationReceipt,
    postcondition: { ...postcondition, separateReadAuthorizationId: "" } } },
  { ...suspect, revocationReceipt: { ...suspect.revocationReceipt,
    postcondition: { ...postcondition, separateReadAuthorizationSha256: "" } } },
  { ...suspect, revocationReceipt: { ...suspect.revocationReceipt,
    postcondition: { ...postcondition, queryTemplateId: "ARBITRARY_QUERY" } } },
  { ...suspect, inventory: { ...inventory, rows: [...rows, { sessionId: "33333333-3333-4333-8333-333333333333",
    verifiedAtUtc: "2026-09-26T02:00:00.000Z" }] } },
]) assert.throws(() => assertSafeToReenter(mutation), /C_WINDOW_REENTRY_DENIED/);
console.log("PASS C-window integrity, bounded exit and exact suspect-row reentry guard");
