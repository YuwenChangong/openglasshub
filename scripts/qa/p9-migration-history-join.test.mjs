import assert from "node:assert/strict";
import test from "node:test";
import { createP9MigrationHistoryComparison } from "./p9-migration-history-join.mjs";

test("P9P2-09 produces a deterministic 35-file comparison table with all collision files represented", async () => {
  const comparison = await createP9MigrationHistoryComparison({
    productionRows: [{ version: "20260611", name: "first-applied", statement_count: "4", rollback_statement_count: "0" }],
  });
  assert.equal(comparison.rows.length, 35);
  assert.equal(comparison.uniqueRepositoryVersionCount, 19);
  assert.equal(comparison.collisionGroupCount, 10);
  const collisionRows = comparison.rows.filter((row) => row.repository_version === "20260611");
  assert(collisionRows.length > 1);
  assert(collisionRows.every((row) => row.production_history_present === true));
  assert(collisionRows.every((row) => row.production_recorded_name === "first-applied"));
  assert.deepEqual(comparison, await createP9MigrationHistoryComparison({ productionRows: [{ version: "20260611", name: "first-applied", statement_count: "4", rollback_statement_count: "0" }] }));
  assert(comparison.rows.findIndex((row) => row.repository_version === "20260829") < comparison.rows.findIndex((row) => row.repository_version === "20260829054707"));
});
