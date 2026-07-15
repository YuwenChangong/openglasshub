import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PACKET_VERSION = "operational-guardrails-authenticated-privilege-supplemental-preflight-v1";
export const OUTPUT_COLUMNS = ["packet_version", "section_order", "section", "row_key", "object_schema", "object_name", "attribute", "value", "evidence_status", "security_classification"];
export const REQUIRED_SECTIONS = [
  "packet_manifest",
  "target_role_catalog",
  "role_membership_topology",
  "schema_acl_catalog",
  "effective_schema_privileges",
  "referenced_sequence_catalog",
  "sequence_acl_catalog",
  "effective_sequence_privileges",
];

const parseCsv = (text) => {
  if (!text.trim()) throw new Error("truncated CSV: no packet rows");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') {
      if (field) throw new Error("malformed CSV quote");
      quoted = true;
    } else if (character === ",") {
      row.push(field); field = "";
    } else if (character === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (character !== "\r") field += character;
  }
  if (quoted) throw new Error("malformed CSV quoting");
  if (field || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) throw new Error("truncated CSV: header or packet rows missing");
  const header = rows.shift().map((value, index) => index === 0 ? value.replace(/^\uFEFF/, "") : value);
  assert.deepEqual(header, OUTPUT_COLUMNS, "CSV output columns must exactly match the authenticated privilege supplemental packet schema");
  return rows.map((values, index) => {
    if (values.length !== header.length) throw new Error(`malformed CSV row ${index + 2}`);
    return Object.fromEntries(header.map((column, columnIndex) => [column, values[columnIndex] || null]));
  });
};

const rowsFor = (rows, section) => rows.filter((row) => row.section === section);
const hasRow = (rows, section, rowKey) => rowsFor(rows, section).some((row) => row.row_key === rowKey);
const unsafeEvidence = /(?:[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:secret|token|password|apikey)\s*[=:]|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|auth\.users)/i;

export const validateAuthenticatedPrivilegeSupplementRows = (rows) => {
  if (!rows.length) throw new Error("truncated CSV: no packet rows");
  const seen = new Set();
  for (const row of rows) {
    if (row.packet_version !== PACKET_VERSION) throw new Error(`wrong packet version: ${row.packet_version ?? "missing"}`);
    if (row.object_schema !== "public" || !["forum_upload_attempts", "schema"].includes(row.object_name)) throw new Error("non-allowlisted business-row evidence");
    const serialized = OUTPUT_COLUMNS.map((column) => row[column] ?? "").join("\u0000");
    if (seen.has(serialized)) throw new Error("duplicate packet row");
    seen.add(serialized);
    if (unsafeEvidence.test(Object.values(row).filter(Boolean).join(" "))) throw new Error("unsafe secret-like, email-like, or auth-user evidence");
  }
  const sections = new Set(rows.map((row) => row.section));
  if (sections.size !== REQUIRED_SECTIONS.length || REQUIRED_SECTIONS.some((section) => !sections.has(section))) throw new Error("required section missing, unexpected, or truncated");
  const manifest = Object.fromEntries(rowsFor(rows, "packet_manifest").map((row) => [row.attribute, row.value]));
  if (manifest.packet_identifier !== "operational-guardrails-authenticated-privilege-supplemental-preflight" || manifest.packet_version !== PACKET_VERSION || manifest.expected_section_count !== "8" || manifest.target_relation !== "public.forum_upload_attempts") throw new Error("packet manifest mismatch");
  for (const role of ["anon", "authenticated", "service_role", "authenticator"]) {
    if (!hasRow(rows, "target_role_catalog", role)) throw new Error(`truncated CSV: missing target role ${role}`);
  }
  if (!rowsFor(rows, "role_membership_topology").length) throw new Error("truncated CSV: membership topology missing");
  for (const role of ["anon", "authenticated", "service_role", "authenticator"]) {
    if (!hasRow(rows, "effective_schema_privileges", role)) throw new Error(`truncated CSV: missing effective schema privileges for ${role}`);
  }
  for (const section of ["schema_acl_catalog", "referenced_sequence_catalog", "sequence_acl_catalog", "effective_sequence_privileges"]) {
    if (!rowsFor(rows, section).length) throw new Error(`truncated CSV: ${section} missing`);
  }
  return { packetVersion: PACKET_VERSION, rowCount: rows.length, sectionCount: sections.size, sections: REQUIRED_SECTIONS, validation: "PASS" };
};

export const validateAuthenticatedPrivilegeSupplementCsv = (text) => validateAuthenticatedPrivilegeSupplementRows(parseCsv(text));

const csvPath = process.argv[2] ?? "C:\\Users\\1\\Downloads\\operational-guardrails-authenticated-privilege-supplement.csv";
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(validateAuthenticatedPrivilegeSupplementCsv(await readFile(csvPath, "utf8")), null, 2));
}
