import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migrationDirectory = path.join(process.cwd(), "supabase", "migrations");

async function loadP10Migration() {
  const filename = (await readdir(migrationDirectory)).find((entry) => /_forward_reconcile_devices\.sql$/.test(entry));
  assert.ok(filename, "P10 forward reconciliation migration is required");
  const sql = await readFile(path.join(migrationDirectory, filename), "utf8");
  return { filename, sql, sha256: createHash("sha256").update(sql).digest("hex").toUpperCase() };
}

test("P10MIG-01 creates only the P9-proven missing device contract", async () => {
  const { filename, sql } = await loadP10Migration();
  assert.match(filename, /^\d{14,}_forward_reconcile_devices\.sql$/);
  assert.match(sql, /p10_devices_shape_unexpected/i);
  assert.match(sql, /array_agg\(column_name::text order by column_name\)/i);
  assert.match(sql, /create table if not exists public\.devices/i);
  assert.match(sql, /create index if not exists devices_publication_status_idx/i);
  for (const policy of ["devices_select_published_public", "devices_select_staff_all", "devices_insert_staff", "devices_update_staff", "devices_delete_staff"]) assert.match(sql, new RegExp(`create policy "${policy}"`, "i"));
  assert.match(sql, /create or replace function public\.enforce_device_slug_lock\(\)/i);
  assert.match(sql, /create trigger trg_devices_enforce_slug_lock/i);
  assert.doesNotMatch(sql, /(?:^|;)\s*(?:drop table|truncate|delete|update\s+public\.devices)\b/im);
});

test("P10MIG-02 has a unique forward-only source identity", async () => {
  const { filename, sha256 } = await loadP10Migration();
  const [version] = filename.split("_");
  const allVersions = (await readdir(migrationDirectory)).filter((entry) => entry.endsWith(".sql")).map((entry) => entry.split("_")[0]);
  assert.equal(allVersions.filter((candidate) => candidate === version).length, 1);
  assert.equal(/^[A-F0-9]{64}$/.test(sha256), true);
});
