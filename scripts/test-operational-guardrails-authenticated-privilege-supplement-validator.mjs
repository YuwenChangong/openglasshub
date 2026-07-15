import assert from "node:assert/strict";
import { PACKET_VERSION, REQUIRED_SECTIONS, validateAuthenticatedPrivilegeSupplementCsv } from "./validate-operational-guardrails-authenticated-privilege-supplement.mjs";

const columns = ["packet_version", "section_order", "section", "row_key", "object_schema", "object_name", "attribute", "value", "evidence_status", "security_classification"];
const row = (sectionOrder, section, rowKey, attribute, value, objectName = "forum_upload_attempts") => ({
  packet_version: PACKET_VERSION, section_order: sectionOrder, section, row_key: rowKey, object_schema: "public", object_name: objectName, attribute, value, evidence_status: "PRESENT", security_classification: "SECURITY_BROADENING",
});
const rows = [
  row(1, "packet_manifest", "packet", "packet_identifier", "operational-guardrails-authenticated-privilege-supplemental-preflight"),
  row(1, "packet_manifest", "packet", "packet_version", PACKET_VERSION),
  row(1, "packet_manifest", "packet", "expected_section_count", "8"),
  row(1, "packet_manifest", "packet", "target_relation", "public.forum_upload_attempts"),
  ...["anon", "authenticated", "service_role", "authenticator"].flatMap((role) => [
    row(2, "target_role_catalog", role, "role", '{"exists":true}'),
    row(5, "effective_schema_privileges", role, "effective", '{"USAGE":true,"CREATE":false}', "schema"),
  ]),
  row(3, "role_membership_topology", "authenticated->authenticated", "membership", '{"membership_kind":"SELF"}'),
  row(4, "schema_acl_catalog", "PUBLIC", "entry", '{"grantee":"PUBLIC","privilege":"USAGE"}', "schema"),
  row(6, "referenced_sequence_catalog", "NO_REFERENCED_SEQUENCE", "dependency", null),
  row(7, "sequence_acl_catalog", "NO_RELEVANT_SEQUENCE_ACL_ENTRY", "entry", null),
  row(8, "effective_sequence_privileges", "NO_REFERENCED_SEQUENCE|authenticated", "effective", '{"sequence_exists":false,"USAGE":false}'),
];
const csv = (input) => [columns.join(","), ...input.map((entry) => columns.map((column) => {
  const value = entry[column] ?? "";
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}).join(","))].join("\n");

assert.deepEqual(validateAuthenticatedPrivilegeSupplementCsv(csv(rows)), { packetVersion: PACKET_VERSION, rowCount: rows.length, sectionCount: 8, sections: REQUIRED_SECTIONS, validation: "PASS" });
assert.throws(() => validateAuthenticatedPrivilegeSupplementCsv(csv(rows.map((entry) => ({ ...entry, packet_version: "operational-guardrails-supplemental-preflight-v1" })))), /wrong packet version/);
assert.throws(() => validateAuthenticatedPrivilegeSupplementCsv(csv(rows.filter((entry) => entry.section !== "sequence_acl_catalog"))), /required section missing/);
assert.throws(() => validateAuthenticatedPrivilegeSupplementCsv(csv([...rows, rows[0]])), /duplicate packet row/);
assert.throws(() => validateAuthenticatedPrivilegeSupplementCsv(`${csv(rows)}\n"unterminated`), /malformed CSV quoting/);
assert.throws(() => validateAuthenticatedPrivilegeSupplementCsv(csv(rows.map((entry, index) => index === 0 ? { ...entry, value: "password=do-not-export" } : entry))), /unsafe secret-like/);
assert.throws(() => validateAuthenticatedPrivilegeSupplementCsv(csv(rows.map((entry, index) => index === 0 ? { ...entry, object_name: "unrelated_business_table" } : entry))), /non-allowlisted business-row evidence/);

console.log("operational-guardrails authenticated privilege supplemental output validator: PASS");
