import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OUTPUT_COLUMNS } from "./validate-operational-guardrails-r6-single-result.mjs";
import { PROBE_MARKER, describeConnectorEnvelope, persistConnectorEnvelopeStructure } from "./record-operational-guardrails-r6-envelope-structure.mjs";
import { wrapRowsInExactEnvelope } from "../tests/fixtures/operational-guardrails-r6-exact-envelope.mjs";

const row = (order, role) => Object.fromEntries(OUTPUT_COLUMNS.map((column) => [column, {
  packet_version: PROBE_MARKER,
  phase: "PREFLIGHT",
  section_order: 1,
  check_order: order,
  check_id: `probe_row_${order}`,
  object_identity: "synthetic.object",
  expected_value: "synthetic.expected",
  actual_value_redacted: role,
  status: "PASS",
  blocking: false,
  classification: "PROBE_ONLY",
  evidence_fingerprint: String.fromCharCode(96 + order).repeat(64),
}[column]]));
const rows = [row(1, "service_role"), row(2, "authenticated")];
const direct = { isError: false, content: [{ type: "text", text: JSON.stringify(rows) }] };

const structure = describeConnectorEnvelope(direct);
assert.equal(structure.top_level_type, "object");
assert.equal(structure.connector_error_state, "not_error");
assert.deepEqual(structure.packet_candidates, [{ path: "$.content[0].text#json", array_length: 2, row_shape: "r6-output-columns" }]);
assert.deepEqual(structure.probe_marker_paths, ["$.content[0].text#json[0].packet_version", "$.content[0].text#json[1].packet_version"]);
const encoded = JSON.stringify(structure);
assert.match(encoded, new RegExp(PROBE_MARKER));
for (const forbidden of ["synthetic.object", "synthetic.expected", "probe_row_1", "service_role", "authenticated", "PROBE_ONLY"]) assert.doesNotMatch(encoded, new RegExp(forbidden));

const wrapped = { isError: false, content: [{ type: "text", text: JSON.stringify({ result: rows }) }] };
assert.deepEqual(describeConnectorEnvelope(wrapped).packet_candidates, [{ path: "$.content[0].text#json.result", array_length: 2, row_shape: "r6-output-columns" }]);
const nested = { isError: false, content: [{ type: "text", text: JSON.stringify({ envelope: { result: rows } }) }] };
assert.deepEqual(describeConnectorEnvelope(nested).packet_candidates, [{ path: "$.content[0].text#json.envelope.result", array_length: 2, row_shape: "r6-output-columns" }]);
assert.equal(describeConnectorEnvelope({ isError: false, content: [{ type: "text", text: JSON.stringify({ payload: JSON.stringify(rows) }) }] }).packet_candidate_count, 1);
assert.deepEqual(
  describeConnectorEnvelope(wrapRowsInExactEnvelope(rows)).packet_candidates,
  [{ path: "$[0].text#json.result#wrapped_json", array_length: 2, row_shape: "r6-output-columns" }],
);

for (const [name, response] of [
  ["multiple candidates", { isError: false, content: [{ type: "text", text: JSON.stringify({ left: rows, right: rows }) }] }],
  ["no candidate", { isError: false, content: [{ type: "text", text: JSON.stringify({ result: [] }) }] }],
  ["malformed JSON", { isError: false, content: [{ type: "text", text: "{" }] }],
  ["unexpected keys", { isError: false, content: [{ type: "text", text: JSON.stringify({ result: rows, diagnostic: "not retained" }) }] }],
]) {
  const record = describeConnectorEnvelope(response);
  if (name === "multiple candidates") assert.equal(record.packet_candidate_count, 2);
  if (name === "no candidate" || name === "malformed JSON") assert.equal(record.packet_candidate_count, 0);
  if (name === "unexpected keys") assert.doesNotMatch(JSON.stringify(record), /not retained/);
}

for (const [name, value] of [
  ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"],
  ["bearer", "Bearer opaque-token"],
  ["uri", "postgresql://user:password@db.example/test"],
  ["cookie", "cookie=session=opaque"],
  ["signed-url", "https://example.test/file?X-Amz-Signature=opaque"],
  ["service-role", "service_role_key_abcdefghijklmnopqrstuvwxyz"],
]) assert.throws(() => describeConnectorEnvelope({ isError: false, content: [{ type: "text", text: value }] }), /SENSITIVE/, name);

const deep = {}; let cursor = deep;
for (let index = 0; index < 10; index += 1) { cursor.next = {}; cursor = cursor.next; }
assert.throws(() => describeConnectorEnvelope(deep), /MAX_DEPTH/);
assert.throws(() => describeConnectorEnvelope({ isError: false, content: [Array.from({ length: 257 }, () => null)] }), /MAX_ARRAY_LENGTH/);
const cycle = {}; cycle.self = cycle;
assert.throws(() => describeConnectorEnvelope(cycle), /CYCLE/);

const directory = await mkdtemp(path.join(os.tmpdir(), "openglass-r6-envelope-"));
const outputPath = path.join(directory, "r6-connector-envelope-structure.json");
const persisted = await persistConnectorEnvelopeStructure({ connectorResponse: direct, outputPath });
const written = await readFile(outputPath, "utf8");
assert.equal(persisted.evidenceHash, createHash("sha256").update(written).digest("hex"));
assert.doesNotMatch(written, /synthetic\.object|service_role|authenticated/);
console.log(JSON.stringify({ status: "PASS", structureRecorder: true, candidates: 1, markerPaths: 2, sensitiveRejections: 6, durableReread: true }));
