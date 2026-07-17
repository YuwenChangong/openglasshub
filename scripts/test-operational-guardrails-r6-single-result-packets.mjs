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
for (const sql of [preflight, postflight]) {
  assert.match(sql, /p\.proname = 'consume_verification_email_resend_limit'/);
  assert.match(sql, /arguments = 'input_ip_hash text, max_attempts integer, window_hours integer'/);
  assert.match(sql, /has_function_privilege\(nullif\(r\.role_name, 'PUBLIC'\)/);
  assert.match(sql, /has_table_privilege\(nullif\(r\.role_name, 'PUBLIC'\)/);
  assert.doesNotMatch(sql, /consume_verification_email_resend'(?!_)/);
  assert.doesNotMatch(sql, /proname\s+(?:LIKE|ILIKE)|resend[^\n]*%/i);
}

const fingerprint = (text) => createHash("md5").update(text).digest("hex");
const rowsFor = (kind, classification, failed = new Set(), values = {}) => CONTRACTS[kind].checks.map((check_id, index) => ({
  packet_version: CONTRACTS[kind].version,
  phase: CONTRACTS[kind].phase,
  section_order: "1",
  check_order: String((index + 1) * 10),
  check_id,
  object_identity: check_id.startsWith("resend_") || check_id.startsWith("baseline_resend_") ? "public.consume_verification_email_resend_limit(text,integer,integer)" : `catalog.${check_id}`,
  expected_value: "reviewed-redacted-contract",
  actual_value_redacted: values[check_id] ?? fingerprint(check_id),
  status: failed.has(check_id) ? "FAIL" : "PASS",
  blocking: failed.has(check_id) ? "true" : "false",
  classification,
  evidence_fingerprint: fingerprint(`${check_id}|${classification}`),
}));
const targetMarker = fingerprint("operator-bound-target");
const preflightRows = (classification, failed, values = {}) => rowsFor("preflight", classification, failed, { target_database_fingerprint: targetMarker, policy_inventory_fingerprint: "policy-fingerprint", index_inventory_fingerprint: "index-fingerprint", table_privileges_fingerprint: "grant-fingerprint", resend_metadata_fingerprint: "resend-metadata", resend_acl_fingerprint: "resend-acl", ...values });
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

const resendPreflightCases = [
  ["exact source-backed resend RPC present", new Set()],
  ["resend RPC missing", new Set(["resend_source_contract"])],
  ["wrong function name", new Set(["resend_source_contract"])],
  ["wrong schema", new Set(["resend_source_contract"])],
  ["wrong argument signature", new Set(["resend_source_contract"])],
  ["extra conflicting overload", new Set(["resend_source_contract"])],
  ["target rate-limit function uses resend identity", new Set(["resend_target_identity_separation"])],
  ["correct separate identities", new Set()],
  ["compatible alias explicitly supported by source", new Set()],
  ["unsupported alias", new Set(["resend_source_contract"])],
];
for (const [name, failed] of resendPreflightCases) {
  const classification = failed.size ? "INSUFFICIENT_EVIDENCE" : "FUNCTION_ABSENT_SAFE_TO_CREATE";
  assert.equal(validateRows("preflight", preflightRows(classification, failed), { expectedTargetMarker: targetMarker }).classification, classification, name);
}

const baseline = preflightRows("FUNCTION_ABSENT_SAFE_TO_CREATE", new Set());
for (const [name, failed] of [
  ["exact passed state", new Set()], ["wrong owner", new Set(["target_function_owner"])], ["security invoker", new Set(["target_function_security"])],
  ["wrong search path", new Set(["target_function_settings"])], ["missing timeout", new Set(["target_function_settings"])], ["public execute", new Set(["target_function_acl"])],
  ["authenticated execute", new Set(["target_function_acl"])], ["service role absent", new Set(["target_function_acl"])], ["extra overload", new Set(["target_function_overloads"])],
]) {
  const classification = failed.size ? "PRODUCTION_RPC_POSTFLIGHT_FAILED" : "PRODUCTION_RPC_POSTFLIGHT_PASSED";
  const rows = rowsFor("postflight", classification, failed, { baseline_policy_fingerprint: "policy-fingerprint", baseline_index_fingerprint: "index-fingerprint", baseline_grant_fingerprint: "grant-fingerprint", baseline_resend_metadata_fingerprint: "resend-metadata", baseline_resend_acl_fingerprint: "resend-acl" });
  assert.equal(validateRows("postflight", rows, { baseline }).classification, classification, name);
}
for (const check of ["baseline_policy_fingerprint", "baseline_index_fingerprint", "baseline_grant_fingerprint", "baseline_resend_metadata_fingerprint", "baseline_resend_acl_fingerprint"]) {
  const rows = rowsFor("postflight", "PRODUCTION_RPC_POSTFLIGHT_PASSED", new Set(), { baseline_policy_fingerprint: "policy-fingerprint", baseline_index_fingerprint: "index-fingerprint", baseline_grant_fingerprint: "grant-fingerprint", baseline_resend_metadata_fingerprint: "resend-metadata", baseline_resend_acl_fingerprint: "resend-acl", [check]: "changed" });
  assert.throws(() => validateRows("postflight", rows, { baseline }), /baseline mismatch/, check);
}
for (const [name, failed] of [
  ["resend ACL changed", new Set(["resend_acl_contract"])],
  ["resend owner changed", new Set(["resend_source_contract"])],
  ["resend definition changed", new Set(["resend_source_contract"])],
  ["preflight resend baseline missing", new Set()],
]) {
  const rows = rowsFor("postflight", "PRODUCTION_RPC_POSTFLIGHT_PASSED", failed, { baseline_policy_fingerprint: "policy-fingerprint", baseline_index_fingerprint: "index-fingerprint", baseline_grant_fingerprint: "grant-fingerprint", baseline_resend_metadata_fingerprint: "resend-metadata", baseline_resend_acl_fingerprint: "resend-acl" });
  if (name === "preflight resend baseline missing") {
    const incompleteBaseline = baseline.filter((row) => row.check_id !== "resend_acl_fingerprint");
    assert.throws(() => validateRows("postflight", rows, { baseline: incompleteBaseline }), /baseline mismatch/, name);
  } else {
    assert.throws(() => validateRows("postflight", rows, { baseline }), /cannot pass with a failed check/, name);
  }
}
const finalRows = preflightRows("FUNCTION_ABSENT_SAFE_TO_CREATE", new Set());
const connectorResult = [[{ discarded: "legacy intermediate result" }], finalRows].at(-1);
assert.equal(validateRows("preflight", connectorResult, { expectedTargetMarker: targetMarker }).checks, CONTRACTS.preflight.checks.length);
assert.throws(() => validateRows("preflight", finalRows.slice(1), { expectedTargetMarker: targetMarker }), /missing/);
assert.throws(() => validateRows("preflight", [...finalRows, finalRows[0]], { expectedTargetMarker: targetMarker }), /missing/);
const malformedIdentityRows = preflightRows("FUNCTION_ABSENT_SAFE_TO_CREATE", new Set());
malformedIdentityRows.find((row) => row.check_id === "resend_source_contract").object_identity = "public.consume_verification_email_resend_limit";
assert.throws(() => validateRows("preflight", malformedIdentityRows, { expectedTargetMarker: targetMarker }), /exact source-backed signature/, "malformed captured identity");
console.log(JSON.stringify({ status: "PASS", connectorEmulation: "final-result-only", resendStateMatrix: 17, preflightStates: 19, postflightStates: 17 }));
