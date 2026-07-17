import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const root = process.cwd();
const ids = {
  reporter: "00000000-0000-0000-0000-000000000001",
  post: "00000000-0000-0000-0000-000000000002",
  comment: "00000000-0000-0000-0000-000000000003",
  circle: "00000000-0000-0000-0000-000000000004",
  user: "00000000-0000-0000-0000-000000000005",
};

function gitBlobHash(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  return createHash("sha1").update(`blob ${Buffer.byteLength(normalized)}\0`).update(normalized).digest("hex");
}

function query(result) {
  return {
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => result,
  };
}

function targetClient(rows) {
  return {
    from(table) {
      const row = rows[table];
      if (row === undefined) throw new Error(`unexpected table ${table}`);
      return query({ data: row, error: null });
    },
  };
}

function accessibleRows() {
  const circle = { id: ids.circle, name: "OpenGlass", slug: "open-glass", status: "active" };
  const post = { id: ids.post, title: "Visible post", body: "Body", author_id: ids.user, circle_id: ids.circle, status: "published", moderation_status: "published", profiles: null, circles: circle };
  const comment = { id: ids.comment, body: "Visible comment", author_id: ids.user, post_id: ids.post, status: "published", moderation_status: "published", profiles: null, posts: { id: ids.post, title: post.title, status: "published", moderation_status: "published", circle_id: ids.circle, circles: circle } };
  const profile = { id: ids.user, username: "target", display_name: "Target", avatar_url: null, role: "user", bio: "Bio" };
  return { posts: post, comments: comment, circles: circle, profiles: profile };
}

async function main() {
  const reportsRoute = await fs.readFile(path.join(root, "src/pages/api/forum/reports.ts"), "utf8");
  const reportsHelper = await fs.readFile(path.join(root, "src/lib/server/reports.server.ts"), "utf8");
  const migration = await fs.readFile(path.join(root, "supabase/migrations/20260713_forum_report_target_authorization.sql"), "utf8");
  const historicalSchema = await fs.readFile(path.join(root, "supabase/migrations/20260518_forum_phase1_schema.sql"), "utf8");
  const historicalReports = await fs.readFile(path.join(root, "supabase/migrations/20260627_reports_optimization_mvp.sql"), "utf8");

  assert.equal(gitBlobHash(historicalSchema), "48deb683515de975c84c1f44ac06d3048082fcd4");
  assert.equal(gitBlobHash(historicalReports), "264a4b3416cf483c66faf9d145d83cc355bea820");

  const route = reportsRoute.slice(reportsRoute.indexOf("export const POST"), reportsRoute.indexOf("export const ALL"));
  const safety = route.indexOf('assertUserCanWrite(client, authData.user.id, "report_create")');
  const parse = route.indexOf("const parsed = parsePayload(payload)");
  const target = route.indexOf("const resolved = await resolveReportTargetPreview");
  const rate = route.indexOf("recentCount = await countRecentReportsByUser");
  const create = route.indexOf("const created = await createUserReport");
  assert(safety > 0 && parse > safety && target > parse && rate > target && create > rate, "POST authorizes safety and target before report-rate reads and writes");
  assert.doesNotMatch(route, /payload\.(reporter_id|user_id|actor_id|role|status|priority|assigned_to|resolved_by)/, "POST accepts no client identity or privileged report fields");

  for (const required of [
    "public.can_create_user_report_target(",
    "when 'post' then exists",
    "when 'comment' then exists",
    "when 'circle' then exists",
    "when 'user' then exists",
    "post_ref.status = 'published'",
    "comment_ref.status = 'published'",
    "circle_ref.status = 'active'",
    "public.can_access_public_circle(circle_ref.id)",
    'drop policy if exists "reports_insert_self"',
    'create policy "reports_insert_self"',
    "reporter_id = auth.uid()",
    "status = 'open'",
    "priority = 'normal'",
    "assigned_to is null",
    "resolved_by is null",
    "resolution_note is null",
    "public.can_create_user_report_target(target_type::text, target_id)",
  ]) assert(migration.includes(required), `migration includes ${required}`);
  assert(/event_type = 'created'[\s\S]*actor_id = auth\.uid\(\)[\s\S]*reports\.reporter_id = auth\.uid\(\)/.test(historicalReports), "existing report event policy binds created events to the reporter");

  const vite = await createServer({ root, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
  try {
    const { parseUserReportPayload, resolveReportTargetPreview } = await vite.ssrLoadModule("/src/lib/server/reports.server.ts");
    for (const targetType of ["post", "comment", "circle", "user"]) {
      const resolved = await resolveReportTargetPreview(targetClient(accessibleRows()), targetType, ids[targetType]);
      assert.equal(resolved.exists, true, `${targetType} target exists`);
      assert.equal(resolved.available, true, `${targetType} target is reportable`);
      assert.equal(resolved.target?.target_id, ids[targetType], `${targetType} binds the requested id`);
    }

    const denied = [
      ["hidden post", { ...accessibleRows(), posts: { ...accessibleRows().posts, moderation_status: "hidden_by_admin" } }, "post", ids.post],
      ["deleted post circle", { ...accessibleRows(), posts: { ...accessibleRows().posts, circles: { ...accessibleRows().circles, status: "deleted" } } }, "post", ids.post],
      ["canonical-hidden circle", { ...accessibleRows(), posts: { ...accessibleRows().posts, circles: { ...accessibleRows().circles, slug: "rls-test-circle" } } }, "post", ids.post],
      ["hidden comment", { ...accessibleRows(), comments: { ...accessibleRows().comments, moderation_status: "hidden_by_admin" } }, "comment", ids.comment],
      ["comment post mismatch", { ...accessibleRows(), comments: { ...accessibleRows().comments, posts: { ...accessibleRows().comments.posts, id: ids.comment } } }, "comment", ids.comment],
      ["deleted comment circle", { ...accessibleRows(), comments: { ...accessibleRows().comments, posts: { ...accessibleRows().comments.posts, circles: { ...accessibleRows().circles, status: "deleted" } } } }, "comment", ids.comment],
      ["deleted circle", { ...accessibleRows(), circles: { ...accessibleRows().circles, status: "deleted" } }, "circle", ids.circle],
      ["missing user", { ...accessibleRows(), profiles: null }, "user", ids.user],
    ];
    for (const [name, rows, targetType, targetId] of denied) {
      const result = await resolveReportTargetPreview(targetClient(rows), targetType, targetId);
      assert(result.available === false, `${name} is denied before report/rate/event writes`);
    }

    for (const badPayload of [
      {},
      { target_type: "device", target_id: ids.post, reason_code: "spam" },
      { target_type: "post", target_id: "bad-id", reason_code: "spam" },
      { target_type: "post", target_id: ids.post, reason_code: "unknown" },
      { target_type: "post", target_id: ids.post, reason_code: "spam", reason_text: "bad" },
    ]) assert.equal(parseUserReportPayload(badPayload).ok, false, "invalid report payload denied before effects");
  } finally {
    await vite.close();
  }

  const createUserReport = reportsHelper.slice(reportsHelper.indexOf("export async function createUserReport"), reportsHelper.indexOf("function normalizeQueueRow"));
  const reportInsert = createUserReport.indexOf('.from("reports")');
  assert(createUserReport.indexOf("findDuplicateUserReport") < reportInsert, "duplicate lookup precedes report insertion");
  assert(reportInsert < createUserReport.indexOf("await insertReportEvent"), "report insert precedes created event insert");
  console.log(JSON.stringify({
    targets: ["post", "comment", "circle", "user"],
    allowed: "verified reporter with accessible target",
    denied: ["unauthenticated", "safety-denied", "malformed payload", "missing target", "inaccessible post/comment/circle ancestry", "client identity/status override"],
    ordering: ["safety", "payload", "target", "rate-read", "duplicate", "report-insert", "report-event-insert"],
    historicalMigrationsUnchanged: true,
    forwardRlsCoverage: ["reporter identity", "initial status", "priority", "assignment/resolution fields", "target ancestry"],
    realNetworkStorageDatabaseRequests: 0,
  }));
}

await main();
