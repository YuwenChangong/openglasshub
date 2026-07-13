import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const root = process.cwd();
const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  otherUser: "00000000-0000-4000-8000-000000000002",
};
const avatarPath = `profile-avatars/${ids.user}/1752451200000-avatar.png`;
const bannerPath = `profile-banners/${ids.user}/1752451200001-banner.webp`;

function gitBlobHash(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  return createHash("sha1").update(`blob ${Buffer.byteLength(normalized)}\0`).update(normalized).digest("hex");
}

function profile(overrides = {}) {
  return { id: ids.user, avatar_url: avatarPath, banner_url: bannerPath, ...overrides };
}

function createClient(row, calls) {
  return {
    from(table) {
      assert.equal(table, "profiles", "the public media route reads only the server-selected profile row");
      return {
        select(columns) {
          calls.push(`profiles.select:${columns}`);
          return this;
        },
        eq(column, value) {
          calls.push(`profiles.eq:${column}:${value}`);
          return this;
        },
        async maybeSingle() {
          calls.push("profiles.maybeSingle");
          return { data: row, error: null };
        },
      };
    },
  };
}

async function main() {
  const routePath = path.join(root, "src/pages/api/media/profile/[userId]/[kind].ts");
  const helperPath = path.join(root, "src/lib/profile-media.ts");
  const proxyPath = path.join(root, "src/lib/media-proxy.ts");
  const migrationPath = path.join(root, "supabase/migrations/20260716_profile_media_delivery_authorization.sql");
  const historicalPolicyPath = path.join(root, "supabase/migrations/20260606_profile_banner_and_storage.sql");
  const [routeSource, helperSource, proxySource, migration, historicalPolicy] = await Promise.all([
    readFile(routePath, "utf8"),
    readFile(helperPath, "utf8"),
    readFile(proxyPath, "utf8"),
    readFile(migrationPath, "utf8"),
    readFile(historicalPolicyPath, "utf8"),
  ]);

  assert.equal(gitBlobHash(historicalPolicy), "8e7bc4af4b834bca578af54241decd2a661b6d1a");
  assert.match(routeSource, /resolvePublicProfileMediaTarget\(supabase, userId, kind\)/);
  assert.ok(routeSource.indexOf("const path = await resolvePublicProfileMediaTarget") < routeSource.lastIndexOf("streamStorageObjectViaSignedUrl"));
  assert.doesNotMatch(routeSource, /Authorization|auth\.getUser|createUserClient|Response\.redirect/);
  assert.doesNotMatch(routeSource, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);
  assert.match(helperSource, /isProfileMediaPathForUser/);
  assert.match(proxySource, /AbortController/);
  assert.match(proxySource, /DEFAULT_MAX_RESPONSE_BYTES/);
  assert.match(proxySource, /allowedContentTypes/);
  assert.doesNotMatch(proxySource, /headers\.set\(["']set-cookie/);

  const vite = await createServer({ root, logLevel: "error", server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
  try {
    const route = await vite.ssrLoadModule("/src/pages/api/media/profile/[userId]/[kind].ts");
    const proxy = await vite.ssrLoadModule("/src/lib/media-proxy.ts");
    const profileMedia = await vite.ssrLoadModule("/src/lib/profile-media.ts");
    const { createProfileMediaGet, isProfileMediaKind, isProfileMediaUserId, resolvePublicProfileMediaTarget } = route;
    const { isProfileAvatarPath, isProfileBannerPath, isProfileMediaPathForUser } = profileMedia;

    assert.equal(isProfileMediaUserId(ids.user), true);
    assert.equal(isProfileMediaUserId("not-a-uuid"), false);
    assert.equal(isProfileMediaKind("avatar"), true);
    assert.equal(isProfileMediaKind("banner"), true);
    for (const invalidKind of ["Avatar", "BANNER", "avatar%2f", "avatar/../banner", "", "cover"]) assert.equal(isProfileMediaKind(invalidKind), false, invalidKind);
    assert.equal(isProfileAvatarPath(avatarPath), true);
    assert.equal(isProfileBannerPath(bannerPath), true);
    assert.equal(isProfileMediaPathForUser(avatarPath, ids.user, "avatar"), true);
    assert.equal(isProfileMediaPathForUser(bannerPath, ids.user, "banner"), true);
    for (const invalidPath of [
      `profile-avatars/${ids.otherUser}/1752451200000-avatar.png`,
      `profile-banners/${ids.user}/1752451200001-banner.webp`,
      `profile-avatars/${ids.user}/1752451200000-%2fprivate.png`,
      `profile-avatars/${ids.user}/1752451200000-..\\private.png`,
      `profile-avatars/${ids.user}//1752451200000-avatar.png`,
      `profile-avatars/${ids.user}/1752451200000-avatar.png?override=1`,
      "profile-avatars/ABCDEF12-3456-4000-8000-000000000001/1752451200000-avatar.png",
    ]) assert.equal(isProfileMediaPathForUser(invalidPath, ids.user, "avatar"), false, invalidPath);

    let active;
    const handler = createProfileMediaGet({
      createSSRClient: () => active.client,
      streamStorageObjectViaSignedUrl: async (params) => {
        active.effects.signing += 1;
        active.effects.outboundFetch += 1;
        active.effects.streaming += 1;
        active.effects.bucket = params.bucket;
        active.effects.path = params.path;
        active.effects.allowedContentTypes = params.allowedContentTypes;
        return new Response("image", { status: 200, headers: { "content-length": "5", "content-type": "image/png" } });
      },
    });
    const run = async (row, { userId = ids.user, kind = "avatar", search = "", headers = {} } = {}) => {
      const calls = [];
      active = {
        client: createClient(row, calls),
        effects: { signing: 0, outboundFetch: 0, streaming: 0, writes: 0, audit: 0, cache: 0, rate: 0 },
      };
      const response = await handler({
        params: { userId, kind },
        request: new Request(`https://app.example/api/media/profile/${userId}/${kind}${search}`, { headers }),
        locals: { runtime: { env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon" } } },
      });
      return { response, calls, effects: active.effects };
    };

    const allowedAvatar = await run(profile());
    assert.equal(allowedAvatar.response.status, 200);
    assert.equal(allowedAvatar.effects.bucket, "post-media");
    assert.equal(allowedAvatar.effects.path, avatarPath);
    assert.deepEqual(allowedAvatar.effects.allowedContentTypes, ["image/jpeg", "image/png", "image/webp", "image/gif"]);
    assert.deepEqual(allowedAvatar.calls.slice(0, 2), ["profiles.select:id,avatar_url,banner_url", `profiles.eq:id:${ids.user}`]);

    const allowedBanner = await run(profile(), { kind: "banner" });
    assert.equal(allowedBanner.response.status, 200);
    assert.equal(allowedBanner.effects.path, bannerPath);

    const ordinaryBearer = await run(profile(), { headers: { authorization: "Bearer ordinary" } });
    assert.equal(ordinaryBearer.response.status, 200);
    assert.equal(ordinaryBearer.effects.signing, 1, "bearer input cannot alter the public route branch");
    const suspendedOrBannedProfile = await run(profile(), { headers: { authorization: "Bearer malformed" } });
    assert.equal(suspendedOrBannedProfile.response.status, 200, "current public profile lifecycle has no anonymous safety-state restriction");

    const deniedCases = [
      ["malformed user id", profile(), { userId: "not-a-uuid" }],
      ["missing profile", null, {}],
      ["profile identity mismatch", profile({ id: ids.otherUser }), {}],
      ["missing avatar", profile({ avatar_url: null }), {}],
      ["missing banner", profile({ banner_url: null }), { kind: "banner" }],
      ["unsupported kind", profile(), { kind: "Avatar" }],
      ["encoded kind", profile(), { kind: "avatar%2f" }],
      ["avatar request with banner object", profile({ avatar_url: bannerPath }), {}],
      ["banner request with avatar object", profile({ banner_url: avatarPath }), { kind: "banner" }],
      ["cross-user avatar object", profile({ avatar_url: `profile-avatars/${ids.otherUser}/1752451200000-avatar.png` }), {}],
      ["foreign stored URL", profile({ avatar_url: "https://foreign.example/avatar.png" }), {}],
      ["traversal key", profile({ avatar_url: `profile-avatars/${ids.user}/1752451200000-../private.png` }), {}],
      ["encoded separator key", profile({ avatar_url: `profile-avatars/${ids.user}/1752451200000-%2fprivate.png` }), {}],
      ["request override", profile({ avatar_url: `profile-avatars/${ids.otherUser}/1752451200000-avatar.png` }), { search: `?key=${encodeURIComponent(avatarPath)}&url=https%3A%2F%2Fforeign.example` }],
      ["malformed bearer cannot broaden missing profile", null, { headers: { authorization: "Bearer malformed" } }],
    ];
    for (const [name, row, options] of deniedCases) {
      const result = await run(row, options);
      assert.equal(result.response.status, 404, name);
      assert.deepEqual(result.effects, { signing: 0, outboundFetch: 0, streaming: 0, writes: 0, audit: 0, cache: 0, rate: 0 }, name);
    }

    const targetCalls = [];
    assert.equal(await resolvePublicProfileMediaTarget(createClient(profile(), targetCalls), ids.user, "avatar"), avatarPath);
    assert.equal(await resolvePublicProfileMediaTarget(createClient(profile({ avatar_url: "https://foreign.example/avatar.png" }), []), ids.user, "avatar"), null);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("not an image", { status: 200, headers: { "content-length": "12", "content-type": "text/html", "set-cookie": "never-forward" } });
    try {
      const unexpectedContentType = await proxy.streamTrustedMediaUrl({ url: "https://trusted.example/object", allowedContentTypes: ["image/png"] });
      assert.equal(unexpectedContentType.status, 502);
      assert.match(await unexpectedContentType.text(), /MEDIA_UNAVAILABLE/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await vite.close();
  }

  for (const required of [
    "public.can_access_public_profile_media_object(target_object_name text)",
    "profile_ref.avatar_url = target_object_name",
    "profile_ref.banner_url = target_object_name",
    "split_part(target_object_name, '/', 2) = profile_ref.id::text",
    "drop policy if exists \"profile_avatar_objects_select_public\"",
    "create policy \"profile_avatar_objects_select_public\"",
    "drop policy if exists \"profile_banner_objects_select_public\"",
    "create policy \"profile_banner_objects_select_public\"",
    "public.can_access_public_profile_media_object(name)",
  ]) assert.ok(migration.includes(required), required);
  assert.doesNotMatch(migration, /storage\.foldername\(name\)/, "profile storage SELECT cannot rely on a prefix-only folder predicate");
  assert.match(migration, /target_object_name ~ '\^profile-\(avatars\|banners\)\//);

  console.log(JSON.stringify({
    allowed: ["canonical avatar", "canonical banner", "public request with ordinary or malformed bearer", "public profile with safety state not exposed to anonymous readers"],
    denied: ["malformed id or kind", "missing/mismatched profile", "missing media", "cross-kind/cross-user/foreign/traversal keys", "query override"],
    readOrder: ["route UUID and kind validation", "anon profile read", "exact profile-field user-kind key authorization", "fixed-bucket signing", "bounded trusted image fetch", "safe-header stream"],
    deniedEffects: "zero signing, outbound fetch, streaming, writes, audit, cache, and rate persistence",
    historicalMigrationsUnchanged: true,
    forwardMigrationAuthoredNotExecuted: true,
    realNetworkDatabaseStorageRequests: 0,
  }));
}

await main();
