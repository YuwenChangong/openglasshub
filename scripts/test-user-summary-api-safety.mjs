import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { cloudflareWorkersTestPlugin, setCloudflareWorkersTestBinding } from "./lib/cloudflare-workers-test-plugin.mjs";

const root = process.cwd();
const actorId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";

const ownedContext = { request: new Request("https://app.example/api/users/me/summary", { headers: { authorization: "Bearer local-test" } }), locals: {} };
const ownedProfile = { id: actorId, username: "actor", display_name: "Actor", avatar_url: `profile-avatars/${actorId}/1710000000000-avatar.png` };
const ownedDependencies = {
  authenticate: async () => ({ client: {}, userId: actorId }),
  loadProfile: async () => ownedProfile,
  countPostLikes: async () => ({ postCount: 3, likeCount: 5 }),
  countCommentLikes: async () => 7,
  resolveAvatar: async () => `/api/media/profile/${actorId}/avatar`,
};

async function optionalCountsDoNotHideProfile(createSummaryGet) {
  const handler = createSummaryGet({ ...ownedDependencies,
    countPostLikes: async () => { throw new Error("fixture read denied"); },
  });
  const response = await handler(ownedContext);
  const body = await response.json();
  console.log(`optionalCountsDoNotHideProfile: observed status=${response.status} expected=200`);
  assert.equal(response.status, 200);
  assert.equal(body.profile.id, actorId);
  assert.equal(body.stats.post_count, null);
  assert.equal(body.stats.received_like_count, null);
  assert.equal(body.availability.posts, "unavailable");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(body.profile).sort(), ["avatar_resolved_url", "display_name", "id", "profile_href", "username"].sort());
  console.log("optionalCountsDoNotHideProfile: PASS");
}

async function readSummary(createSummaryGet, overrides = {}) {
  const response = await createSummaryGet({ ...ownedDependencies, ...overrides })(ownedContext);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return { response, body: await response.json() };
}

function queryClient(rows, queries = []) {
  return { from(table) {
    const query = { table, filters: [] };
    queries.push(query);
    const builder = {
      select(columns, options) { query.columns = columns; query.options = options; return this; },
      eq(column, value) { query.filters.push([column, value]); return this; },
      abortSignal(signal) { query.signal = signal; return this; },
      maybeSingle() { return Promise.resolve(rows[table]); },
      then(resolve, reject) { return Promise.resolve(rows[table]).then(resolve, reject); },
    };
    return builder;
  } };
}

async function profileMissingDiffersFromUnavailable(createSummaryGet) {
  for (const [label, result, status, code, diagnosticStatus] of [
    ["missing", { data: null, error: null }, 404, "PROFILE_NOT_FOUND", "missing"],
    ["RLS", { data: null, error: { message: "fixture RLS query denied", code: "42501" } }, 503, "PROFILE_UNAVAILABLE", "unavailable"],
    ["RLS with data", { data: ownedProfile, error: { message: "fixture private query" } }, 503, "PROFILE_UNAVAILABLE", "unavailable"],
    ["mismatch", { data: { ...ownedProfile, id: otherId, username: "other" }, error: null }, 404, "PROFILE_NOT_FOUND", "missing"],
  ]) {
    const events = [];
    const queries = [];
    let optionalReads = 0;
    const client = queryClient({ profiles: result }, queries);
    const { response, body } = await readSummary(createSummaryGet, {
      authenticate: async () => ({ client, userId: actorId }), loadProfile: undefined,
      observe: (event) => events.push(event),
      resolveAvatar: async () => { optionalReads += 1; return null; },
      countPostLikes: async () => { optionalReads += 1; return { postCount: 0, likeCount: 0 }; },
      countCommentLikes: async () => { optionalReads += 1; return 0; },
    });
    assert.equal(response.status, status, label);
    assert.deepEqual(body, { ok: false, code });
    assert.equal(optionalReads, 0, "failed profile must not start optional reads");
    assert.deepEqual(queries.map(({ table, columns, filters }) => ({ table, columns, filters })),
      [{ table: "profiles", columns: "id,username,display_name,avatar_url", filters: [["id", actorId]] }]);
    assert.deepEqual(events.map(({ stage, status }) => ({ stage, status })), [{ stage: "auth", status: "ok" }, { stage: "profile", status: diagnosticStatus }]);
  }
  const thrown = await readSummary(createSummaryGet, { loadProfile: async () => { throw new Error("fixture query secret"); } });
  assert.equal(thrown.response.status, 503);
  assert.deepEqual(thrown.body, { ok: false, code: "PROFILE_UNAVAILABLE" });
  console.log("profileMissingDiffersFromUnavailable: PASS missing/mismatch=404 RLS/thrown=503 no optional reads");
}

async function summaryNeverLeaksPrivateFields(createSummaryGet) {
  const events = [];
  const { response, body } = await readSummary(createSummaryGet, {
    authenticate: async () => ({ client: {}, userId: actorId, email: "private@fixture.test", user_metadata: { fixture: "private-auth" } }),
    loadProfile: async () => ({ ...ownedProfile, email: "private@fixture.test", role: "fixture-role", user_metadata: { fixture: "private-auth" }, otherActor: otherId }),
    countCommentLikes: async () => { throw new Error("fixture-private-query-error"); },
    observe: (event) => events.push(event),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ["availability", "ok", "profile", "stats"]);
  assert.deepEqual(Object.keys(body.profile).sort(), ["avatar_resolved_url", "display_name", "id", "profile_href", "username"]);
  assert.deepEqual(Object.keys(body.stats).sort(), ["post_count", "received_like_count"]);
  assert.deepEqual(Object.keys(body.availability).sort(), ["avatar", "commentLikes", "posts"]);
  assert.deepEqual(events.map(({ stage, status }) => ({ stage, status })).sort((a, b) => a.stage.localeCompare(b.stage)), [
    { stage: "auth", status: "ok" }, { stage: "avatar", status: "ok" }, { stage: "comments", status: "unavailable" },
    { stage: "posts", status: "ok" }, { stage: "profile", status: "ok" },
  ]);
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), ["durationMs", "stage", "status"]);
    assert.equal(Number.isFinite(event.durationMs) && event.durationMs >= 0, true);
  }
  assert.doesNotMatch(JSON.stringify({ body, events }), /private@|fixture-role|private-auth|fixture-private-query-error|profile-avatars|00000000-0000-4000-8000-000000000002/);
  const observerThrows = await readSummary(createSummaryGet, { observe: () => { throw new Error("fixture observer denied"); } });
  assert.equal(observerThrows.response.status, 200);
  assert.equal(observerThrows.body.stats.received_like_count, 12);
  console.log("summaryNeverLeaksPrivateFields: PASS closed response and diagnostics; observer exceptions isolated");
}

async function independentOptionalFailures(createSummaryGet) {
  const comments = await readSummary(createSummaryGet, { countCommentLikes: async () => { throw new Error("fixture comment denied"); } });
  assert.equal(comments.response.status, 200);
  assert.deepEqual(comments.body.stats, { post_count: 3, received_like_count: null });
  assert.deepEqual(comments.body.availability, { avatar: "ready", posts: "ready", commentLikes: "unavailable" });
  const avatar = await readSummary(createSummaryGet, { resolveAvatar: async () => { throw new Error("fixture avatar denied"); } });
  assert.equal(avatar.response.status, 200);
  assert.equal(avatar.body.profile.avatar_resolved_url, null);
  assert.deepEqual(avatar.body.stats, { post_count: 3, received_like_count: 12 });
  assert.deepEqual(avatar.body.availability, { avatar: "unavailable", posts: "ready", commentLikes: "ready" });
  const zeros = await readSummary(createSummaryGet, { countPostLikes: async () => ({ postCount: 0, likeCount: 0 }), countCommentLikes: async () => 0 });
  assert.deepEqual(zeros.body.stats, { post_count: 0, received_like_count: 0 });
  console.log("independentOptionalFailures: PASS comment-only/avatar-only and genuine measured zero");
}

async function countsStayUnknown(createSummaryGet) {
  for (const [postCount, likeCount, commentCount, expected, availability] of [
    [null, null, null, { post_count: null, received_like_count: null }, { posts: "unavailable", commentLikes: "unavailable" }],
    [3, null, 7, { post_count: 3, received_like_count: null }, { posts: "unavailable", commentLikes: "ready" }],
    [null, 5, 7, { post_count: null, received_like_count: 12 }, { posts: "unavailable", commentLikes: "ready" }],
  ]) {
    const queries = [];
    const client = queryClient({ posts: { count: postCount, error: null }, post_votes: { count: likeCount, error: null }, comment_reactions: { count: commentCount, error: null } }, queries);
    const { response, body } = await readSummary(createSummaryGet, {
      authenticate: async () => ({ client, userId: actorId }), countPostLikes: undefined, countCommentLikes: undefined,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(body.stats, expected);
    assert.equal(body.availability.posts, availability.posts);
    assert.equal(body.availability.commentLikes, availability.commentLikes);
    assert.equal(queries.length, 3);
    for (const query of queries) {
      assert.deepEqual(query.options, { count: "exact", head: true });
      assert.equal(query.signal instanceof AbortSignal, true);
      assert.equal(query.signal, queries[0].signal);
      assert.equal(query.filters.some(([key, value]) => key.endsWith("author_id") && value === actorId), true);
      assert.equal(query.filters.some(([key, value]) => key.endsWith("moderation_status") && value === "published"), true);
    }
  }
  for (const [table, expected] of [
    ["posts", { post_count: null, received_like_count: 12 }],
    ["post_votes", { post_count: 3, received_like_count: null }],
    ["comment_reactions", { post_count: 3, received_like_count: null }],
  ]) {
    const rows = { posts: { count: 3, error: null }, post_votes: { count: 5, error: null }, comment_reactions: { count: 7, error: null } };
    rows[table] = { count: 99, error: { message: "fixture private aggregate denied" } };
    const client = queryClient(rows);
    const { response, body } = await readSummary(createSummaryGet, {
      authenticate: async () => ({ client, userId: actorId }), countPostLikes: undefined, countCommentLikes: undefined,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(body.stats, expected);
  }
  const emptyIdentity = await readSummary(createSummaryGet, { loadProfile: async () => ({ id: actorId, username: null, display_name: null, avatar_url: null }) });
  assert.equal(emptyIdentity.response.status, 200);
  assert.equal(emptyIdentity.body.profile.id, actorId);
  assert.equal(emptyIdentity.body.profile.username, null);
  assert.equal(emptyIdentity.body.profile.display_name, null);
  assert.equal(emptyIdentity.body.profile.avatar_resolved_url, null);
  console.log("countsStayUnknown: PASS SDK null is unknown, partial measured counts retained, actor-scoped abortable reads");
}

async function avatarRequiresOwnerProxy(createSummaryGet) {
  const proxy = `/api/media/profile/${actorId}/avatar`;
  for (const resolved of [null, "not a URL", "javascript:fixture", "//fixture.test/avatar", "https://fixture.test/avatar", proxy + "?fixture=private", proxy + "#fragment", `/api/media/profile/${otherId}/avatar`, proxy.replace("/avatar", "/%61vatar")]) {
    const { body } = await readSummary(createSummaryGet, { resolveAvatar: async () => resolved });
    assert.equal(body.profile.avatar_resolved_url, null);
    assert.equal(body.availability.avatar, "unavailable");
    assert.equal(body.stats.received_like_count, 12);
  }
  for (const rawAvatar of [null, "https://fixture.test/avatar", `profile-avatars/${otherId}/1710000000000-avatar.png`, `profile-banners/${actorId}/1710000000000-banner.png`]) {
    const { body } = await readSummary(createSummaryGet, { loadProfile: async () => ({ ...ownedProfile, avatar_url: rawAvatar }), resolveAvatar: async () => proxy });
    assert.equal(body.profile.avatar_resolved_url, null);
    assert.equal(body.availability.avatar, "unavailable");
  }
  const resolved = await readSummary(createSummaryGet, { resolveAvatar: undefined });
  assert.equal(resolved.body.profile.avatar_resolved_url, proxy);
  console.log("avatarRequiresOwnerProxy: PASS malformed/arbitrary/cross-actor URLs rejected; existing resolver succeeds");
}

async function unauthorizedIsClosed(createSummaryGet) {
  for (const authenticate of [undefined, async () => ({ error: new Response("fixture private auth metadata", { status: 401 }) }), async () => { throw new Error("fixture private auth error"); }]) {
    const events = [];
    const response = await createSummaryGet({ ...ownedDependencies, authenticate,
      loadProfile: async () => assert.fail("unauthorized summary must not read profile"), observe: (event) => events.push(event),
    })({ request: new Request("https://app.example/api/users/me/summary"), locals: {} });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ok: false, code: "UNAUTHORIZED" });
    assert.deepEqual(events.map(({ stage, status }) => ({ stage, status })), [{ stage: "auth", status: "unavailable" }]);
  }
  console.log("unauthorizedIsClosed: PASS missing bearer/rejected/thrown auth; no reads or private error payload");
}

async function sharedDeadlineContainsLateFailures(createSummaryGet) {
  const unhandled = [];
  const events = [];
  const signals = [];
  let rejectLate;
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    const started = performance.now();
    const { response, body } = await readSummary(createSummaryGet, {
      resolveAvatar: () => new Promise(() => {}),
      countPostLikes: (_client, id, signal) => { assert.equal(id, actorId); signals.push(signal); return new Promise((_, reject) => { rejectLate = reject; }); },
      countCommentLikes: (_client, id, signal) => { assert.equal(id, actorId); signals.push(signal); return new Promise(() => {}); },
      observe: (event) => events.push(event),
    });
    const elapsedMs = performance.now() - started;
    assert.equal(response.status, 200);
    assert.equal(body.profile.id, actorId);
    assert.deepEqual(body.stats, { post_count: null, received_like_count: null });
    assert.deepEqual(body.availability, { avatar: "unavailable", posts: "unavailable", commentLikes: "unavailable" });
    assert.equal(elapsedMs >= 1400 && elapsedMs < 2500, true, `one 1500ms budget, elapsed=${elapsedMs}`);
    assert.equal(signals.length, 2);
    assert.equal(signals[0] instanceof AbortSignal, true);
    assert.equal(signals[0], signals[1]);
    assert.equal(signals[0].aborted, true);
    const eventSnapshot = JSON.stringify(events);
    rejectLate(new Error("fixture late query denied"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(unhandled, []);
    assert.equal(JSON.stringify(events), eventSnapshot, "late completion must not emit new diagnostics");
    assert.equal(events.length, 5);
    for (const event of events) assert.deepEqual(Object.keys(event).sort(), ["durationMs", "stage", "status"]);
    console.log(`sharedDeadlineContainsLateFailures: PASS elapsedMs=${Math.round(elapsedMs)} aborted=true unhandled=0 stages=5`);
  } finally { process.off("unhandledRejection", onUnhandled); }
  const started = performance.now();
  const { body } = await readSummary(createSummaryGet, { resolveAvatar: () => new Promise(() => {}) });
  assert.equal(performance.now() - started < 2500, true);
  assert.deepEqual(body.stats, { post_count: 3, received_like_count: 12 });
  assert.deepEqual(body.availability, { avatar: "unavailable", posts: "ready", commentLikes: "ready" });
  console.log("sharedDeadlinePreservesSettledReads: PASS avatar stall preserves measured counts");
}

async function sdkDeadlinePreservesKnownPostCount(createSummaryGet) {
  let rejectLate;
  const queries = [];
  const client = queryClient({
    posts: { count: 3, error: null },
    post_votes: new Promise((_, reject) => { rejectLate = reject; }),
    comment_reactions: { count: 7, error: null },
  }, queries);
  const started = performance.now();
  const { response, body } = await readSummary(createSummaryGet, {
    authenticate: async () => ({ client, userId: actorId }), countPostLikes: undefined, countCommentLikes: undefined,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(body.stats, { post_count: 3, received_like_count: null }, "a stalled like read must not discard the measured post count");
  assert.deepEqual(body.availability, { avatar: "ready", posts: "unavailable", commentLikes: "ready" });
  assert.equal(performance.now() - started < 2500, true);
  assert.equal(queries.every(({ signal }) => signal.aborted), true);
  rejectLate(new Error("fixture late post-vote denial"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  console.log("sdkDeadlinePreservesKnownPostCount: PASS measured post_count=3 survives stalled like subquery and late rejection");
}

async function main() {
  setCloudflareWorkersTestBinding({ SUPABASE_URL: "https://example.test", SUPABASE_ANON_KEY: "anon" });
  const [source, notificationMigration, profileMigration, consentRepository] = await Promise.all([
    readFile(path.join(root, "src/pages/api/users/me/summary.ts"), "utf8"),
    readFile(path.join(root, "supabase/migrations/20260606_forum_notifications_mvp.sql"), "utf8"),
    readFile(path.join(root, "supabase/migrations/20260518_forum_phase1_schema.sql"), "utf8"),
    readFile(path.join(root, "src/lib/server/legal-consent-repository.server.ts"), "utf8"),
  ]);
  assert.match(source, /auth\.getUser\(token\)/);
  assert.match(source, /\.eq\("id", userId\)/);
  assert.match(source, /\.eq\("author_id", authorId\)/);
  assert.match(source, /\.eq\("posts\.author_id", authorId\)/);
  assert.match(source, /\.eq\("comments\.author_id", authorId\)/);
  assert.match(source, /isProfileMediaPathForUser\(profile\.avatar_url, profile\.id, "avatar"\)/);
  assert.doesNotMatch(source, /avatar_url: profile\.avatar_url|role: profile\.role|SUPABASE_SERVICE_ROLE_KEY|createLegalConsent/);
  assert.match(notificationMigration, /forum_notifications_select_own[\s\S]*?recipient_id = auth\.uid\(\)/);
  assert.match(profileMigration, /profiles_select_public/);
  assert.match(consentRepository, /SUPABASE_SERVICE_ROLE_KEY/);

  const vite = await createServer({ root, logLevel: "error", plugins: [cloudflareWorkersTestPlugin()], server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
  try {
    const { createSummaryGet, getBearerToken } = await vite.ssrLoadModule("/src/pages/api/users/me/summary.ts");
    await optionalCountsDoNotHideProfile(createSummaryGet);
    assert.equal(getBearerToken(new Request("https://app.example", { headers: { authorization: "Bearer token" } })), "token");
    for (const value of ["Bearer", "Bearer token extra", "Basic token", "Bearer\ttoken"]) assert.equal(getBearerToken(new Request("https://app.example", { headers: { authorization: value } })), null);
    const calls = { auth: 0, profile: 0, posts: 0, comments: 0, media: 0, writes: 0 };
    const fakeClient = {};
    const get = createSummaryGet({
      authenticate: async () => { calls.auth += 1; return { client: fakeClient, userId: actorId }; },
      loadProfile: async (_client, id) => { calls.profile += 1; assert.equal(id, actorId); return { id: actorId, username: "actor", display_name: "Actor", avatar_url: `profile-avatars/${actorId}/1710000000000-avatar.png` }; },
      countPostLikes: async (_client, id) => { calls.posts += 1; assert.equal(id, actorId); return { postCount: 3, likeCount: 5 }; },
      countCommentLikes: async (_client, id) => { calls.comments += 1; assert.equal(id, actorId); return 7; },
      resolveAvatar: async (_client, profile) => { calls.media += 1; assert.equal(profile.id, actorId); return `/api/media/profile/${actorId}/avatar`; },
    });
    const response = await get({ request: new Request("https://app.example/api/users/me/summary", { headers: { authorization: "Bearer local-test" } }), locals: { runtime: { env: { SUPABASE_URL: "https://example.test", SUPABASE_ANON_KEY: "anon" } } } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { ok: true, profile: { id: actorId, username: "actor", display_name: "Actor", profile_href: "/u/actor/", avatar_resolved_url: `/api/media/profile/${actorId}/avatar` }, stats: { post_count: 3, received_like_count: 12 }, availability: { avatar: "ready", posts: "ready", commentLikes: "ready" } });
    assert.equal(calls.writes, 0);
    const denied = createSummaryGet({ authenticate: async () => ({ error: new Response("denied", { status: 401 }) }), loadProfile: async () => { calls.profile += 1; return null; } });
    const before = calls.profile;
    assert.equal((await denied({ request: new Request("https://app.example/api/users/me/summary"), locals: { runtime: { env: { SUPABASE_URL: "https://example.test", SUPABASE_ANON_KEY: "anon" } } } })).status, 401);
    assert.equal(calls.profile, before, "authentication denial performs zero summary reads");
    const mismatch = createSummaryGet({ authenticate: async () => ({ client: fakeClient, userId: actorId }), loadProfile: async () => ({ id: otherId, username: "other", display_name: "Other", avatar_url: null }) });
    assert.equal((await mismatch({ request: new Request("https://app.example/api/users/me/summary", { headers: { authorization: "Bearer local-test" } }), locals: { runtime: { env: { SUPABASE_URL: "https://example.test", SUPABASE_ANON_KEY: "anon" } } } })).status, 404);
    console.log("existingSafetyAssertions: PASS bearer parsing, own actor, numeric 3/12, denied reads, mismatch, no writes");
    await profileMissingDiffersFromUnavailable(createSummaryGet);
    await summaryNeverLeaksPrivateFields(createSummaryGet);
    await independentOptionalFailures(createSummaryGet);
    await countsStayUnknown(createSummaryGet);
    await avatarRequiresOwnerProxy(createSummaryGet);
    await unauthorizedIsClosed(createSummaryGet);
    await sdkDeadlinePreservesKnownPostCount(createSummaryGet);
    await sharedDeadlineContainsLateFailures(createSummaryGet);
  } finally { await vite.close(); }
  console.log(JSON.stringify({ actorIsolation: "all fake repository calls receive only auth.getUser-derived actor", privacy: "response is closed and contains no role, raw avatar, email, auth, consent, report, or safety fields", effects: "zero writes, storage, network, or service-role operations" }));
}
await main();
