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

const migrationPath = "supabase/migrations/20260627_reports_optimization_mvp.sql";
const userApiPath = "src/pages/api/forum/reports.ts";
const adminListPath = "src/pages/api/admin/reports.ts";
const adminDetailPath = "src/pages/api/admin/reports/[id].ts";
const adminActionPath = "src/pages/api/admin/reports/[id]/action.ts";
const helperPath = "src/lib/server/reports.server.ts";
const notificationHelperPath = "src/lib/server/moderation-notifications.server.ts";
const notificationsLibPath = "src/lib/notifications.ts";
const triggerPath = "src/components/reports/ReportTrigger.tsx";
const adminPanelPath = "src/components/admin/AdminReportsPanel.tsx";

check("reports migration exists", exists(migrationPath));
if (exists(migrationPath)) {
  const migration = read(migrationPath);
  check("reports migration extends target types", /add value if not exists 'circle'/i.test(migration) && /add value if not exists 'user'/i.test(migration));
  check("reports migration extends statuses", /add value if not exists 'reviewing'/i.test(migration) && /add value if not exists 'actioned'/i.test(migration));
  check("reports migration adds reason_code", /add column if not exists reason_code text/i.test(migration));
  check("report_events table exists", /create table if not exists public\.report_events/i.test(migration));
  check("report_events rls enabled", /alter table public\.report_events enable row level security/i.test(migration));
  check("priority constraint exists", /reports_priority_check/i.test(migration));
  check("reports migration drops target trigger before backfill", /drop trigger if exists trg_reports_validate_target on public\.reports/i.test(migration));
  check("reports migration preserves orphan targets on unrelated update", /tg_op = 'UPDATE'[\s\S]*new\.target_type is not distinct from old\.target_type[\s\S]*new\.target_id is not distinct from old\.target_id/i.test(migration));
  check("reports migration recreates target trigger", /create trigger trg_reports_validate_target[\s\S]*execute function public\.validate_report_target\(\)/i.test(migration));
}

check("user report api exists", exists(userApiPath));
check("admin reports list api exists", exists(adminListPath));
check("admin reports detail api exists", exists(adminDetailPath));
check("admin reports action api exists", exists(adminActionPath));
check("reports helper exists", exists(helperPath));
check("moderation notification helper exists", exists(notificationHelperPath));
check("notifications lib exists", exists(notificationsLibPath));
check("report trigger exists", exists(triggerPath));
check("admin reports panel exists", exists(adminPanelPath));

if (exists(userApiPath)) {
  const api = read(userApiPath);
  check("user report api requires auth", /Missing bearer token/i.test(api) && /auth\.getUser/i.test(api));
  check("user report api validates payload", /parseUserReportPayload/i.test(api));
  check("user report api duplicate friendly", /duplicate/i.test(api) && /already_handled/i.test(api));
}

if (exists(adminListPath)) {
  const api = read(adminListPath);
  check("admin reports list requires moderator", /requireModerator/i.test(api));
  check("admin reports list hides email", !/email/i.test(api));
}

if (exists(adminPanelPath)) {
  const panel = read(adminPanelPath);
  check("admin reports panel has filters", /全部状态/.test(panel) && /全部对象/.test(panel));
  check("admin reports panel supports dismiss/hide/ban", /驳回举报/.test(panel) && /隐藏内容/.test(panel) && /封禁用户/.test(panel));
}

if (exists(helperPath)) {
  const helper = read(helperPath);
  check("report helper notifies moderated post authors", /notifyPostModerated/i.test(helper));
  check("report helper notifies moderated comment authors", /notifyCommentModerated/i.test(helper));
}

if (exists(notificationHelperPath)) {
  const helper = read(notificationHelperPath);
  check("moderation notifications use actorless system delivery", /p_actor_id:\s*null/i.test(helper));
  check("moderation notifications avoid reporter identity", !/reporter/i.test(helper));
  check("moderation notifications avoid admin notes payload", !/note:|reason:|metadata:/i.test(helper));
}

if (exists(notificationsLibPath)) {
  const lib = read(notificationsLibPath);
  check("notifications lib supports moderation types", /post_moderated/i.test(lib) && /comment_moderated/i.test(lib) && /user_warned/i.test(lib) && /user_restricted/i.test(lib));
}

const publicFiles = [
  "src/components/reports/ReportTrigger.tsx",
  "src/components/forum/PostModerationActions.tsx",
  "src/components/forum/CommentsSection.tsx",
  "src/components/profile/MyProfilePage.tsx",
  "src/pages/circles/[slug].astro",
];

for (const relativePath of publicFiles) {
  if (!exists(relativePath)) continue;
  const text = read(relativePath);
  check(`${relativePath} should not expose reporter`, !/reporter_id|reporter_profile|email/i.test(text));
  check(`${relativePath} avoids native dialogs`, !/window\.confirm|window\.alert|window\.prompt/i.test(text));
}

if (failures.length > 0) {
  console.log(`REPORTS AUDIT FAILED (${failures.length})`);
  for (const failure of failures) console.log(`- ${failure}`);
  process.exitCode = strict ? 1 : 0;
} else {
  console.log("REPORTS AUDIT PASSED");
}
