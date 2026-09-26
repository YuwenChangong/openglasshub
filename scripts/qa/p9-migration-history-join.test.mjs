import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createP9MigrationHistoryComparison } from "./p9-migration-history-join.mjs";
import { analyzeMigrations } from "./local-supabase-migration-mirror.mjs";

test("P9P2-09 produces a deterministic current-inventory comparison with all collision files represented", async () => {
  const comparison = await createP9MigrationHistoryComparison({
    productionRows: [{ version: "20260611", name: "first-applied", statement_count: "4", rollback_statement_count: "0" }],
  });
  const analysis = await analyzeMigrations(fileURLToPath(new URL("../../supabase/migrations/", import.meta.url)));
  assert.equal(comparison.rows.length, analysis.files.length);
  assert.equal(comparison.uniqueRepositoryVersionCount, analysis.uniqueVersionCount);
  assert.equal(comparison.collisionGroupCount, analysis.duplicateGroups.length);
  assert.deepEqual(comparison.rows.map((row) => row.repository_file).sort(),
    analysis.files.map((file) => file.filename).sort());
  const collisionRows = comparison.rows.filter((row) => row.repository_version === "20260611");
  assert(collisionRows.length > 1);
  assert(collisionRows.every((row) => row.production_history_present === true));
  assert(collisionRows.every((row) => row.production_recorded_name === "first-applied"));
  assert.deepEqual(comparison, await createP9MigrationHistoryComparison({ productionRows: [{ version: "20260611", name: "first-applied", statement_count: "4", rollback_statement_count: "0" }] }));
  assert(comparison.rows.findIndex((row) => row.repository_version === "20260829") < comparison.rows.findIndex((row) => row.repository_version === "20260829054707"));
});

test("P9FINAL-01 retains sanitized production rows that have no canonical version", async () => {
  const comparison = await createP9MigrationHistoryComparison({
    productionRows: [{ version: "20260815010632", name: "admin_circle_lifecycle_and_safe_purge", statement_count: 1 }],
  });
  assert.deepEqual(comparison.unmatchedProductionRows, [{ version: "20260815010632", name: "admin_circle_lifecycle_and_safe_purge", statement_count: 1 }]);
});
