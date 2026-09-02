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
  check("profile API uses forbidden field allowlist", /PROFILE_FORBIDDEN_FIELDS/.test(api));
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
  check(
    "qa create script invokes the shared target guard before privileged client setup",
    script.includes('from "./target-write-guard.mjs"')
      && script.indexOf("target = validateQaWriteTarget") < script.indexOf("createClient(env.QA_SUPABASE_URL"),
  );
  check("qa create script has validation-only dry run", /if \(options\.dryRun\)[\s\S]*plannedOperations/.test(script));
}

const cleanupQaScriptPath = "scripts/qa/cleanup-preview-test-accounts.mjs";
if (exists(cleanupQaScriptPath)) {
  const script = read(cleanupQaScriptPath);
  check("qa cleanup script uses revoke rpc", /rpc\("qa_revoke_admin_role"/.test(script));
  check("qa cleanup script requires explicit marker", /requires --marker <disposable-marker>|!options\.marker/.test(script));
  check(
    "qa cleanup script invokes the shared target guard before privileged client setup",
    script.includes('from "./target-write-guard.mjs"')
      && script.indexOf("target = validateQaWriteTarget") < script.indexOf("createClient(env.QA_SUPABASE_URL"),
  );
  check(
    "qa cleanup script uses admin cleanup routes",
    /\/api\/admin\/moderation\/hide/.test(script)
      && /\/api\/admin\/forum\/circles/.test(script)
      && /\/api\/admin\/moderation\/hide/.test(script),
  );
  check("qa cleanup script avoids profile reset write", !/\/api\/users\/me\/profile/.test(script));
  check(
    "qa cleanup failures are process-fatal",
    /process\.exitCode = cleanupExitCode\(summary\);/.test(script),
  );
}

const qaTargetGuardPath = "scripts/qa/target-write-guard.mjs";
check("shared QA target guard exists", exists(qaTargetGuardPath));
if (exists(qaTargetGuardPath)) {
  const guard = read(qaTargetGuardPath);
  check("shared guard requires expected target ref", /QA_EXPECTED_TARGET_REF_REQUIRED/.test(guard));
  check("shared guard requires production ref contract", /QA_PRODUCTION_REF_REQUIRED/.test(guard));
  check("shared guard rejects target ref mismatch", /QA_TARGET_REF_MISMATCH/.test(guard));
  check("shared guard rejects production by default", /QA_PRODUCTION_WRITES_DISABLED/.test(guard));
  check("shared guard requires a non-generic confirmation", /QA_CONFIRM_RUN_GENERIC/.test(guard));
  check("shared guard rejects duplicate confirmation flags", /QA_CONFIRM_RUN_DUPLICATE/.test(guard));
}

const smokePath = "scripts/smoke-production.mjs";
check("production smoke remains read-only", exists(smokePath));
if (exists(smokePath)) {
  const smoke = read(smokePath);
  check("production smoke has no mutating HTTP method", !/method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)/i.test(smoke));
}

const orchestratorPath = "scripts/qa/destructive-qa-orchestrator.mjs";
const orchestratorCliPath = "scripts/qa/run-destructive-qa.mjs";
const orchestratorTestPath = "scripts/test-destructive-qa-orchestrator.mjs";
check("exact-ID destructive QA orchestrator exists", exists(orchestratorPath));
if (exists(orchestratorPath)) {
  const orchestrator = read(orchestratorPath);
  check("orchestrator requires exact artifact IDs", /QA_MANIFEST_EXACT_ID_REQUIRED/.test(orchestrator));
  check("orchestrator uses finally cleanup", /finally\s*\{\s*await cleanupManifest/.test(orchestrator));
  check("orchestrator verifies every exact artifact", /verifyArtifactAbsent/.test(orchestrator));
  check("orchestrator makes residue fatal", /QA_RESIDUE_REMAINS/.test(orchestrator));
  check("orchestrator does not invoke legacy owner marker cleanup", !/deleteOwned|searchPublicArtifacts|marker cleanup|prefix cleanup/i.test(orchestrator));
}
check("destructive QA CLI exists", exists(orchestratorCliPath));
if (exists(orchestratorCliPath)) {
  const cli = read(orchestratorCliPath);
  check("destructive QA CLI invokes v1 guard", /validateQaWriteTarget/.test(cli));
  check("destructive QA CLI requires explicit execute flag", /--execute-destructive-qa/.test(cli));
  check("destructive QA CLI rejects dry execute conflict", /QA_ORCHESTRATOR_MODE_CONFLICT/.test(cli));
  check("destructive QA CLI does not configure a real adapter", /QA_ORCHESTRATOR_REAL_ADAPTER_NOT_CONFIGURED/.test(cli));
}
check("orchestrator behavioral test exists", exists(orchestratorTestPath));
if (exists(orchestratorTestPath)) {
  const test = read(orchestratorTestPath);
  check("orchestrator test blocks child-process network", /QA_TEST_NETWORK_BLOCKED/.test(test));
  check("orchestrator test exercises cleanup failures", /cleanup failure continues/.test(test));
  check("orchestrator test exercises residue", /residue verification/.test(test));
}

const previewChecklistPath = "docs/public-preview-launch-checklist.md";
check("preview checklist exists", exists(previewChecklistPath));
if (exists(previewChecklistPath)) {
  const checklist = read(previewChecklistPath);
  check("preview checklist makes routine QA read-only", /read-only by default/i.test(checklist));
  check("preview checklist does not present forum writes as routine QA", !/## 11\. Read-only QA Before Cutover[\s\S]*?- Forum writes:/i.test(checklist));
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
