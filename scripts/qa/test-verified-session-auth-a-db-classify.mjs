import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAuthADatabase } from "./verified-session-auth-a-db-classify.mjs";

const historyFields = ["version", "name", "created_by", "idempotency_key",
  "statement_count", "rollback_statement_count"];

function capture(rows = []) {
  return { transportProof: { status: "PASS" }, queryResults: [
    ...Array.from({ length: 11 }, (_, index) => ({
      queryId: `CATALOG_${String(index + 1).padStart(2, "0")}`,
      completed: true, fields: ["observed"], rows: [], rowCount: 0 })),
    { queryId: "HISTORY_01", completed: true, fields: historyFields,
      rows, rowCount: rows.length },
  ] };
}

test("complete history without target versions is still UNKNOWN without semantic catalog", () => {
  const result = classifyAuthADatabase(capture());
  assert.equal(result.dbStage, "UNKNOWN");
  assert.equal(result.migrationProvenance, "UNKNOWN");
  assert.equal(result.catalogPass, false);
  assert.equal(result.catalogDrift, "INSUFFICIENT_PACKET_FOR_REVIEWED_DIGEST");
  for (const key of ["oldMonolithApplied", "oldResendLockApplied",
    "newFoundationApplied", "newEnforcementApplied"]) assert.equal(result[key], false);
});

test("version plus exact name identifies old and new collisions without exposing rows", () => {
  const rows = [
    { version: "20260923000000", name: "ogh_verified_session_v1.sql",
      created_by: "private-identity", idempotency_key: "secret", statement_count: "1",
      rollback_statement_count: "" },
    { version: "20260923000000", name: "ogh_verified_session_v1_foundation",
      created_by: "private-identity", idempotency_key: "secret", statement_count: "2",
      rollback_statement_count: "" },
  ];
  const result = classifyAuthADatabase(capture(rows));
  assert.equal(result.oldMonolithApplied, true);
  assert.equal(result.newFoundationApplied, true);
  assert.equal(result.migrationProvenance, "DIVERGENT");
  assert.equal(JSON.stringify(result).includes("private-identity"), false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("missing query, duplicate identity or changed field set fails closed", () => {
  const missing = capture(); missing.queryResults.pop();
  assert.equal(classifyAuthADatabase(missing).migrationProvenance, "UNKNOWN");
  const row = { version: "20260923000000", name: "ogh_verified_session_v1",
    statement_count: "1", rollback_statement_count: "" };
  assert.equal(classifyAuthADatabase(capture([row, row])).migrationProvenance, "UNKNOWN");
  const changed = capture(); changed.queryResults[11].fields.push("unexpected");
  assert.equal(classifyAuthADatabase(changed).migrationProvenance, "UNKNOWN");
});
