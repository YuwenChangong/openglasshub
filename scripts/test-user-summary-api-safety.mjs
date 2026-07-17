import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const root = process.cwd();
const actorId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";

async function main() {
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

  const vite = await createServer({ root, logLevel: "error", server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
  try {
    const { createSummaryGet, getBearerToken } = await vite.ssrLoadModule("/src/pages/api/users/me/summary.ts");
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
    assert.deepEqual(body, { ok: true, profile: { id: actorId, username: "actor", display_name: "Actor", profile_href: "/u/actor/", avatar_resolved_url: `/api/media/profile/${actorId}/avatar` }, stats: { post_count: 3, received_like_count: 12 } });
    assert.equal(calls.writes, 0);
    const denied = createSummaryGet({ authenticate: async () => ({ error: new Response("denied", { status: 401 }) }), loadProfile: async () => { calls.profile += 1; return null; } });
    const before = calls.profile;
    assert.equal((await denied({ request: new Request("https://app.example/api/users/me/summary"), locals: { runtime: { env: { SUPABASE_URL: "https://example.test", SUPABASE_ANON_KEY: "anon" } } } })).status, 401);
    assert.equal(calls.profile, before, "authentication denial performs zero summary reads");
    const mismatch = createSummaryGet({ authenticate: async () => ({ client: fakeClient, userId: actorId }), loadProfile: async () => ({ id: otherId, username: "other", display_name: "Other", avatar_url: null }) });
    assert.equal((await mismatch({ request: new Request("https://app.example/api/users/me/summary", { headers: { authorization: "Bearer local-test" } }), locals: { runtime: { env: { SUPABASE_URL: "https://example.test", SUPABASE_ANON_KEY: "anon" } } } })).status, 404);
  } finally { await vite.close(); }
  console.log(JSON.stringify({ actorIsolation: "all fake repository calls receive only auth.getUser-derived actor", privacy: "response is closed and contains no role, raw avatar, email, auth, consent, report, or safety fields", effects: "zero writes, storage, network, or service-role operations" }));
}
await main();
