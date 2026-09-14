import process from "node:process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeMigrations } from "./local-supabase-migration-mirror.mjs";

const BASELINE_PATH = resolve("tests/fixtures/historical-duplicate-migration-versions.json");

function comparable(groups) {
  return groups.map(({ version, files }) => ({ version, files: files.map(({ filename, sha256 }) => ({ filename, sha256 })) }));
}

/** Reject every duplicate group except the reviewed exact filename-and-hash baseline. */
export function assertMigrationVersionBaseline({ analysis, baseline }) {
  if (!analysis || !Array.isArray(analysis.duplicateGroups) || !baseline || !Array.isArray(baseline.duplicateGroups)) throw new TypeError("migration version baseline is invalid");
  const actual = comparable(analysis.duplicateGroups);
  const expected = comparable(baseline.duplicateGroups);
  const expectedByVersion = new Map(expected.map((group) => [group.version, JSON.stringify(group.files)]));
  for (const group of actual) {
    const expectedFiles = expectedByVersion.get(group.version);
    if (expectedFiles === undefined) throw new Error(`unknown duplicate version: ${group.version}`);
    if (expectedFiles !== JSON.stringify(group.files)) throw new Error(`baseline hash mismatch: ${group.version}`);
  }
  if (actual.length !== expected.length) throw new Error("baseline duplicate group membership mismatch");
  return true;
}

async function main() {
  const directory = resolve(process.argv[2] ?? "supabase/migrations");
  const analysis = await analyzeMigrations(directory);
  const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
  assertMigrationVersionBaseline({ analysis, baseline });
  const duplicateGroups = analysis.duplicateGroups.map(({ version, files }) => ({ version, files: files.map(({ filename }) => filename) }));
  console.log(JSON.stringify({ directory, files: analysis.files.length, uniqueVersions: analysis.uniqueVersionCount, duplicateGroups, baseline: "EXACT_HISTORICAL" }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`MIGRATION_VERSION_VALIDATION_FAIL ${error.message}`); process.exitCode = 1; });
}
