import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const root = process.cwd();
const actorId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";

async function main() {
  const routePath = path.join(root, "src/pages/api/users/me/profile.ts");
  const migrationPath = path.join(root, "supabase/migrations/20260518_forum_phase1_schema.sql");
  const roleMigrationPath = path.join(root, "supabase/migrations/20260620_lock_profile_role_updates.sql");
  const serviceRepositoryPath = path.join(root, "src/lib/server/legal-consent-repository.server.ts");
  const [routeSource, migration, roleMigration, serviceRepository] = await Promise.all([
    readFile(routePath, "utf8"), readFile(migrationPath, "utf8"), readFile(roleMigrationPath, "utf8"), readFile(serviceRepositoryPath, "utf8"),
  ]);

  assert.match(routeSource, /PROFILE_MUTABLE_FIELDS = \["display_name", "username", "bio", "avatar_url", "banner_url"\]/);
  assert.match(routeSource, /PROFILE_FORBIDDEN_FIELDS/);
  assert.match(routeSource, /getStrictBearerToken/);
  assert.match(routeSource, /auth\.getUser\(token\)/);
  assert.match(routeSource, /\(dependencies\.assertWrite \?\? assertUserCanWrite\)\(auth\.client, auth\.userId, "profile_update"\)/);
  assert.match(routeSource, /isProfileMediaPathForUser\(payload\.avatarUrl, userId, "avatar"\)/);
  assert.match(routeSource, /isProfileMediaPathForUser\(payload\.bannerUrl, userId, "banner"\)/);
  assert.match(routeSource, /\.eq\("id", auth\.userId\)/);
  assert.match(routeSource, /PROFILE_USERNAME_UNAVAILABLE/);
  assert.match(routeSource, /PROFILE_UPDATE_FAILED/);
  assert.doesNotMatch(routeSource, /requireForumUser/);
  assert.doesNotMatch(routeSource, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
  assert.ok(routeSource.indexOf("const auth = await (dependencies.authenticate ?? authenticateProfileActor)") < routeSource.indexOf("const safetyDecision = await (dependencies.assertWrite ?? assertUserCanWrite)"));
  assert.ok(routeSource.indexOf("const consent = await (dependencies.requireConsent ?? requireAuthenticatedLegalConsent)") < routeSource.indexOf("const safetyDecision = await (dependencies.assertWrite ?? assertUserCanWrite)"));
  assert.ok(routeSource.indexOf("const safetyDecision = await (dependencies.assertWrite ?? assertUserCanWrite)") < routeSource.indexOf("const rawBody = await request.text"));
  const postStart = routeSource.indexOf("export function createProfilePost");
  assert.ok(routeSource.indexOf("const mediaError = validateProfileMediaReferences", postStart) < routeSource.indexOf("const [avatarModeration, bannerModeration]", postStart));
  assert.match(migration, /profiles_username_unique_ci[\s\S]*?lower\(username\)/i);
  assert.match(migration, /profiles_update_self_or_staff[\s\S]*?id = auth\.uid\(\)/i);
  assert.match(roleMigration, /revoke update on table public\.profiles from authenticated;/i);
  assert.match(roleMigration, /column_name in \('username', 'display_name', 'bio', 'avatar_url', 'banner_url'\)/i);
  assert.match(roleMigration, /execute format\('grant update \(%s\) on table public\.profiles to authenticated'/i);
  assert.match(serviceRepository, /SUPABASE_SERVICE_ROLE_KEY/);

  const vite = await createServer({ root, logLevel: "error", server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
  try {
    const route = await vite.ssrLoadModule("/src/pages/api/users/me/profile.ts");
    const media = await vite.ssrLoadModule("/src/lib/profile-media.ts");
    const { createProfilePost, parseProfilePayload } = route;
    const { isProfileMediaPathForUser } = media;

    assert.deepEqual(parseProfilePayload({ display_name: "Alice", username: "Alice_One", bio: "A safe profile" }), {
      displayName: "Alice", username: "alice_one", bio: "A safe profile", avatarUrl: undefined, bannerUrl: undefined,
    });
    assert.deepEqual(parseProfilePayload({ display_name: "Alice", username: null, bio: null, avatar_url: null, banner_url: null }), {
      displayName: "Alice", username: null, bio: null, avatarUrl: null, bannerUrl: null,
    });
    for (const value of [
      { display_name: "Alice", role: "admin" },
      { display_name: "Alice", user_id: otherId },
      { display_name: "Alice", safety_state: "active" },
    ]) assert.equal(parseProfilePayload(value).error, "PROFILE_FORBIDDEN_FIELD_UPDATE");
    for (const value of [
      { display_name: "Alice", website: "https://example.test" },
      { display_name: "<b>Alice</b>" },
      { display_name: "Alice", bio: "<script>alert(1)</script>" },
      { display_name: "Alice", username: "admin name" },
      { display_name: "Alice", bio: "x".repeat(241) },
    ]) assert.ok("error" in parseProfilePayload(value));

    const avatar = `profile-avatars/${actorId}/1710000000000-avatar.png`;
    const banner = `profile-banners/${actorId}/1710000000000-banner.webp`;
    assert.equal(isProfileMediaPathForUser(avatar, actorId, "avatar"), true);
    assert.equal(isProfileMediaPathForUser(banner, actorId, "banner"), true);
    for (const [value, kind] of [
      [`profile-avatars/${otherId}/1710000000000-avatar.png`, "avatar"],
      [banner, "avatar"],
      ["https://other.example/avatar.png", "avatar"],
      [`profile-avatars/${actorId}/../1710000000000-avatar.png`, "avatar"],
      [`profile-avatars/${actorId}/1710000000000-%2favatar.png`, "avatar"],
      [`profile-avatars\\${actorId}\\1710000000000-avatar.png`, "avatar"],
    ]) assert.equal(isProfileMediaPathForUser(value, actorId, kind), false, value);

    const calls = { reads: 0, writes: 0, safety: 0 };
    const fakeClient = {
      from() { calls.reads += 1; throw new Error("denied requests must not read profiles"); },
    };
    const currentConsent = async () => ({ ok: true, userId: actorId });
    const fakeConsentRepository = () => ({ findByUserAndBundle: async () => null });
    const deniedPost = createProfilePost({
      authenticate: async () => ({ client: fakeClient, userId: actorId }),
      requireConsent: currentConsent,
      createConsentRepository: fakeConsentRepository,
      assertWrite: async () => { calls.safety += 1; return { allowed: true, state: {} }; },
    });
    for (const payload of [
      { display_name: "Alice", role: "admin" },
      { display_name: "Alice", avatar_url: `profile-avatars/${otherId}/1710000000000-avatar.png` },
      { display_name: "Alice", banner_url: "https://outside.example/banner.png" },
      { display_name: "<script>Alice</script>" },
    ]) {
      const response = await deniedPost({ request: new Request("https://app.example/api/users/me/profile", { method: "POST", headers: { authorization: "Bearer local-test-token", "content-type": "application/json" }, body: JSON.stringify(payload) }), locals: { runtime: { env: { SUPABASE_URL: "https://example.test", SUPABASE_ANON_KEY: "anon" } } } });
      assert.equal(response.status, payload.role ? 403 : 400);
    }
    const safetyDenied = createProfilePost({
      authenticate: async () => ({ client: fakeClient, userId: actorId }),
      requireConsent: currentConsent,
      createConsentRepository: fakeConsentRepository,
      assertWrite: async () => ({ allowed: false, code: "USER_BANNED", status: 403, message: "blocked" }),
    });
    const safetyDeniedResponse = await safetyDenied({ request: new Request("https://app.example/api/users/me/profile", { method: "POST", headers: { authorization: "Bearer local-test-token", "content-type": "application/json" }, body: JSON.stringify({ display_name: "Alice" }) }), locals: { runtime: { env: { SUPABASE_URL: "https://example.test", SUPABASE_ANON_KEY: "anon" } } } });
    assert.equal(safetyDeniedResponse.status, 403);
    const consentCalls = [];
    const consentDenied = createProfilePost({
      authenticate: async () => { consentCalls.push("authenticate"); return { client: fakeClient, userId: actorId }; },
      createConsentRepository: () => { consentCalls.push("consent-repository"); return fakeConsentRepository(); },
      requireConsent: async () => { consentCalls.push("consent-denied"); return { ok: false, response: new Response(JSON.stringify({ error: "LEGAL_CONSENT_REQUIRED", consentUrl: "/legal-consent/" }), { status: 403 }) }; },
      assertWrite: async () => { consentCalls.push("safety"); return { allowed: true, state: {} }; },
    });
    const consentDeniedResponse = await consentDenied({ request: new Request("https://app.example/api/users/me/profile", { method: "POST", headers: { authorization: "Bearer local-test-token", "content-type": "application/json" }, body: JSON.stringify({ display_name: "Alice" }) }), locals: { runtime: { env: { SUPABASE_URL: "https://example.test", SUPABASE_ANON_KEY: "anon" } } } });
    assert.equal(consentDeniedResponse.status, 403);
    assert.deepEqual(await consentDeniedResponse.json(), { error: "LEGAL_CONSENT_REQUIRED", consentUrl: "/legal-consent/" });
    assert.deepEqual(consentCalls, ["authenticate", "consent-repository", "consent-denied"], "missing consent stops before safety, profile reads, moderation, storage, and profile update");
    assert.equal(calls.reads, 0, "all rejected requests stop before profile reads or writes");
    assert.equal(calls.writes, 0, "all rejected requests perform zero profile/media writes");
    assert.ok(calls.safety >= 4, "verified actor safety is checked before rejected profile payload work");
  } finally {
    await vite.close();
  }

  console.log(JSON.stringify({
    allowed: ["own canonical profile fields", "canonical lower-case username", "own avatar/banner key"],
    denied: ["missing schema fields", "privileged actor/role/safety fields", "markup/control text", "unknown URL/social fields", "foreign/cross-kind/external/traversal media"],
    effects: "offline source and pure-parser/media tests only; no auth, database, storage, provider, or network request is executed",
    serviceRole: "the known legal-consent service-role writer is asserted separately and is never constructed by the profile route",
  }));
}

await main();
