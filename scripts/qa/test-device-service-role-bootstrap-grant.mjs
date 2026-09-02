import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const migrationDirectory = path.join(process.cwd(), "supabase", "migrations");
const migrations = (await readdir(migrationDirectory))
  .filter((file) => file.endsWith("_device_service_role_bootstrap_grants.sql"));

assert(migrations.length === 1, "Expected exactly one device service-role bootstrap grant migration.");

const sql = await readFile(path.join(migrationDirectory, migrations[0]), "utf8");
assert(/grant\s+select\s*,\s*insert\s*,\s*update\s+on\s+table\s+public\.devices\s+to\s+service_role\s*;/i.test(sql), "Migration must grant only bootstrap SELECT, INSERT, and UPDATE privileges to service_role.");
assert(!/\bdelete\b/i.test(sql), "Bootstrap grant migration must not grant DELETE.");
assert(!/\b(?:anon|authenticated)\b/i.test(sql), "Bootstrap grant migration must not change anon or authenticated privileges.");
assert(!/\b(?:policy|security\s+definer|row\s+level\s+security|alter\s+default\s+privileges)\b/i.test(sql), "Bootstrap grant migration must not alter RLS or default privileges.");

console.log("DEVICE_SERVICE_ROLE_BOOTSTRAP_GRANT_AUDIT_OK");
