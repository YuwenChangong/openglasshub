import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  LEGAL_PREREQUISITES,
  PACKET_COLUMNS,
  normalize,
  parseCsv,
  rowKey,
  rowsFromFingerprint,
  securityClassification,
  sha256,
  validateProductionExport,
} from "./production-schema-fingerprint-core.mjs";
import { ORDERED_MIGRATION_FILENAMES } from "./build-local-supabase-replay-mirror.mjs";

export function parseExport(text, filename) {
  if (filename.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : parsed.rows;
    if (!Array.isArray(rows)) throw new Error("Malformed JSON: expected an array or { rows: [...] }");
    for (const row of rows) if (!PACKET_COLUMNS.every((column) => Object.hasOwn(row, column))) throw new Error("Malformed JSON: required fingerprint columns are missing");
    return rows.map((row) => Object.fromEntries(PACKET_COLUMNS.map((column) => [column, String(row[column] ?? "")] )));
  }
  return parseCsv(text.replace(/^\uFEFF/, ""));
}

export function compareFingerprint(expected, actualRows) {
  const expectedRows = rowsFromFingerprint(expected);
  const actualByKey = new Map(actualRows.filter((row) => row.section !== "migration_ledger").map((row) => [rowKey(row), row]));
  const collectedSections = new Set(actualRows.filter((row) => row.section === "packet_sections" && row.object_type === "section_marker" && row.attribute === "collected" && row.value === "true").map((row) => row.object_name));
  const results = [];
  for (const expectedRow of expectedRows) {
    if (expectedRow.section !== "packet_sections" && !collectedSections.has(expectedRow.section)) {
      results.push({ key: rowKey(expectedRow), classification: "INSUFFICIENT_EVIDENCE", severity: "INSUFFICIENT_EVIDENCE" });
      continue;
    }
    const actual = actualByKey.get(rowKey(expectedRow));
    const entry = expected.objects.find((candidate) => candidate.identity === expectedRow.identity && candidate.attribute === expectedRow.attribute && candidate.objectType === expectedRow.object_type);
    if (!actual) {
      results.push({ key: rowKey(expectedRow), classification: "MISSING_IN_PRODUCTION", severity: entry?.securityRelevant ? "SECURITY_BROADENING" : "POSSIBLE_AVAILABILITY_BREAK" });
      continue;
    }
    actualByKey.delete(rowKey(expectedRow));
    const actualValue = normalize(actual.value);
    if (sha256(actualValue) !== expectedRow.definition_hash || (actual.definition_hash && actual.definition_hash !== expectedRow.definition_hash)) {
      results.push({ key: rowKey(expectedRow), classification: "DIVERGENT_IN_PRODUCTION", severity: securityClassification(entry, actualValue), expected: expectedRow.value, actual: actualValue });
    } else results.push({ key: rowKey(expectedRow), classification: "MATCH", severity: "NONE" });
  }
  for (const extra of actualByKey.values()) results.push({ key: rowKey(extra), classification: "EXTRA_IN_PRODUCTION", severity: "HARMLESS_EXTRA_OBJECT" });

  const ledgerRows = actualRows.filter((row) => row.section === "migration_ledger");
  const migrations = ORDERED_MIGRATION_FILENAMES.map((migration) => {
    const related = expected.objects.filter((entry) => entry.sourceMigrations.includes(migration));
    const statuses = related.map((entry) => results.find((result) => result.key === rowKey({ section: sectionForEntry(entry), object_type: entry.objectType, schema_name: entry.schema, object_name: entry.name, identity: entry.identity, attribute: entry.attribute }))?.classification);
    let classification = "INCONCLUSIVE";
    if (related.length) {
      const matchCount = statuses.filter((status) => status === "MATCH").length;
      const divergent = statuses.some((status) => status === "DIVERGENT_IN_PRODUCTION");
      const missing = statuses.some((status) => status === "MISSING_IN_PRODUCTION");
      const insufficient = statuses.some((status) => status === "INSUFFICIENT_EVIDENCE");
      if (insufficient) classification = "INCONCLUSIVE";
      else if (divergent) classification = "DIVERGENT";
      else if (matchCount === related.length) classification = "EFFECTIVELY_PRESENT";
      else if (missing && matchCount === 0) classification = "NOT_PRESENT";
      else classification = "PARTIALLY_PRESENT";
    }
    const version = migration.slice(0, 8);
    return { migration, classification, ledgerEvidence: ledgerRows.some((row) => row.identity.startsWith(version)) ? "RECORDED_VERSION_ONLY" : "UNRECORDED_VERSION" };
  });
  return {
    objectResults: results,
    migrationResults: migrations,
    counts: Object.fromEntries(["MATCH", "MISSING_IN_PRODUCTION", "DIVERGENT_IN_PRODUCTION", "EXTRA_IN_PRODUCTION", "INSUFFICIENT_EVIDENCE"].map((classification) => [classification, results.filter((result) => result.classification === classification).length])),
    hardBlockers: results.filter((result) => ["SECURITY_BROADENING", "POSSIBLE_SECURITY_BROADENING"].includes(result.severity)),
    legalPrerequisiteEvidence: migrations.filter((result) => LEGAL_PREREQUISITES.has(result.migration)),
  };
}

function sectionForEntry(entry) {
  if (entry.objectType === "section_marker") return "packet_sections";
  if (entry.objectType === "policy") return "policies";
  if (entry.objectType === "function" && entry.attribute.endsWith("_execute")) return "function_acl";
  if (entry.objectType.endsWith("grant")) return "grants";
  if (entry.objectType === "column") return "columns";
  if (entry.objectType === "table" || entry.objectType === "schema") return "schemas_and_tables";
  if (entry.objectType === "constraint" || entry.objectType === "index") return "constraints_and_indexes";
  if (entry.objectType === "storage_bucket") return "migration_configuration";
  return `${entry.objectType}s`;
}

async function main() {
  const exportPath = process.argv[2];
  if (!exportPath) throw new Error("Usage: node scripts/compare-production-schema-fingerprint.mjs path/to/dashboard-export.csv");
  const root = process.cwd();
  const [expectedText, exportText] = await Promise.all([
    readFile(path.join(root, "tests", "fixtures", "production-schema-expected-fingerprint.json"), "utf8"),
    readFile(path.resolve(exportPath), "utf8"),
  ]);
  const actualRows = parseExport(exportText, exportPath);
  validateProductionExport(actualRows);
  const report = compareFingerprint(JSON.parse(expectedText), actualRows);
  console.log(JSON.stringify(report, null, 2));
  if (report.hardBlockers.length) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
