import assert from "node:assert/strict";
import test from "node:test";
import { validateP9Packet2LocalEvidence } from "./p9-readonly-postgres-local.mjs";

test("P9P2-07 accepts one-query local read-only evidence, including explicit zero migration rows", () => {
  assert.equal(validateP9Packet2LocalEvidence({
    acceptanceResult: "PASS",
    psqlProcessCount: 1,
    psqlProcessExited: true,
    connectionClosed: true,
    transactionReadOnlyValue: "on",
    backendSessionCorrelation: true,
    packetHash: "6018CE149A1520C7C097E2577281ACE773A2329CC8F36CA74350FD03BE347002",
    queriesExpected: 1,
    queriesExecuted: 1,
    queriesCaptured: 1,
    queriesMissing: 0,
    perQuery: [{ queryId: "MIGRATION_HISTORY_ROWS", rowCount: 0, rows: [] }],
    rollbackMode: "EXPLICIT_ROLLBACK",
    productionConnections: 0,
    productionMutationCount: 0,
  }), "PASS");
});

test("P9P2-07 rejects body-bearing or incomplete local Packet-2 evidence", () => {
  assert.throws(() => validateP9Packet2LocalEvidence({ acceptanceResult: "PASS", queriesExpected: 1, queriesExecuted: 1, queriesCaptured: 1, queriesMissing: 0, perQuery: [{ queryId: "MIGRATION_HISTORY_ROWS", rowCount: 1, rows: [{ statements: "body" }] }] }), /P9_PACKET_2_LOCAL_EVIDENCE_GATE_FAILED/);
});
