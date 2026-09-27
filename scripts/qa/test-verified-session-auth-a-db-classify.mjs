import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAuthADatabase } from "./verified-session-auth-a-db-classify.mjs";

const historyFields = ["version", "name", "created_by", "idempotency_key",
  "statement_count", "rollback_statement_count"];

function capture(rows = []) {
  return { transportProof: { status: "PASS" }, queryResults: [
    ...Array.from({ length: 11 }, (_, index) => ({
      queryId: `CATALOG_${String(index + 1).padStart(2, "0")}`,
      completed: true, fields: ["payload"], rows: [], rowCount: 0 })),
    { queryId: "HISTORY_01", completed: true, fields: historyFields,
      rows, rowCount: rows.length },
  ] };
}

const historyRow = (version, name = "forum_phase1_schema") => ({
  version, name, created_by: "", idempotency_key: "",
  statement_count: "1", rollback_statement_count: "",
});

test("8-digit historical version reaches catalog classification unchanged", () => {
  const result = classifyAuthADatabase(capture([historyRow("20260518")]));
  assert.equal(result.v1PrivateTableCount, 0);
  assert.equal(result.oldMonolithApplied, false);
  assert.equal(result.newFoundationApplied, false);
  assert.equal(result.catalogPass, false);
});

test("14-digit historical version remains valid without becoming a target", () => {
  const result = classifyAuthADatabase(capture([historyRow("20260902042807")]));
  assert.equal(result.v1PrivateTableCount, 0);
  assert.equal(result.oldMonolithApplied, false);
  assert.equal(result.newFoundationApplied, false);
});

test("short, long and nonnumeric migration versions fail closed", () => {
  for (const version of ["2026051", "202609230000000", "2026-05-18"]) {
    const result = classifyAuthADatabase(capture([historyRow(version)]));
    assert.equal(result.v1PrivateTableCount, "UNKNOWN");
    assert.equal(result.oldMonolithApplied, "UNKNOWN");
    assert.equal(result.migrationProvenance, "UNKNOWN");
  }
});

test("8-digit lookalike is not padded to a Verified Session target", () => {
  const result = classifyAuthADatabase(capture([
    historyRow("20260923", "ogh_verified_session_v1_foundation"),
  ]));
  assert.equal(result.v1PrivateTableCount, 0);
  assert.equal(result.newFoundationApplied, false);
  assert.equal(result.migrationProvenance, "UNKNOWN");
});

test("exact target-version collision still marks history divergent", () => {
  const result = classifyAuthADatabase(capture([
    historyRow("20260923000000", "unexpected_target_name"),
  ]));
  assert.equal(result.oldMonolithApplied, false);
  assert.equal(result.newFoundationApplied, false);
  assert.equal(result.migrationProvenance, "DIVERGENT");
});

test("complete history without target versions remains UNKNOWN when semantic catalog is not reviewed", () => {
  const result = classifyAuthADatabase(capture());
  assert.equal(result.dbStage, "UNKNOWN");
  assert.equal(result.migrationProvenance, "UNKNOWN");
  assert.equal(result.catalogPass, false);
  assert.equal(result.catalogDrift, "UNKNOWN");
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
    created_by: "", idempotency_key: "",
    statement_count: "1", rollback_statement_count: "" };
  assert.equal(classifyAuthADatabase(capture([row, row])).migrationProvenance, "UNKNOWN");
  const changed = capture(); changed.queryResults[11].fields.push("unexpected");
  assert.equal(classifyAuthADatabase(changed).migrationProvenance, "UNKNOWN");
});
