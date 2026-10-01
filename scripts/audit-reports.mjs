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
  const { getUiMessages } = await import("../src/lib/i18n/catalog.ts");
  const catalogs = [getUiMessages("zh-CN").admin, getUiMessages("en").admin];
  const hasMessage = (path) => catalogs.every((catalog) => {
    const value = path.reduce((current, key) => current?.[key], catalog);
    return typeof value === "string" && value.trim().length > 0;
  });
  const consumesAdminMessages = /getUiMessages\(locale\)\.admin/.test(panel)
    && /useLocale\(localeContext\)/.test(panel);
  const localizedStatusOption = /value:\s*"all",\s*label:\s*text\.reports\.filters\.status\.all/.test(panel);
  const localizedTargetOption = /value:\s*"all",\s*label:\s*text\.reports\.filters\.target\.all/.test(panel);
  const hasStatusControl = /<select\s+value=\{filters\.status\}[\s\S]*?onChange=\{[^\n]*status:\s*event\.target\.value[^\n]*\}\}>\s*\{STATUS_OPTIONS\.map\(/.test(panel);
  const hasTargetControl = /<select\s+value=\{filters\.target_type\}[\s\S]*?onChange=\{[^\n]*target_type:\s*event\.target\.value[^\n]*\}\}>\s*\{TARGET_OPTIONS\.map\(/.test(panel);
  check("admin reports filter i18n contract", consumesAdminMessages
    && localizedStatusOption && localizedTargetOption && hasStatusControl && hasTargetControl
    && hasMessage(["reports", "filters", "status", "all"])
    && hasMessage(["reports", "filters", "target", "all"]), "status/target controls and both locale message keys required");
  const hasActionLabels = ["dismiss", "hide_target", "ban_user"].every((action) =>
    new RegExp(`${action}:\\s*\\{\\s*label:\\s*text\\.reports\\.actions\\.${action}\\.label`).test(panel)
    && hasMessage(["reports", "actions", action, "label"]));
  const hasDismissControl = /\["reviewing",\s*"dismiss"\][\s\S]*?onClick=\{\(\) => requestAction\(action\)\}[\s\S]*?ACTION_CONFIG\[action\]\.label/.test(panel);
  const hasHideControl = /onClick=\{\(\) => requestAction\("hide_target"\)\}[\s\S]*?ACTION_CONFIG\.hide_target\.label/.test(panel);
  const hasBanControl = /\["warn_user",\s*"suspend_user",\s*"ban_user"\][\s\S]*?onClick=\{\(\) => requestAction\(action\)\}[\s\S]*?ACTION_CONFIG\[action\]\.label/.test(panel);
  check("admin reports action i18n contract", consumesAdminMessages && hasActionLabels
    && hasDismissControl && hasHideControl && hasBanControl, "dismiss/hide/ban controls and both locale message keys required");
}

if (exists(helperPath)) {
  const helper = read(helperPath);
  check("report helper notifies moderated post authors", /notifyPostModerated/i.test(helper));
  check("report helper notifies moderated comment authors", /notifyCommentModerated/i.test(helper));
}

if (exists(notificationHelperPath)) {
  const helper = read(notificationHelperPath);
  const commandType = helper.match(/type\s+ModerationNotificationCommand\s*=([\s\S]*?);/);
  const rpcCalls = [...helper.matchAll(/\bclient\s*\.\s*rpc\s*\(/g)];
  check("moderation notifications bind verified moderator actor",
    /function\s+createModerationNotificationWriter\s*\(\s*env\s*:\s*RuntimeEnv\s*,\s*verifiedActorId\s*:\s*string\s*,/.test(helper)
    && rpcCalls.length === 1
    && /client\s*\.\s*rpc\s*\(\s*["']insert_forum_notification["']\s*,\s*\{[^}]*\bp_actor_id\s*:\s*verifiedActorId\s*,/.test(helper)
    && !!commandType && !/\b(?:actor|actorId|actor_id|verifiedActorId|p_actor_id)\s*[?:]/i.test(commandType[1])
    && /!isUuid\(verifiedActorId\)/.test(helper));
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
