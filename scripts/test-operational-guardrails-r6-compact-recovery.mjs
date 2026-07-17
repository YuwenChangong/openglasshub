import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { persistRecoveryPacket } from "./capture-operational-guardrails-r6-compact-recovery.mjs";
import { classifyRecovery, loadBaseline, parseRecoveryPacket } from "./validate-operational-guardrails-r6-compact-recovery.mjs";
import { baselineMap, baselineRows, createRecoveryPacket, withFailedChecks } from "../tests/fixtures/operational-guardrails-r6-compact-recovery.mjs";
import { wrapRowsInExactEnvelope } from "../tests/fixtures/operational-guardrails-r6-exact-envelope.mjs";

const baselineDocument = `${JSON.stringify({ capture_version: "r6-schema-aware-capture-v1", kind: "preflight", rows: baselineRows.map(([check_id, actual_value_redacted], index) => ({ packet_version: "r6-single-result-preflight-v3", phase: "R6-2", section_order: "1", check_order: String(index + 1), check_id, object_identity: "public.forum_upload_attempts", expected_value: "redacted", actual_value_redacted, status: "PASS", blocking: "false", classification: "FUNCTION_ABSENT_SAFE_TO_CREATE", evidence_fingerprint: createHash("md5").update(check_id).digest("hex") })) })}\n`;
const baselineHash = createHash("sha256").update(baselineDocument).digest("hex");
const exact = createRecoveryPacket();
assert.equal(classifyRecovery(exact, baselineMap()), "COMMITTED_EXACTLY");

const absentBase = createRecoveryPacket({ target_state: "ABSENT", overload_count: 0, signature_exact: false, return_identity: false, owner_postgres: false, security_definer: false, volatile: false, parallel_unsafe: false, non_leakproof: false, search_path_exact: false, lock_timeout_exact: false, statement_timeout_exact: false, service_role_execute: false });
const absent = withFailedChecks(absentBase, ["target_acl_exact", "target_lock_timeout", "target_non_leakproof", "target_owner_postgres", "target_parallel_unsafe", "target_return_identity", "target_search_path", "target_security_definer", "target_signature", "target_statement_timeout", "target_volatile"]);
assert.equal(classifyRecovery(absent, baselineMap()), "NOT_COMMITTED");

for (const [name, mutate, failures] of [
  ["wrong owner", (packet) => ({ ...packet, owner_postgres: false, target_state: "CONFLICTING" }), ["target_owner_postgres"]],
  ["security invoker", (packet) => ({ ...packet, security_definer: false, target_state: "CONFLICTING" }), ["target_security_definer"]],
  ["wrong signature", (packet) => ({ ...packet, signature_exact: false, target_state: "CONFLICTING" }), ["target_signature"]],
  ["wrong return", (packet) => ({ ...packet, return_identity: false, target_state: "CONFLICTING" }), ["target_return_identity"]],
  ["extra overload", (packet) => ({ ...packet, overload_count: 2, target_state: "CONFLICTING" }), ["target_signature"]],
  ["wrong search path", (packet) => ({ ...packet, search_path_exact: false, target_state: "CONFLICTING" }), ["target_search_path"]],
  ["missing lock timeout", (packet) => ({ ...packet, lock_timeout_exact: false, target_state: "CONFLICTING" }), ["target_lock_timeout"]],
  ["missing statement timeout", (packet) => ({ ...packet, statement_timeout_exact: false, target_state: "CONFLICTING" }), ["target_statement_timeout"]],
  ["PUBLIC execute", (packet) => ({ ...packet, public_execute: true, target_state: "CONFLICTING" }), ["target_acl_exact"]],
  ["anon execute", (packet) => ({ ...packet, anon_execute: true, target_state: "CONFLICTING" }), ["target_acl_exact"]],
  ["authenticated execute", (packet) => ({ ...packet, authenticated_execute: true, target_state: "CONFLICTING" }), ["target_acl_exact"]],
  ["service role absent", (packet) => ({ ...packet, service_role_execute: false, target_state: "CONFLICTING" }), ["target_acl_exact"]],
  ["policy drift", (packet) => ({ ...packet, policy_inventory_fingerprint: "cccccccccccccccccccccccccccccccc" }), []],
  ["table grant drift", (packet) => ({ ...packet, table_privileges_fingerprint: "dddddddddddddddddddddddddddddddd" }), []],
  ["index drift", (packet) => ({ ...packet, index_inventory_fingerprint: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" }), []],
  ["invalid index", (packet) => ({ ...packet, index_ip_exact: false, target_state: "CONFLICTING" }), ["index_ip_exact"]],
  ["unready index", (packet) => ({ ...packet, index_user_exact: false, target_state: "CONFLICTING" }), ["index_user_exact"]],
  ["resend metadata drift", (packet) => ({ ...packet, resend_metadata_fingerprint: "ffffffffffffffffffffffffffffffff" }), []],
  ["resend ACL drift", (packet) => ({ ...packet, resend_acl_fingerprint: "99999999999999999999999999999999" }), []],
  ["resend missing", (packet) => ({ ...packet, resend_identity_exact: false, target_state: "CONFLICTING" }), ["resend_identity_exact"]],
  ["identity collision", (packet) => ({ ...packet, target_resend_identity_separate: false, target_state: "CONFLICTING" }), ["target_resend_identity_separate"]],
]) {
  const changed = mutate(createRecoveryPacket());
  const failed = withFailedChecks({ ...changed, evidence_fingerprint: "" }, failures);
  assert.equal(classifyRecovery(failed, baselineMap()), "CONFLICTING_OR_PARTIAL", name);
}
assert.equal(classifyRecovery(exact, new Map()), "INSUFFICIENT_EVIDENCE");
assert.equal(classifyRecovery({ ...exact, blocking_count: 1 }, baselineMap()), "INSUFFICIENT_EVIDENCE");

const temporary = await mkdtemp(path.join(os.tmpdir(), "openglass-r6-recovery-"));
const baselinePath = path.join(temporary, "baseline.json");
await writeFile(baselinePath, baselineDocument, "utf8");
assert.equal((await loadBaseline(baselinePath, baselineHash)).get("index_inventory_fingerprint"), baselineMap().get("index_inventory_fingerprint"));
const outputPath = path.join(temporary, "recovery.json");
const connector = { isError: false, content: [{ type: "text", text: JSON.stringify([exact]) }] };
const persisted = await persistRecoveryPacket({ connectorResponse: connector, outputPath, baselinePath, baselineSha256: baselineHash });
assert.equal(persisted.classification, "COMMITTED_EXACTLY");
assert.equal(parseRecoveryPacket(await readFile(outputPath, "utf8")).packet_version, exact.packet_version);
const exactEnvelopeOutput = path.join(temporary, "exact-envelope.json");
await persistRecoveryPacket({ connectorResponse: wrapRowsInExactEnvelope([exact]), outputPath: exactEnvelopeOutput, baselinePath, baselineSha256: baselineHash });

for (const [name, packet, error] of [
  ["oversized", { ...exact, check_statuses_compact: exact.check_statuses_compact + "x".repeat(9000) }, /CHECK_STATUSES|TOO_LARGE/],
  ["missing", Object.fromEntries(Object.entries(exact).filter(([key]) => key !== "phase")), /SCHEMA/],
  ["duplicate-check", { ...exact, check_statuses_compact: exact.check_statuses_compact.replace('{', '{"target_acl_exact":true,') }, /DUPLICATE/],
  ["bad-evidence", { ...exact, evidence_fingerprint: "0".repeat(32) }, /FINGERPRINT/],
]) {
  const target = path.join(temporary, `${name}.json`);
  await assert.rejects(() => persistRecoveryPacket({ connectorResponse: { isError: false, content: [{ type: "text", text: JSON.stringify([packet]) }] }, outputPath: target, baselinePath, baselineSha256: baselineHash }), error);
  await assert.rejects(() => readFile(target), /ENOENT/);
}
await assert.rejects(() => persistRecoveryPacket({ connectorResponse: { isError: false, content: [{ type: "text", text: JSON.stringify([exact, exact]) }] }, outputPath: path.join(temporary, "two-rows.json"), baselinePath, baselineSha256: baselineHash }), /ROW_COUNT/);
const truncatedEnvelope = wrapRowsInExactEnvelope([exact]);
truncatedEnvelope[0].text = truncatedEnvelope[0].text.slice(0, -12);
await assert.rejects(() => persistRecoveryPacket({ connectorResponse: truncatedEnvelope, outputPath: path.join(temporary, "truncated-envelope.json"), baselinePath, baselineSha256: baselineHash }), /INVALID_CONNECTOR_JSON|WRAPPER/);
console.log(JSON.stringify({ status: "PASS", exactCommitted: true, notCommitted: true, conflictingStates: 21, insufficientEvidenceStates: 3, semanticMatrixStates: 26, captureBudgetBytes: Buffer.byteLength(`${JSON.stringify(exact)}\n`), durableCapture: true, exactEnvelope: true }));
