import assert from "node:assert/strict";
import test from "node:test";
import { validateP10LocalEvidence } from "./p10-forward-reconciliation-local.mjs";

test("P10LOCAL-01 accepts reconciliation and receipt fixture gates", () => {
  assert.equal(validateP10LocalEvidence({ productionShaped: "PASS", alreadyCanonical: "PASS", rollback: "PASS", receiptHistoryAbsent: "PASS", receiptHistoryPresent: "PASS", productionConnections: 0, productionMutations: 0, cleanup: "PASS" }), "PASS");
});

test("P10LOCAL-02 rejects any missing rollback proof", () => {
  assert.throws(() => validateP10LocalEvidence({ productionShaped: "PASS", alreadyCanonical: "PASS", rollback: "FAIL", productionConnections: 0, productionMutations: 0, cleanup: "PASS" }), /P10_LOCAL_EVIDENCE_GATE_FAILED.*rollback=FAIL/);
});
