import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const root = process.cwd();
const ids = {
  recipient: "00000000-0000-4000-8000-000000000001",
  otherRecipient: "00000000-0000-4000-8000-000000000002",
  actor: "00000000-0000-4000-8000-000000000003",
  post: "00000000-0000-4000-8000-000000000004",
  comment: "00000000-0000-4000-8000-000000000005",
  notificationA: "00000000-0000-4000-8000-000000000006",
  notificationB: "00000000-0000-4000-8000-000000000007",
};

function row(overrides = {}) {
  return {
    id: ids.notificationA,
    recipient_id: ids.recipient,
    actor_id: ids.actor,
    type: "comment_on_post",
    post_id: ids.post,
    comment_id: ids.comment,
    read_at: null,
    created_at: "2026-07-17T01:00:00.000Z",
    last_event_at: "2026-07-17T02:00:00.000Z",
    ...overrides,
  };
}

function mutationClient(calls) {
  const chain = {
    eq(column, value) { calls.push(`eq:${column}:${value}`); return this; },
    is(column, value) { calls.push(`is:${column}:${value}`); return this; },
    then(resolve, reject) { calls.push("write"); return Promise.resolve({ error: null }).then(resolve, reject); },
  };
  return { from(table) { calls.push(`from:${table}`); return { update(value) { calls.push(`update:${JSON.stringify(value)}`); return chain; } }; } };
}

async function main() {
  const routePath = path.join(root, "src/pages/api/users/me/notifications.ts");
  const helperPath = path.join(root, "src/lib/notifications.ts");
  const migrationPath = path.join(root, "supabase/migrations/20260606_forum_notifications_mvp.sql");
  const [routeSource, helperSource, notificationMigration] = await Promise.all([readFile(routePath, "utf8"), readFile(helperPath, "utf8"), readFile(migrationPath, "utf8")]);

  assert.match(routeSource, /parseNotificationQuery/);
  assert.match(routeSource, /\.eq\("recipient_id", auth\.userId\)/);
  assert.match(routeSource, /\.is\("read_at", null\)/);
  assert.match(routeSource, /\.order\("id", \{ ascending: false \}\)/);
  assert.match(routeSource, /isPublicVisibleCircle/);
  assert.doesNotMatch(routeSource, /SUPABASE_SERVICE_ROLE|service_role/i);
  assert.ok(routeSource.indexOf("const token = getBearerToken") < routeSource.indexOf("createUserClient(env, token)"));
  assert.match(notificationMigration, /create policy "forum_notifications_select_own"[\s\S]*?using \(recipient_id = auth\.uid\(\)\)/);
  assert.match(notificationMigration, /create policy "forum_notifications_update_own"[\s\S]*?using \(recipient_id = auth\.uid\(\)\)[\s\S]*?with check \(recipient_id = auth\.uid\(\)\)/);
  assert.match(notificationMigration, /create policy "forum_notifications_delete_own"[\s\S]*?using \(recipient_id = auth\.uid\(\)\)/);
  assert.doesNotMatch(helperSource, /post_id: string|comment_id: string|id: string \| null/);

  const vite = await createServer({ root, logLevel: "error", server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
  try {
    const route = await vite.ssrLoadModule("/src/pages/api/users/me/notifications.ts");
    const notifications = await vite.ssrLoadModule("/src/lib/notifications.ts");
    const { createNotificationsGet, createNotificationsPatch, getBearerToken, normalizeNotificationRow, parseNotificationAction, parseNotificationQuery } = route;
    const { buildNotificationHref, buildNotificationPreview, sortNotificationsByLatestEvent } = notifications;

    assert.equal(getBearerToken(new Request("https://app.example", { headers: { authorization: "Bearer token" } })), "token");
    for (const authorization of ["Bearer", "Bearer token extra", "Basic token", "Bearer\ttoken"]) assert.equal(getBearerToken(new Request("https://app.example", { headers: { authorization } })), null, authorization);
    assert.deepEqual(parseNotificationQuery(new URL("https://app.example/api/users/me/notifications?limit=20&unread_only=true")), { limit: 20, unreadOnly: true });
    for (const search of ["?limit=0", "?limit=051", "?limit=51", "?limit=1x", "?limit=1&limit=2", "?unread_only=yes", "?sort=id.desc", "?recipient_id=other", "?offset=1"]) assert.equal(parseNotificationQuery(new URL(`https://app.example/api/users/me/notifications${search}`)), null, search);
    assert.equal(normalizeNotificationRow({ ...row(), recipient_id: ids.otherRecipient }, ids.recipient), null);
    assert.equal(normalizeNotificationRow({ ...row(), type: "raw_metadata" }, ids.recipient), null);
    assert.equal(normalizeNotificationRow({ ...row(), post_id: "not-a-uuid" }, ids.recipient)?.post_id, null);
    assert.equal(parseNotificationAction({ action: "mark_read", notification_id: ids.notificationA, user_id: ids.otherRecipient }), null);
    assert.equal(parseNotificationAction({ action: "mark_all_read", recipient_id: ids.otherRecipient }), null);
    assert.equal(buildNotificationHref("comment_on_post", ids.post, ids.comment), `/posts/${ids.post}/#comment-${ids.comment}`);
    for (const value of ["javascript:alert(1)", "https://elsewhere.example", "../private", `${ids.post}%2fprivate`]) assert.equal(buildNotificationHref("comment_on_post", value, null), "/notifications/", value);
    assert.equal(buildNotificationPreview("comment_on_post", "<script>secret</script>\u0000 visible"), "secret visible");
    assert.deepEqual(sortNotificationsByLatestEvent([row({ id: ids.notificationA }), row({ id: ids.notificationB })]).map((entry) => entry.id), [ids.notificationB, ids.notificationA]);

    const effects = { authentication: 0, reads: 0, writes: 0, consentReads: 0, consentGuards: 0 };
    const fakeClient = {};
    let rows = [row(), row({ id: ids.notificationB, last_event_at: "2026-07-17T02:00:00.000Z" })];
    const dependencies = {
      authenticate: async () => { effects.authentication += 1; return { client: fakeClient, userId: ids.recipient }; },
      getUnreadCount: async (_client, userId) => { effects.reads += 1; assert.equal(userId, ids.recipient); return 2; },
      loadNotificationRows: async (_client, userId, query) => { effects.reads += 1; assert.equal(userId, ids.recipient); assert.deepEqual(query, { limit: 20, unreadOnly: false }); return rows; },
      resolveActors: async () => new Map([[ids.actor, { username: "public_actor", display_name: "Public Actor", avatar_resolved_url: `/api/media/profile/${ids.actor}/avatar` }]]),
      resolvePosts: async () => new Map([[ids.post, { id: ids.post, title: "Visible post", circle_id: "circle", status: "published", moderation_status: "published" }]]),
      resolveComments: async () => new Map([[ids.comment, { id: ids.comment, body: "Visible comment", post_id: ids.post, status: "published", moderation_status: "published" }]]),
      createLegalConsentReadRepository: () => { effects.consentReads += 1; return {}; },
      requireAuthenticatedLegalConsent: async ({ identity }) => { effects.consentGuards += 1; assert.equal(identity.userId, ids.recipient); return { ok: true, userId: ids.recipient }; },
      now: () => "2026-07-17T03:00:00.000Z",
    };
    const get = createNotificationsGet(dependencies);
    const allowed = await get({ request: new Request("https://app.example/api/users/me/notifications"), locals: {} });
    assert.equal(allowed.status, 200);
    const allowedPayload = await allowed.json();
    assert.equal(effects.reads, 2);
    assert.equal(effects.writes, 0);
    assert.deepEqual(allowedPayload.notifications.map((entry) => entry.id), [ids.notificationB, ids.notificationA]);
    const returned = allowedPayload.notifications[0];
    assert.equal(returned.href, `/posts/${ids.post}/#comment-${ids.comment}`);
    assert.equal(returned.preview, "Visible comment");
    assert.equal("recipient_id" in returned, false);
    assert.equal("post_id" in returned, false);
    assert.equal("comment_id" in returned, false);
    assert.equal("id" in returned.actor, false);
    assert.equal("avatar_url" in returned.actor, false);
    assert.doesNotMatch(JSON.stringify(allowedPayload), new RegExp(ids.recipient));

    const redacted = createNotificationsGet({ ...dependencies, resolvePosts: async () => new Map(), resolveComments: async () => new Map() });
    const redactedResponse = await redacted({ request: new Request("https://app.example/api/users/me/notifications"), locals: {} });
    const redactedPayload = await redactedResponse.json();
    assert.equal(redactedPayload.notifications[0].href, "/notifications/");
    assert.equal(redactedPayload.notifications[0].preview, null);

    const beforeInvalid = effects.reads;
    const malformed = await get({ request: new Request("https://app.example/api/users/me/notifications?sort=id.desc"), locals: {} });
    assert.equal(malformed.status, 400);
    assert.equal(effects.reads, beforeInvalid, "invalid query stops before notification reads");
    const unauthenticated = createNotificationsGet({ ...dependencies, authenticate: async () => ({ error: new Response("denied", { status: 401 }) }) });
    const beforeUnauthorized = effects.reads;
    const denied = await unauthenticated({ request: new Request("https://app.example/api/users/me/notifications"), locals: {} });
    assert.equal(denied.status, 401);
    assert.equal(effects.reads, beforeUnauthorized, "authentication denial stops before notification reads");

    const calls = [];
    const patch = createNotificationsPatch({ ...dependencies, authenticate: async () => ({ client: mutationClient(calls), userId: ids.recipient }) });
    const own = await patch({ request: new Request("https://app.example/api/users/me/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mark_read", notification_id: ids.notificationA }) }), locals: {} });
    assert.equal(own.status, 200);
    assert.deepEqual(calls.filter((call) => call.startsWith("eq:") || call.startsWith("is:")), [`eq:recipient_id:${ids.recipient}`, "is:read_at:null", `eq:id:${ids.notificationA}`]);
    assert.equal(calls.filter((call) => call === "write").length, 1);
    const beforeBadAction = calls.length;
    const badAction = await patch({ request: new Request("https://app.example/api/users/me/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mark_read", notification_id: ids.notificationA, user_id: ids.otherRecipient }) }), locals: {} });
    assert.equal(badAction.status, 400);
    assert.equal(calls.length, beforeBadAction, "rejected payload performs zero writes");
    const bulk = await patch({ request: new Request("https://app.example/api/users/me/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mark_all_read" }) }), locals: {} });
    assert.equal(bulk.status, 200);
    assert.equal(calls.filter((call) => call === `eq:recipient_id:${ids.recipient}`).length, 2, "bulk updates remain verified-recipient scoped");
    assert.equal(calls.filter((call) => call === "is:read_at:null").length, 2, "repeat calls skip already-read rows");

    for (const outcome of ["missing", "outdated", "failure"]) {
      const denialCalls = [];
      const deniedPatch = createNotificationsPatch({
        ...dependencies,
        authenticate: async () => ({ client: mutationClient(denialCalls), userId: ids.recipient }),
        createLegalConsentReadRepository: () => { effects.consentReads += 1; return {}; },
        requireAuthenticatedLegalConsent: async () => ({
          ok: false,
          response: new Response(JSON.stringify(outcome === "failure"
            ? { error: "LEGAL_CONSENT_UNAVAILABLE" }
            : { error: "LEGAL_CONSENT_REQUIRED", consentUrl: "/legal-consent/" }), { status: outcome === "failure" ? 503 : 403 }),
        }),
      });
      const deniedResponse = await deniedPatch({ request: new Request("https://app.example/api/users/me/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mark_all_read", recipient_id: ids.otherRecipient }) }), locals: {} });
      assert.equal(deniedResponse.status, outcome === "failure" ? 503 : 403);
      assert.deepEqual(await deniedResponse.json(), outcome === "failure"
        ? { error: "LEGAL_CONSENT_UNAVAILABLE" }
        : { error: "LEGAL_CONSENT_REQUIRED", consentUrl: "/legal-consent/" });
      assert.deepEqual(denialCalls, [], `${outcome} consent denial performs zero notification writes`);
    }
    const unauthenticatedPatch = createNotificationsPatch({ ...dependencies, authenticate: async () => ({ error: new Response("denied", { status: 401 }) }) });
    const unauthenticatedResponse = await unauthenticatedPatch({ request: new Request("https://app.example/api/users/me/notifications", { method: "PATCH" }), locals: {} });
    assert.equal(unauthenticatedResponse.status, 401);
  } finally {
    await vite.close();
  }

  console.log(JSON.stringify({
    allowed: ["verified recipient only", "strict bounded limit and unread filter", "stable last_event_at/created_at/id order", "same-origin internal links", "public actor fields only", "visible target preview"],
    deniedOrRedacted: ["absent or malformed bearer", "recipient override", "filter/sort/offset grammar", "invalid/excessive pagination", "raw metadata type", "unsafe target id", "missing or inaccessible target text/link", "client actor or recipient fields"],
    effects: "GET uses authenticated RLS reads only and performs zero writes; PATCH gates current consent before body parsing and writes only unread rows scoped to auth.getUser-derived recipient",
    externalOperations: "none; all test clients are fakes",
  }));
}

await main();
