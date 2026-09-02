import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyzeMigrations } from "./local-supabase-migration-mirror.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const classifications = new Map([
  ["20260611", "ORDER_DEPENDENT_OVERLAPPING_FUNCTION_REPLACEMENTS"],
  ["20260612", "ORDER_DEPENDENT_NEWS_TABLE_BEFORE_VIEW_FUNCTION"],
  ["20260829", "ORDER_DEPENDENT_DEVICE_LIBRARY_BEFORE_SLUG_LOCK"],
]);

export async function createP8MigrationHistoryReport(sourceDirectory = join(root, "supabase", "migrations")) {
  const analysis = await analyzeMigrations(sourceDirectory);
  return {
    result: "PASS_REQUIRES_PRODUCTION_HISTORY",
    scope: "CANONICAL_REPOSITORY_FILES_ONLY",
    ordering: "canonical-numeric-version-then-filename",
    fileCount: analysis.files.length,
    uniqueVersionCount: analysis.uniqueVersionCount,
    duplicateVersionGroupCount: analysis.duplicateGroups.length,
    duplicateGroups: analysis.duplicateGroups.map((group) => ({
      version: group.version,
      classification: classifications.get(group.version) ?? "DISTINCT_INDEPENDENT",
      files: group.files.map((file) => ({ filename: file.filename, sha256: file.sha256 })),
    })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await createP8MigrationHistoryReport(), null, 2));
