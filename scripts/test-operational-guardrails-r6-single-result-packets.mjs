import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACTS, validateRows } from "./validate-operational-guardrails-r6-single-result.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = (name) => path.join(root, "docs", "ops", "reconciliation", name);
const [preflight, postflight] = await Promise.all([
  readFile(sqlPath("operational-guardrails-r6-production-preflight.sql"), "utf8"),
  readFile(sqlPath("operational-guardrails-r6-production-postflight.sql"), "utf8"),
]);
const executable = (sql) => sql.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("--")).join("\n");
const withoutLiterals = (sql) => sql.replace(/'(?:''|[^'])*'/g, "''");
for (const [kind, sql] of [["preflight", preflight], ["postflight", postflight]]) {
  const body = executable(sql).trim();
  assert.match(body, /^WITH\s+/i, `${kind} must be one CTE statement`);
  assert.equal((body.match(/;/g) ?? []).length, 1, `${kind} must have one top-level statement`);
  assert.match(body, /ORDER BY section_order, check_order;/);
  assert.doesNotMatch(withoutLiterals(body), /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE|COPY)\b/i);
  assert.doesNotMatch(body, /pg_get_functiondef|\bprosrc\b|auth\.users|FROM\s+public\.forum_upload_attempts/i);
  for (const check of CONTRACTS[kind].checks) assert.match(body, new RegExp(`'${check}'`));
}

const fingerprint = (text) => createHash("md5").update(text).digest("hex");
const rowsFor = (kind, classification, failed = new Set(), values = {}) => CONTRACTS[kind].checks.map((check_id, index) => ({
  packet_version: CONTRACTS[kind].version,
  phase: CONTRACTS[kind].phase,
  section_order: "1",
  check_order: String((index + 1) * 10),
  check_id,
  object_identity: `catalog.${check_id}`,
  expected_value: "reviewed-redacted-contract",
  actual_value_redacted: values[check_id] ?? fingerprint(check_id),
  status: failed.has(check_id) ? "FAIL" : "PASS",
  blocking: failed.has(check_id) ? "true" : "false",
  classification,
  evidence_fingerprint: fingerprint(`${check_id}|${classification}`),
}));
const targetMarker = fingerprint("operator-bound-target");
const preflightRows = (classification, failed) => rowsFor("preflight", classification, failed, { target_database_fingerprint: targetMarker, policy_inventory_fingerprint: "policy-fingerprint", index_no_equivalent_conflict: "index-fingerprint", table_privileges_fingerprint: "grant-fingerprint" });
for (const [name, classification, failed] of [
  ["function absent", "FUNCTION_ABSENT_SAFE_TO_CREATE", new Set()],
  ["exact function", "EXACT_FUNCTION_ALREADY_PRESENT", new Set()],
  ["conflicting overload", "CONFLICTING_FUNCTION_PRESENT", new Set()],
  ["malformed ACL", "INSUFFICIENT_EVIDENCE", new Set(["target_function_acl_fingerprint"])],
  ["missing index", "INSUFFICIENT_EVIDENCE", new Set(["index_ip_exact"])],
  ["invalid index", "INSUFFICIENT_EVIDENCE", new Set(["index_user_exact"])],
  ["unexpected table grant", "INSUFFICIENT_EVIDENCE", new Set(["table_privileges_fingerprint"])],
  ["missing relation", "INSUFFICIENT_EVIDENCE", new Set(["attempts_relation"])],
  ["insufficient evidence", "INSUFFICIENT_EVIDENCE", new Set(["required_columns"])],
]) assert.equal(validateRows("preflight", preflightRows(classification, failed), { expectedTargetMarker: targetMarker }).classification, classification, name);

const baseline = preflightRows("FUNCTION_ABSENT_SAFE_TO_CREATE", new Set());
for (const [name, failed] of [
  ["exact passed state", new Set()], ["wrong owner", new Set(["target_function_owner"])], ["security invoker", new Set(["target_function_security"])],
  ["wrong search path", new Set(["target_function_settings"])], ["missing timeout", new Set(["target_function_settings"])], ["public execute", new Set(["target_function_acl"])],
  ["authenticated execute", new Set(["target_function_acl"])], ["service role absent", new Set(["target_function_acl"])], ["extra overload", new Set(["target_function_overloads"])],
]) {
  const classification = failed.size ? "PRODUCTION_RPC_POSTFLIGHT_FAILED" : "PRODUCTION_RPC_POSTFLIGHT_PASSED";
  const rows = rowsFor("postflight", classification, failed, { baseline_policy_fingerprint: "policy-fingerprint", baseline_index_fingerprint: "index-fingerprint", baseline_grant_fingerprint: "grant-fingerprint" });
  assert.equal(validateRows("postflight", rows, { baseline }).classification, classification, name);
}
for (const check of ["baseline_policy_fingerprint", "baseline_index_fingerprint", "baseline_grant_fingerprint"]) {
  const rows = rowsFor("postflight", "PRODUCTION_RPC_POSTFLIGHT_PASSED", new Set(), { baseline_policy_fingerprint: "policy-fingerprint", baseline_index_fingerprint: "index-fingerprint", baseline_grant_fingerprint: "grant-fingerprint", [check]: "changed" });
  assert.throws(() => validateRows("postflight", rows, { baseline }), /baseline mismatch/, check);
}
const finalRows = preflightRows("FUNCTION_ABSENT_SAFE_TO_CREATE", new Set());
const connectorResult = [[{ discarded: "legacy intermediate result" }], finalRows].at(-1);
assert.equal(validateRows("preflight", connectorResult, { expectedTargetMarker: targetMarker }).checks, CONTRACTS.preflight.checks.length);
assert.throws(() => validateRows("preflight", finalRows.slice(1), { expectedTargetMarker: targetMarker }), /missing/);
assert.throws(() => validateRows("preflight", [...finalRows, finalRows[0]], { expectedTargetMarker: targetMarker }), /missing/);
console.log(JSON.stringify({ status: "PASS", connectorEmulation: "final-result-only", preflightStates: 9, postflightStates: 13 }));
