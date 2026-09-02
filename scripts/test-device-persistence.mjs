import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const execFileAsync = promisify(execFile);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const { buildDeviceRows, buildImportPlan, validateDeviceRows } = await import("./migrate-static-device-catalog-to-supabase.mjs");
  const rows = await buildDeviceRows();
  const integrity = validateDeviceRows(rows);

  assert(rows.length === 24, `Expected 24 canonical rows, received ${rows.length}.`);
  assert(integrity.uniqueSlugCount === 24, `Expected 24 unique slugs, received ${integrity.uniqueSlugCount}.`);
  assert(integrity.duplicateCount === 0, `Expected no duplicate slugs, received ${integrity.duplicateCount}.`);
  assert(integrity.fieldParityFailures === 0, `Expected field parity, received ${integrity.fieldParityFailures} failures.`);
  assert(rows.every((row) => row.publication_status === "published"), "Initial canonical rows must be published.");
  assert(rows.every((row) => Object.hasOwn(row, "status_label")), "statusLabel must remain content data.");
  assert(rows.every((row) => row.key_specs === null || Array.isArray(row.key_specs)), "Effective keySpecs must retain its array-of-objects shape.");

  const existingRows = new Map([[rows[0].slug, { publication_status: "hidden", name: "stale name" }]]);
  const importPlan = buildImportPlan(rows, existingRows);
  const retained = importPlan.find((row) => row.slug === rows[0].slug);
  assert(retained.publication_status === "hidden", "Reimport must preserve existing publication status.");
  assert(retained.name === rows[0].name, "Reimport must update non-lifecycle catalog fields.");
  const repository = new Map(importPlan.map((row) => [row.slug, row]));
  const secondPlan = buildImportPlan(rows, repository);
  assert(secondPlan.length === 24 && new Set(secondPlan.map((row) => row.slug)).size === 24, "A second import plan must remain at 24 unique rows.");
  assert(secondPlan.find((row) => row.slug === rows[0].slug).publication_status === "hidden", "Second import must not republish a hidden row.");

  const { stdout } = await execFileAsync(process.execPath, ["scripts/migrate-static-device-catalog-to-supabase.mjs", "--dry-run"], { cwd: root });
  const dryRun = JSON.parse(stdout.trim());
  assert(dryRun.mode === "dry-run", "Dry-run must return a machine-readable dry-run result.");
  assert(dryRun.outputCount === 24, "Dry-run must serialize 24 output rows.");

  const migration = await readFile(path.join(root, "supabase/migrations/20260829_device_library_admin.sql"), "utf8");
  assert(migration.includes("create table if not exists public.devices"), "Migration must create devices.");
  assert(migration.includes("publication_status"), "Migration must use separate publication status.");
  assert(migration.includes("alter table public.devices enable row level security"), "Migration must enable RLS.");
  assert(migration.includes("public.is_moderator_or_admin"), "Staff policies must use the established helper.");
  assert(migration.includes("trg_devices_set_updated_at"), "Migration must reuse updated_at trigger infrastructure.");
  assert(migration.includes("jsonb_typeof(key_specs) is null or jsonb_typeof(key_specs) = 'array'"), "Migration must preserve effective keySpecs as JSONB arrays.");
  for (const [policy, command, predicate] of [
    ["devices_select_published_public", "for select to anon, authenticated", "publication_status = 'published'"],
    ["devices_select_staff_all", "for select to authenticated", "public.is_moderator_or_admin"],
    ["devices_insert_staff", "for insert to authenticated", "public.is_moderator_or_admin"],
    ["devices_update_staff", "for update to authenticated", "public.is_moderator_or_admin"],
    ["devices_delete_staff", "for delete to authenticated", "public.is_moderator_or_admin"],
  ]) {
    const start = migration.indexOf(`create policy \"${policy}\"`);
    assert(start >= 0, `Missing ${policy} policy.`);
    const block = migration.slice(start, migration.indexOf(";", start));
    assert(block.includes(command) && block.includes(predicate), `${policy} policy must have its exact role and predicate.`);
  }

  console.log("DEVICE_PERSISTENCE_FOUNDATION_AUDIT_OK");
}

main().catch((error) => {
  console.error(`DEVICE_PERSISTENCE_FOUNDATION_AUDIT_FAIL ${error.message}`);
  process.exitCode = 1;
});
