import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ORDERED_MIGRATION_FILENAMES } from "./build-local-supabase-replay-mirror.mjs";

export const PACKET_COLUMNS = ["section", "object_type", "schema_name", "object_name", "identity", "attribute", "value", "definition_hash"];
export const LEGAL_PREREQUISITES = new Set(ORDERED_MIGRATION_FILENAMES.filter((name) => name >= "20260703_"));
export const NON_OBJECT_SECTION = "migration_ledger";
export const REQUIRED_PACKET_SECTIONS = [
  "migration_ledger",
  "schemas_and_tables",
  "columns",
  "constraints_and_indexes",
  "types",
  "sequences",
  "functions",
  "function_acl",
  "triggers",
  "policies",
  "grants",
  "migration_configuration",
];
export const ALLOWED_PACKET_SECTIONS = new Set(["packet_sections", ...REQUIRED_PACKET_SECTIONS]);
const SECTION_OBJECT_TYPES = new Map([
  ["packet_sections", new Set(["section_marker"])],
  ["migration_ledger", new Set(["migration"])],
  ["schemas_and_tables", new Set(["schema", "table"])],
  ["columns", new Set(["column"])],
  ["constraints_and_indexes", new Set(["constraint", "index"])],
  ["types", new Set(["type"])],
  ["sequences", new Set(["sequence"])],
  ["functions", new Set(["function"])],
  ["function_acl", new Set(["function"])],
  ["triggers", new Set(["trigger"])],
  ["policies", new Set(["policy"])],
  ["grants", new Set(["function_grant", "schema_grant", "table_grant"])],
  ["migration_configuration", new Set(["storage_bucket"])],
]);

export function normalize(value) {
  return String(value ?? "").replace(/[\n\r\t]+/g, " ").replace(/ +/g, " ").trim();
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function rowKey(row) {
  return PACKET_COLUMNS.slice(0, 6).map((key) => row[key] ?? "").join("|");
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (quoted) throw new Error("Malformed CSV: unterminated quoted field");
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) throw new Error("Malformed CSV: no rows");
  const headerIndex = rows.findIndex((values) => JSON.stringify(values) === JSON.stringify(PACKET_COLUMNS));
  if (headerIndex < 0) throw new Error("Malformed CSV: required fingerprint columns are missing or reordered");
  const dataRows = rows.slice(headerIndex + 1);
  const packetRows = [];
  for (const values of dataRows) {
    // psql prints transaction status lines around the CSV result; they are not packet data.
    if (values.length === 1 && ["BEGIN", "ROLLBACK"].includes(values[0])) continue;
    if (values.length !== PACKET_COLUMNS.length) throw new Error(`Malformed CSV: expected ${PACKET_COLUMNS.length} columns, received ${values.length}`);
    packetRows.push(Object.fromEntries(PACKET_COLUMNS.map((key, index) => [key, values[index]])));
  }
  if (!packetRows.length) throw new Error("Malformed CSV: no fingerprint entries");
  return packetRows;
}

export function validateProductionExport(rows) {
  if (rows.length === 100) throw new Error("Production fingerprint export appears truncated at the Dashboard 100-row limit");
  const seen = new Set();
  const collectedSections = new Set();
  for (const row of rows) {
    const key = rowKey(row);
    if (seen.has(key)) throw new Error(`Malformed production fingerprint export: duplicate row key ${key}`);
    seen.add(key);
    if (!ALLOWED_PACKET_SECTIONS.has(row.section)) throw new Error(`Malformed production fingerprint export: unsupported section ${row.section}`);
    if (!SECTION_OBJECT_TYPES.get(row.section).has(row.object_type)) {
      throw new Error(`Malformed production fingerprint export: ${row.object_type} is not a catalog object allowed in ${row.section}`);
    }
    if (row.schema_name && !["public", "auth", "storage", "supabase_migrations"].includes(row.schema_name)) {
      throw new Error(`Malformed production fingerprint export: unexpected schema ${row.schema_name}`);
    }
    if (row.section === "packet_sections" && row.object_type === "section_marker" && row.attribute === "collected" && row.value === "true") collectedSections.add(row.object_name);
    const content = PACKET_COLUMNS.map((column) => String(row[column] ?? "")).join("\n");
    if (/-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----|\b(?:postgres(?:ql)?|mysql):\/\/|\b(?:bearer|apikey|api[_-]?key)\s+[A-Za-z0-9._~+/=-]{12,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/i.test(content)) {
      throw new Error("Production fingerprint export contains secret-like or connection-string data");
    }
    if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(content)) {
      throw new Error("Production fingerprint export contains email-like user data");
    }
  }
  const missing = REQUIRED_PACKET_SECTIONS.filter((section) => !collectedSections.has(section));
  if (missing.length) throw new Error(`Production fingerprint export is incomplete: required packet sections missing: ${missing.join(", ")}`);
  return { rowCount: rows.length, collectedSections: [...collectedSections].sort() };
}

export async function loadPacketSql(root) {
  const source = await readFile(path.join(root, "docs", "ops", "legal-consent-production-schema-fingerprint.sql"), "utf8");
  const start = source.indexOf("BEGIN TRANSACTION READ ONLY;");
  const end = source.lastIndexOf("ROLLBACK;");
  if (start < 0 || end < start) throw new Error("Fingerprint packet lacks its read-only transaction markers");
  return source.slice(start, end + "ROLLBACK;".length);
}

export async function migrationSourceIndex(root) {
  const files = await Promise.all(ORDERED_MIGRATION_FILENAMES.map(async (filename) => [filename, (await readFile(path.join(root, "supabase", "migrations", filename), "utf8")).toLowerCase()]));
  return new Map(files);
}

export function sourceMigrationsFor(row, sourceIndex) {
  const specificName = row.identity.split(".").at(-1)?.split("(")[0] ?? "";
  const objectName = row.object_name.toLowerCase();
  const specific = specificName.toLowerCase();
  const matches = ORDERED_MIGRATION_FILENAMES.filter((filename) => {
    const source = sourceIndex.get(filename);
    if (["policy", "constraint", "index", "trigger", "function"].includes(row.object_type)) return source.includes(specific || objectName);
    if (row.object_type === "column") return source.includes(objectName) && source.includes(specific);
    return source.includes(objectName);
  });
  if (matches.length || !["constraint", "index"].includes(row.object_type)) return matches;
  return ORDERED_MIGRATION_FILENAMES.filter((filename) => sourceIndex.get(filename).includes(objectName));
}

export function labelFor(row) {
  const identity = row.identity;
  if (identity.includes("legal_policy_acceptances") || identity.includes("record_current_legal_policy_acceptance")) return "legal-consent-persistence";
  if (identity.includes("insert_forum_notification")) return "notification-recipient-isolation";
  if (identity.includes("increment_post_view_count")) return "post-view-visibility";
  if (identity.includes("can_create_user_report_target")) return "report-target-authorization";
  if (identity.includes("can_create_comment_target")) return "comment-circle-authorization";
  if (identity.includes("can_access_comment_reaction_target")) return "comment-reaction-visibility";
  if (identity.includes("can_access_public_comment_read_target")) return "comment-read-visibility";
  if (identity.includes("can_bind_post_media_provenance")) return "post-media-provenance";
  if (identity.includes("can_access_public_circle_cover_object")) return "circle-cover-delivery";
  if (identity.includes("can_access_public_post_media_object")) return "post-media-delivery";
  if (identity.includes("can_access_public_profile_media_object")) return "profile-media-delivery";
  if (identity.includes("user_safety")) return "user-safety-authorization";
  if (identity.includes("report_events") || identity.includes("moderation_actions")) return "reports-and-moderation";
  return "migration-managed";
}

export function buildFingerprint(rows, sourceIndex) {
  const sorted = [...rows].sort((left, right) => rowKey(left).localeCompare(rowKey(right)));
  const ledger = sorted.filter((row) => row.section === NON_OBJECT_SECTION).map((row) => ({ version: row.identity, name: row.object_name, statementCount: Number(row.value) }));
  const objects = sorted.filter((row) => row.section !== NON_OBJECT_SECTION).map((row) => {
    const sources = sourceMigrationsFor(row, sourceIndex);
    return {
      objectType: row.object_type,
      schema: row.schema_name,
      name: row.object_name,
      identity: row.identity,
      attribute: row.attribute,
      normalizedStructuralDefinition: normalize(row.value),
      deterministicSha256: sha256(normalize(row.value)),
      sourceMigrations: sources,
      firstIntroducedMigration: sources[0] ?? null,
      laterModifyingMigrations: sources.slice(1),
      securityRelevant: /policy|acl|grant|rls|function|trigger|constraint|index/.test(`${row.section}:${row.object_type}:${row.attribute}`),
      legalConsentPrerequisite: sources.some((source) => LEGAL_PREREQUISITES.has(source)),
      label: labelFor(row),
    };
  });
  return {
    format: "openglass-production-schema-fingerprint-v1",
    generatedFrom: "LOCAL_DOCKER_ONLY",
    canonicalMigrationCount: ORDERED_MIGRATION_FILENAMES.length,
    legalConsentPrerequisiteCount: 12,
    localMigrationLedger: ledger,
    objectCount: objects.length,
    objects,
  };
}

export function rowsFromFingerprint(fingerprint) {
  return fingerprint.objects.map((entry) => ({
    section: sectionFor(entry), object_type: entry.objectType, schema_name: entry.schema, object_name: entry.name,
    identity: entry.identity, attribute: entry.attribute, value: entry.normalizedStructuralDefinition,
    definition_hash: entry.deterministicSha256,
  }));
}

function sectionFor(entry) {
  if (entry.objectType === "section_marker") return "packet_sections";
  if (entry.objectType === "policy") return "policies";
  if (entry.objectType === "function" && entry.attribute.endsWith("_execute")) return "function_acl";
  if (entry.objectType.endsWith("grant")) return "grants";
  if (entry.objectType === "column") return "columns";
  if (entry.objectType === "table" || entry.objectType === "schema") return "schemas_and_tables";
  if (entry.objectType === "constraint" || entry.objectType === "index") return "constraints_and_indexes";
  return entry.objectType === "storage_bucket" ? "migration_configuration" : `${entry.objectType}s`;
}

export function securityClassification(expected, actual) {
  const identity = expected.identity;
  const expectedValue = expected.normalizedStructuralDefinition;
  if (expected.objectType === "function" && expected.attribute.endsWith("_execute")) {
    if (identity.startsWith("insert_forum_notification") && ((expected.attribute === "PUBLIC_execute" || expected.attribute === "authenticated_execute") && actual === "true" || expected.attribute === "service_role_execute" && actual !== "true")) return "SECURITY_BROADENING";
    if (identity.startsWith("increment_post_view_count") || identity.startsWith("can_create_user_report_target")) return "SECURITY_BROADENING";
  }
  if (expected.objectType === "table" && expected.attribute === "rls_state" && /enabled=true/.test(expectedValue) && !/enabled=true/.test(actual)) return "SECURITY_BROADENING";
  if (expected.objectType === "policy") return "POSSIBLE_SECURITY_BROADENING";
  if (expected.objectType === "function" && expected.attribute === "definition") return "SECURITY_BROADENING";
  return "POSSIBLE_AVAILABILITY_BREAK";
}
