import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeMigrations } from "./local-supabase-migration-mirror.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function compareRows(left, right) {
  const version = BigInt(left.repository_version) < BigInt(right.repository_version) ? -1 : BigInt(left.repository_version) > BigInt(right.repository_version) ? 1 : 0;
  return version || left.repository_file.localeCompare(right.repository_file);
}

export async function createP9MigrationHistoryComparison({ productionRows = [], sourceDirectory = join(ROOT, "supabase", "migrations") } = {}) {
  if (!Array.isArray(productionRows) || productionRows.some((row) => !row || typeof row.version !== "string" || "statements" in row || "rollback" in row)) throw new Error("P9_MIGRATION_HISTORY_COMPARISON_INPUT_INVALID");
  const analysis = await analyzeMigrations(sourceDirectory);
  const canonicalVersions = new Set(analysis.files.map((file) => file.version));
  const collisionVersions = new Set(analysis.duplicateGroups.map((group) => group.version));
  const historyByVersion = new Map();
  for (const row of productionRows) if (!historyByVersion.has(row.version)) historyByVersion.set(row.version, row);
  const rows = analysis.files.map((file) => {
    const history = historyByVersion.get(file.version) ?? null;
    const collision = collisionVersions.has(file.version);
    return {
      repository_version: file.version,
      repository_file: file.filename,
      repository_sha256: file.sha256.toUpperCase(),
      collision_group: collision ? `VERSION_${file.version}` : "NONE",
      production_history_present: history !== null,
      production_recorded_name: history?.name ?? null,
      production_statement_count: history?.statement_count ?? null,
      known_schema_effect_present: "NOT_YET_EVALUATED",
      compatibility_classification: history === null
        ? "PENDING_PRODUCTION_PACKET_2"
        : collision
          ? "COLLISION_REQUIRES_SCHEMA_EFFECT_COMPARISON"
          : "HISTORY_ROW_PRESENT_SCHEMA_EFFECT_PENDING",
    };
  }).sort(compareRows);
  return {
    ordering: "canonical-numeric-version-then-filename",
    repositoryFileCount: rows.length,
    uniqueRepositoryVersionCount: analysis.uniqueVersionCount,
    collisionGroupCount: analysis.duplicateGroups.length,
    productionRowCount: productionRows.length,
    unmatchedProductionRows: productionRows
      .filter((row) => !canonicalVersions.has(row.version))
      .map((row) => ({ version: row.version, name: row.name ?? null, statement_count: row.statement_count ?? null })),
    rows,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(JSON.stringify(await createP9MigrationHistoryComparison(), null, 2));
