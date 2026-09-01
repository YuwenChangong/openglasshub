import assert from "node:assert/strict";
import test from "node:test";
import { validateP9LocalEvidence } from "./p9-readonly-postgres-local.mjs";

test("P9TX-30 accepts only a complete local dedicated-session evidence model", () => {
  const validated = validateP9LocalEvidence({
    acceptanceResult: "PASS",
    psqlProcessCount: 1,
    psqlProcessExited: true,
    connectionClosed: true,
    transactionReadOnlyValue: "on",
    backendSessionCorrelation: true,
    queriesExpected: 4,
    queriesExecuted: 4,
    queriesCaptured: 4,
    queriesMissing: 0,
    rollbackMode: "EXPLICIT_ROLLBACK",
    productionConnections: 0,
    productionSqlRequests: 0,
    productionMutationCount: 0,
    localWriteRejection: "PASS",
    cleanup: "PASS",
  });
  assert.equal(validated, "PASS");
});

test("P9TX-23 rejects missing result blocks or an unproven read-only session", () => {
  assert.throws(() => validateP9LocalEvidence({ acceptanceResult: "PASS", transactionReadOnlyValue: "off", queriesExpected: 4, queriesExecuted: 4, queriesCaptured: 4, queriesMissing: 0 }), /P9_LOCAL_EVIDENCE_GATE_FAILED/);
  assert.throws(() => validateP9LocalEvidence({ acceptanceResult: "PASS", transactionReadOnlyValue: "on", queriesExpected: 4, queriesExecuted: 4, queriesCaptured: 3, queriesMissing: 1 }), /P9_LOCAL_EVIDENCE_GATE_FAILED/);
});
