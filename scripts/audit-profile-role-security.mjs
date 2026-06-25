import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const strict = process.argv.includes("--strict");
const verbose = process.argv.includes("--verbose");

const failures = [];
const warnings = [];

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function check(label, ok, detail = "") {
  if (ok) {
    if (verbose) console.log(`PASS ${label}`);
    return;
  }
  failures.push(detail ? `${label}: ${detail}` : label);
  console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

const migrationPath = "supabase/migrations/20260620_lock_profile_role_updates.sql";
const qaGrantPath = "supabase/migrations/20260620_admin_qa_role_grant_path.sql";
const profileApiPath = "src/pages/api/users/me/profile.ts";
const editProfilePath = "src/components/profile/EditProfileForm.tsx";
const adminAuthPath = "src/lib/server/admin-auth.ts";

check("migration exists", exists(migrationPath));
if (exists(migrationPath)) {
  const migration = read(migrationPath);
  check("migration revokes broad profile update", /revoke update on table public\.profiles from authenticated;/i.test(migration));
  check("migration grants column-scoped profile update", /grant update \(/i.test(migration));
  check("migration adds role change trigger", /create trigger trg_profiles_prevent_role_change/i.test(migration));
  check("migration adds role change function", /prevent_unauthorized_profile_role_change/i.test(migration));
}

check("qa admin role rpc migration exists", exists(qaGrantPath));
if (exists(qaGrantPath)) {
  const migration = read(qaGrantPath);
  check("qa grant rpc exists", /create or replace function public\.qa_grant_admin_role/i.test(migration));
  check("qa revoke rpc exists", /create or replace function public\.qa_revoke_admin_role/i.test(migration));
  check("qa role rpc uses security definer", /security definer/i.test(migration));
  check(
    "qa role rpc execute revoked from public anon authenticated",
    /revoke all on function public\.qa_grant_admin_role\(uuid\) from public, anon, authenticated;/i.test(migration)
      && /revoke all on function public\.qa_revoke_admin_role\(uuid\) from public, anon, authenticated;/i.test(migration),
  );
  check(
    "qa role rpc execute granted only to service_role",
    /grant execute on function public\.qa_grant_admin_role\(uuid\) to service_role;/i.test(migration)
      && /grant execute on function public\.qa_revoke_admin_role\(uuid\) to service_role;/i.test(migration),
  );
  check(
    "qa role rpc checks service_role gate",
    /jwt_role <> 'service_role'/i.test(migration) || /current_user <> 'postgres'/i.test(migration),
  );
}

check("profile update API exists", exists(profileApiPath));
if (exists(profileApiPath)) {
  const api = read(profileApiPath);
  check("profile API uses forbidden field allowlist", /FORBIDDEN_PROFILE_FIELDS/.test(api));
  check("profile API rejects role field", /PROFILE_FORBIDDEN_FIELD_UPDATE/.test(api) && /"role"/.test(api));
  check("profile API rejects id and email fields", /"id"/.test(api) && /"email"/.test(api));
}

if (exists(editProfilePath)) {
  const component = read(editProfilePath);
  check("edit profile posts to server API", /fetch\("\/api\/users\/me\/profile"/.test(component));
  check("edit profile no longer updates profiles directly", !/\.from\("profiles"\)\s*\.update\(/s.test(component));
}

const createQaScriptPath = "scripts/qa/create-preview-test-accounts.mjs";
if (exists(createQaScriptPath)) {
  const script = read(createQaScriptPath);
  check("qa create script uses grant rpc", /rpc\("qa_grant_admin_role"/.test(script));
  check("qa create script no direct profiles role update", !/from\("profiles"\)\.update\(\{ role: "admin" \}\)/.test(script));
}

const cleanupQaScriptPath = "scripts/qa/cleanup-preview-test-accounts.mjs";
if (exists(cleanupQaScriptPath)) {
  const script = read(cleanupQaScriptPath);
  check("qa cleanup script uses revoke rpc", /rpc\("qa_revoke_admin_role"/.test(script));
}

if (exists(adminAuthPath)) {
  const adminAuth = read(adminAuthPath);
  check(
    "admin auth notes database-protected role field",
    /database-protected/i.test(adminAuth) || /profiles\.role/i.test(adminAuth),
  );
}

const srcDir = path.join(root, "src");
const srcFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else srcFiles.push(fullPath);
  }
}
walk(srcDir);
for (const file of srcFiles) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  if (/SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(text)) {
    warnings.push(`${rel}: contains service_role text`);
  }
  if (/window\.confirm|window\.alert|window\.prompt/i.test(text)) {
    failures.push(`${rel}: contains native browser dialog usage`);
  }
}

if (warnings.length && verbose) {
  for (const warning of warnings) console.log(`WARN ${warning}`);
}

if (failures.length > 0) {
  console.log(`PROFILE ROLE SECURITY AUDIT FAILED (${failures.length})`);
  for (const failure of failures) console.log(`- ${failure}`);
  process.exitCode = strict ? 1 : 0;
} else {
  console.log("PROFILE ROLE SECURITY AUDIT PASSED");
}
