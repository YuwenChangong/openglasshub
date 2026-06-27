import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const strict = process.argv.includes("--strict");
const verbose = process.argv.includes("--verbose");
const failures = [];

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function check(label, ok, detail = "") {
  if (ok) {
    if (verbose) console.log(`PASS ${label}`);
    return;
  }
  failures.push(detail ? `${label}: ${detail}` : label);
  console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else files.push(fullPath);
  }
  return files;
}

const migrationPath = "supabase/migrations/20260626_user_safety_states_and_bans.sql";
const helperPath = "src/lib/server/user-safety.server.ts";
const adminPagePath = "src/pages/admin/users/index.astro";
const adminComponentPath = "src/components/admin/AdminUsersDashboard.tsx";

check("user safety migration exists", exists(migrationPath));
if (exists(migrationPath)) {
  const migration = read(migrationPath);
  check("user safety states table", /create table if not exists public\.user_safety_states/i.test(migration));
  check("user safety events table", /create table if not exists public\.user_safety_events/i.test(migration));
  check("status check constraint", /active', 'warned', 'suspended', 'banned/i.test(migration));
  check("event type check constraint", /warning', 'suspend', 'ban', 'unban', 'strike_added', 'strike_removed', 'note/i.test(migration));
  check("rls enabled", /alter table public\.user_safety_states enable row level security/i.test(migration) && /alter table public\.user_safety_events enable row level security/i.test(migration));
  check("ordinary user no broad write policy", !/for update\s+to authenticated\s+using\s*\(\s*user_id = auth\.uid\(\)/i.test(migration));
}

check("user safety helper exists", exists(helperPath));
if (exists(helperPath)) {
  const helper = read(helperPath);
  check("helper exposes getUserSafetyState", /export async function getUserSafetyState/i.test(helper));
  check("helper exposes assertUserCanWrite", /export async function assertUserCanWrite/i.test(helper));
  check("helper exposes block response", /export function getSafetyWriteBlockResponse/i.test(helper));
  check("helper forbids self action", /USER_SAFETY_SELF_ACTION_FORBIDDEN/i.test(helper));
}

check("admin users page exists", exists(adminPagePath));
check("admin users component exists", exists(adminComponentPath));

const adminUsersApi = "src/pages/api/admin/users.ts";
check("admin users api exists", exists(adminUsersApi));
if (exists(adminUsersApi)) {
  const api = read(adminUsersApi);
  check("admin users api hides email", !/email/i.test(api));
  check("admin users api returns safety", /warning_count/i.test(api) && /strike_count/i.test(api));
}

const publicFiles = walk(path.join(root, "src"))
  .map((file) => path.relative(root, file))
  .filter((file) => !file.startsWith("src\\pages\\admin") && !file.startsWith("src\\components\\admin"));

for (const relativePath of publicFiles) {
  const text = read(relativePath);
  if (/window\.confirm|window\.alert|window\.prompt/i.test(text)) {
    failures.push(`${relativePath}: contains native browser dialogs`);
  }
}

if (failures.length > 0) {
  console.log(`USER SAFETY AUDIT FAILED (${failures.length})`);
  for (const failure of failures) console.log(`- ${failure}`);
  process.exitCode = strict ? 1 : 0;
} else {
  console.log("USER SAFETY AUDIT PASSED");
}
