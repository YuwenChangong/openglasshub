import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CONTRACTS, parsePacketDocument, validateRows } from "./validate-operational-guardrails-r6-single-result.mjs";
import { canonicalizeConnectorPacket, persistCanonicalPacket, verifyPersistedPacket } from "./capture-operational-guardrails-r6-single-result.mjs";

const md5 = (value) => createHash("md5").update(value).digest("hex");
const targetMarker = md5("operator-bound-target");
const rows = CONTRACTS.preflight.checks.map((check_id, index) => ({
  packet_version: CONTRACTS.preflight.version,
  phase: "R6-2",
  section_order: "1",
  check_order: String((index + 1) * 10),
  check_id,
  object_identity: check_id.startsWith("resend_") ? "public.consume_verification_email_resend_limit(text,integer,integer)" : check_id === "target_function_acl_fingerprint" ? "service_role" : "public.forum_upload_attempts",
  expected_value: check_id === "resend_acl_contract" ? "PUBLIC=false anon=true authenticated=true service_role=false" : check_id === "target_function_acl_fingerprint" ? "service_role only" : "reviewed-redacted-contract",
  actual_value_redacted: check_id === "target_database_fingerprint" ? targetMarker : check_id === "table_privileges_fingerprint" ? "PUBLIC=false; service_role=true" : md5(check_id),
  status: "PASS",
  blocking: "false",
  classification: "FUNCTION_ABSENT_SAFE_TO_CREATE",
  evidence_fingerprint: md5(`evidence:${check_id}`),
}));
const connector = (packet = rows) => ({ isError: false, content: [{ type: "text", text: JSON.stringify(packet) }] });

const canonical = canonicalizeConnectorPacket("preflight", connector(), targetMarker);
assert.equal(canonical.checks, 20);
assert.match(JSON.stringify(canonical.document), /service_role/);
assert.equal(validateRows("preflight", canonical.document.rows, { expectedTargetMarker: targetMarker }).classification, "FUNCTION_ABSENT_SAFE_TO_CREATE");

const temp = await mkdtemp(path.join(os.tmpdir(), "openglass-r6-capture-"));
const outputPath = path.join(temp, "r6-2-schema-aware-preflight.json");
const persisted = await persistCanonicalPacket({ kind: "preflight", connectorResponse: connector(), expectedTargetMarker: targetMarker, outputPath });
assert.equal(persisted.rowCount, 20);
assert.equal(persisted.evidenceHash, createHash("sha256").update(await readFile(outputPath, "utf8")).digest("hex"));
assert.deepEqual(parsePacketDocument(await readFile(outputPath, "utf8")), rows);
assert.match(await readFile(persisted.sidecarPath, "utf8"), /^[0-9a-f]{64}  r6-2-schema-aware-preflight\.json\n$/);
assert.deepEqual((await readdir(temp)).sort(), ["r6-2-schema-aware-preflight.json", "r6-2-schema-aware-preflight.sha256"]);
const cliOutput = path.join(temp, "cli.json");
const cli = spawnSync(process.execPath, ["scripts/capture-operational-guardrails-r6-single-result.mjs", "preflight", cliOutput, targetMarker, Buffer.from(JSON.stringify(connector())).toString("base64url")], { cwd: process.cwd(), encoding: "utf8" });
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /"status":"PASS"/);
await writeFile(persisted.sidecarPath, "0".repeat(64) + "  r6-2-schema-aware-preflight.json\n");
await assert.rejects(() => verifyPersistedPacket({ kind: "preflight", outputPath, expectedTargetMarker: targetMarker }), /SHA/);

for (const [name, mutate, expected] of [
  ["JWT", (packet) => { packet[0].actual_value_redacted = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"; }, /SENSITIVE/],
  ["bearer", (packet) => { packet[0].expected_value = "Bearer opaque-token-value"; }, /SENSITIVE/],
  ["database URI", (packet) => { packet[0].actual_value_redacted = "postgresql://user:password@db.example/test"; }, /SENSITIVE/],
  ["Supabase key", (packet) => { packet[0].actual_value_redacted = "sbp_abcdefghijklmnopqrstuvwx"; }, /SENSITIVE/],
  ["service-role credential", (packet) => { packet[0].actual_value_redacted = "service_role_key_abcdefghijklmnopqrstuvwx"; }, /SENSITIVE/],
  ["cookie", (packet) => { packet[0].actual_value_redacted = "cookie=session=opaque"; }, /SENSITIVE/],
  ["signed URL", (packet) => { packet[0].actual_value_redacted = "https://example.test/file?X-Amz-Signature=opaque"; }, /SENSITIVE/],
  ["unexpected column", (packet) => { packet[0].unexpected = "value"; }, /SCHEMA/],
  ["missing column", (packet) => { delete packet[0].status; }, /SCHEMA/],
  ["duplicate check", (packet) => { packet[1].check_id = packet[0].check_id; }, /duplicate/],
  ["invalid fingerprint", (packet) => { packet[0].evidence_fingerprint = "invalid"; }, /fingerprint/],
]) {
  const packet = structuredClone(rows);
  mutate(packet);
  const rejected = path.join(temp, `${name.replaceAll(" ", "-")}.json`);
  await assert.rejects(() => persistCanonicalPacket({ kind: "preflight", connectorResponse: connector(packet), expectedTargetMarker: targetMarker, outputPath: rejected }), expected, name);
  await assert.rejects(() => readFile(rejected), /ENOENT/, `${name} must not leave a packet`);
  assert.match(await readFile(`${rejected}.capture-error.json`, "utf8"), /CAPTURE_REJECTED|capture_version/);
}

await assert.rejects(() => persistCanonicalPacket({ kind: "preflight", connectorResponse: { isError: false, content: [{ type: "text", text: JSON.stringify(rows) }, { type: "text", text: JSON.stringify(rows) }] }, expectedTargetMarker: targetMarker, outputPath: path.join(temp, "multiple.json") }), /MULTIPLE/);
await assert.rejects(() => persistCanonicalPacket({ kind: "preflight", connectorResponse: connector([]), expectedTargetMarker: targetMarker, outputPath: path.join(temp, "empty.json") }), /missing/);
await assert.rejects(() => persistCanonicalPacket({ kind: "preflight", connectorResponse: connector(rows.slice(0, -1)), expectedTargetMarker: targetMarker, outputPath: path.join(temp, "truncated.json") }), /missing/);
await assert.rejects(() => persistCanonicalPacket({ kind: "preflight", connectorResponse: { isError: false, content: [{ type: "text", text: "{" }] }, expectedTargetMarker: targetMarker, outputPath: path.join(temp, "invalid-json.json") }), /INVALID/);
await assert.rejects(() => persistCanonicalPacket({ kind: "preflight", connectorResponse: connector(), expectedTargetMarker: targetMarker, outputPath }), /OUTPUT_PATH_EXISTS/);
const blockedOutput = path.join(temp, "partial.json");
await mkdir(blockedOutput);
await assert.rejects(() => persistCanonicalPacket({ kind: "preflight", connectorResponse: connector(), expectedTargetMarker: targetMarker, outputPath: blockedOutput }), /OUTPUT_PATH_EXISTS/);
console.log(JSON.stringify({ status: "PASS", schemaAwareCapture: true, validRows: 20, safeRoleLabels: 5, rejectedCases: 15, durableReread: true, cliCapture: true }));
