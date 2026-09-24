import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: "data:text/javascript,export const env = globalThis.__routeTestEnv", shortCircuit: true };
    }
    if (process.env.VERIFIED_SESSION_ROUTE_TEST_MUTATION === "missing-start-export" && specifier.endsWith("/login-challenge/start.ts")) {
      return { url: "data:text/javascript,export const prerender=false", shortCircuit: true };
    }
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.(?:ts|tsx|js|mjs|json)$/i.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const env = { SUPABASE_URL: "https://local.supabase.test", SUPABASE_ANON_KEY: "local-anon" };
globalThis.__routeTestEnv = env;
const { GET, ALL } = await import("../src/pages/api/auth/session-state.ts");
const { requireModerator } = await import("../src/lib/server/admin-auth.ts");
const { requireForumUser } = await import("../src/lib/server/circle-management.ts");
const { requireVerifiedLegalConsentMutation } = await import("../src/lib/server/legal-consent-mutation.server.ts");
const { requireVerifiedSession } = await import("../src/lib/server/verified-session.server.ts");

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const secret = "local-test-signing-secret";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const claims = {
  iss: `${env.SUPABASE_URL}/auth/v1`, aud: "authenticated", role: "authenticated",
  sub: userId, session_id: sessionId, exp: Math.floor(Date.now() / 1000) + 3600,
  is_anonymous: false, amr: [{ method: "password" }],
};
function sign(payload = claims) {
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
function validToken(token) {
  const parts = token?.split(".") ?? [];
  return parts.length === 3 &&
    createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest("base64url") === parts[2];
}
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
function fixture({ verified = false, policy = false, policyStatus = 200, rpcStatus = 200, authStatus = 200, secondAuthStatus = 200, secondAuthNetworkFailure = false, secondUserId = userId, profileRole = "moderator", publicCommentRead = false } = {}) {
  const calls = [];
  let authCalls = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const token = new Headers(init.headers).get("authorization")?.replace(/^Bearer /, "");
    calls.push({ path: url.pathname, token, body: init.body });
    if (url.pathname === "/auth/v1/user") {
      authCalls++;
      if (authCalls === 2 && secondAuthNetworkFailure) throw new Error("offline test transport failure");
      const status = authCalls === 2 ? secondAuthStatus : authStatus;
      if (status !== 200) return response(status === 400 && authCalls === 2 ? { message: "session gone", error_code: "session_not_found" } : { message: "local auth failure" }, status);
      return validToken(token) ? response({ id: authCalls === 2 ? secondUserId : userId, email: "local@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" }) : response({ message: "invalid" }, 401);
    }
    if (url.pathname === "/rest/v1/rpc/ogh_is_verified_session") {
      return rpcStatus === 200 ? response(verified) : response({ message: "unavailable" }, rpcStatus);
    }
    if (url.pathname === "/rest/v1/rpc/ogh_has_current_policy_acceptance") {
      assert.deepEqual(JSON.parse(init.body), { p_bundle: "2026-07", p_terms: "2026-07", p_privacy: "2026-07", p_guidelines: "2026-07" });
      return policyStatus === 200 ? response(policy) : response({ message: "unavailable" }, policyStatus);
    }
    if (url.pathname === "/rest/v1/profiles") return response(profileRole ? [{ id: userId, role: profileRole, username: "local", display_name: "Local", avatar_url: null }] : []);
    if (url.pathname === "/rest/v1/posts" && publicCommentRead) return response({ id: userId, circle_id: sessionId, status: "published", moderation_status: "published" });
    if (url.pathname === "/rest/v1/circles") return response(publicCommentRead && url.searchParams.has("id") ? { id: sessionId, slug: "local", name: "Local", status: "active" } : []);
    if (url.pathname === "/rest/v1/comments" && publicCommentRead) return response([]);
    if (url.pathname === "/rest/v1/rpc/ogh_record_policy_acceptance") return response(null);
    throw new Error(`Unexpected request ${url.pathname}`);
  };
  return { calls, restore: () => { globalThis.fetch = previous; } };
}
function request(authorization) {
  return new Request("https://app.test/api/auth/session-state", { headers: authorization ? { authorization } : {} });
}
async function check(name, options, authorization, expected, expectedPaths) {
  const test = fixture(options);
  try {
    const result = await GET({ request: request(authorization) });
    assert.equal(result.status, expected.status, name);
    assert.deepEqual(await result.json(), expected.body, name);
    assert.equal(result.headers.get("cache-control"), "no-store", name);
    assert.deepEqual(test.calls.map((call) => call.path), expectedPaths, name);
    assert.equal(result.headers.get("content-type")?.startsWith("application/json"), true, name);
    console.log(`PASS ${name}`);
  } finally { test.restore(); }
}
const token = sign();
await check("ANONYMOUS", {}, null, { status: 200, body: { state: "ANONYMOUS", policy: "UNAVAILABLE" } }, []);
await check("MALFORMED_BEARER", {}, "Bearer bad token", { status: 200, body: { state: "ANONYMOUS", policy: "UNAVAILABLE" } }, []);
await check("STALE_TOKEN", {}, `Bearer ${sign({ ...claims, exp: 1 })}`, { status: 200, body: { state: "ANONYMOUS", policy: "UNAVAILABLE" } }, []);
await check("INVALID_TOKEN", {}, "Bearer invalid", { status: 200, body: { state: "ANONYMOUS", policy: "UNAVAILABLE" } }, []);
await check("PENDING_POLICY_REQUIRED", { verified: false }, `Bearer ${token}`, { status: 200, body: { state: "PENDING_VERIFICATION", policy: "NEEDS_ACCEPTANCE" } }, ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/rpc/ogh_has_current_policy_acceptance"]);
await check("PENDING_POLICY_CURRENT", { verified: false, policy: true }, `Bearer ${token}`, { status: 200, body: { state: "PENDING_VERIFICATION", policy: "CURRENT" } }, ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/rpc/ogh_has_current_policy_acceptance"]);
await check("VERIFIED_POLICY_REQUIRED", { verified: true }, `Bearer ${token}`, { status: 200, body: { state: "VERIFIED_AUTHENTICATED", policy: "NEEDS_ACCEPTANCE" } }, ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/rpc/ogh_has_current_policy_acceptance"]);
await check("VERIFIED_POLICY_CURRENT", { verified: true, policy: true }, `Bearer ${token}`, { status: 200, body: { state: "VERIFIED_AUTHENTICATED", policy: "CURRENT" } }, ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/rpc/ogh_has_current_policy_acceptance"]);
await check("PENDING_POLICY_UNAVAILABLE", { verified: false, policyStatus: 503 }, `Bearer ${token}`, { status: 200, body: { state: "PENDING_VERIFICATION", policy: "UNAVAILABLE" } }, ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/rpc/ogh_has_current_policy_acceptance"]);
await check("VERIFICATION_DB_UNAVAILABLE", { rpcStatus: 503 }, `Bearer ${token}`, { status: 503, body: { error: "VERIFICATION_SERVICE_UNAVAILABLE" } }, ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session"]);
await check("AUTH_UNAVAILABLE", { authStatus: 503 }, `Bearer ${token}`, { status: 503, body: { error: "VERIFICATION_SERVICE_UNAVAILABLE" } }, ["/auth/v1/user"]);
await check("SIGNED_STALE_SESSION", { secondAuthStatus: 400 }, `Bearer ${token}`, { status: 200, body: { state: "ANONYMOUS", policy: "UNAVAILABLE" } }, ["/auth/v1/user", "/auth/v1/user"]);
await check("LIVE_PROVIDER_ID_MISMATCH", { secondUserId: sessionId }, `Bearer ${token}`, { status: 200, body: { state: "ANONYMOUS", policy: "UNAVAILABLE" } }, ["/auth/v1/user", "/auth/v1/user"]);
await check("LIVE_PROVIDER_OUTAGE", { secondAuthStatus: 503 }, `Bearer ${token}`, { status: 503, body: { error: "VERIFICATION_SERVICE_UNAVAILABLE" } }, ["/auth/v1/user", "/auth/v1/user"]);
assert.equal((await ALL()).status, 405);

for (const [name, options, status, code] of [
  ["GUARD_SIGNED_STALE", { secondAuthStatus: 400 }, 401, "INVALID_AUTH"],
  ["GUARD_PROVIDER_ID_MISMATCH", { secondUserId: sessionId }, 401, "INVALID_AUTH"],
  ["GUARD_PROVIDER_OUTAGE", { secondAuthStatus: 503 }, 503, "VERIFICATION_SERVICE_UNAVAILABLE"],
]) {
  const test = fixture({ verified: false, ...options });
  try {
    const error = await requireVerifiedSession(request(`Bearer ${token}`), env).then(() => null, (failure) => failure);
    assert.equal(error.status, status, name);
    assert.deepEqual(await error.json(), { error: code }, name);
    assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/auth/v1/user"], name);
    console.log(`PASS ${name}`);
  } finally { test.restore(); }
}

for (const [name, guard] of [["MODERATOR", requireModerator], ["FORUM_USER", requireForumUser]]) {
  const test = fixture({ verified: false });
  try {
    const error = await guard(request(`Bearer ${token}`), env).then(() => null, (failure) => failure);
    assert.equal(error.status, 403, name);
    assert.deepEqual(await error.json(), { error: "VERIFICATION_REQUIRED" }, name);
    assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session"], name);
    console.log(`PASS ${name}_PENDING_NO_PROFILE`);
  } finally { test.restore(); }
}
{
  const test = fixture({ verified: true, profileRole: "moderator" });
  try {
    const auth = await requireModerator(request(`Bearer ${token}`), env);
    assert.equal(auth.user.id, userId);
    assert.equal(auth.profile.role, "moderator");
    assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/profiles"]);
    console.log("PASS VERIFIED_MODERATOR");
  } finally { test.restore(); }
}
{
  const test = fixture({ verified: true, profileRole: "member" });
  try {
    const auth = await requireForumUser(request(`Bearer ${token}`), env);
    assert.equal(auth.user.id, userId);
    assert.equal(auth.profile.role, "member");
    assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/profiles"]);
    console.log("PASS VERIFIED_FORUM_USER");
  } finally { test.restore(); }
}
for (const [name, options, status, code] of [
  ["FORUM_SECOND_AUTH_503", { secondAuthStatus: 503 }, 503, "VERIFICATION_SERVICE_UNAVAILABLE"],
  ["FORUM_SECOND_AUTH_NETWORK", { secondAuthNetworkFailure: true }, 503, "VERIFICATION_SERVICE_UNAVAILABLE"],
  ["FORUM_SECOND_AUTH_401", { secondAuthStatus: 401 }, 401, "INVALID_AUTH"],
  ["FORUM_SECOND_AUTH_MISMATCH", { secondUserId: sessionId }, 401, "INVALID_AUTH"],
]) {
  const test = fixture({ verified: true, ...options });
  try {
    const error = await requireForumUser(request(`Bearer ${token}`), env).then(() => null, (failure) => failure);
    assert.equal(error.status, status, name);
    assert.deepEqual(await error.json(), { error: code }, name);
    assert.equal(error.headers.get("cache-control"), "no-store", name);
    assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/auth/v1/user"], name);
    console.log(`PASS ${name}`);
  } finally { test.restore(); }
}
{
  const test = fixture({ verified: true, profileRole: "member" });
  try {
    await assert.rejects(requireModerator(request(`Bearer ${token}`), env), (error) => error.status === 403);
    assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/profiles"]);
    console.log("PASS VERIFIED_ROLE_DENIAL");
  } finally { test.restore(); }
}
{
  const test = fixture({ verified: false });
  try {
    const result = await requireVerifiedLegalConsentMutation(request(`Bearer ${token}`), env);
    assert.equal(result.ok, false);
    assert.equal(result.response.status, 403);
    assert.deepEqual(await result.response.json(), { error: "VERIFICATION_REQUIRED" });
    assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session"]);
    console.log("PASS PENDING_NO_CONSENT_READ");
  } finally { test.restore(); }
}
for (const [name, policy, policyStatus, status] of [
  ["VERIFIED_POLICY_CURRENT", true, 200, 200],
  ["VERIFIED_POLICY_REQUIRED", false, 200, 403],
  ["VERIFIED_POLICY_UNAVAILABLE", false, 503, 503],
]) {
  const test = fixture({ verified: true, policy, policyStatus });
  try {
    const result = await requireVerifiedLegalConsentMutation(request(`Bearer ${token}`), env);
    assert.equal(result.ok, status === 200, name);
    if (!result.ok) assert.equal(result.response.status, status, name);
    assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/rpc/ogh_has_current_policy_acceptance"], name);
    console.log(`PASS ${name}_GUARD`);
  } finally { test.restore(); }
}
const protectedRoutes = [
  ["users/me/summary", "GET"], ["users/me/profile", "POST"],
  ["users/me/notifications", "GET PATCH"],
  ["forum/posts", "POST PATCH DELETE"],
  ["forum/posts", "GET", "?moderation_check=1"],
  ["forum/posts", "GET", `?ownership_check=${userId}`],
  ["forum/comments", "POST PUT DELETE"],
  ["forum/circles", "POST PATCH"], ["forum/reports", "POST"],
  ["forum/post-media", "POST"], ["forum/media-upload-guard", "POST"],
  ["forum/external-video-upload", "POST"],
  ["forum/circles/[slug]/posts", "GET PATCH DELETE"],
  ["forum/circles/[slug]/comments", "GET PATCH DELETE"],
  ["forum/circles/[slug]/manage", "GET PATCH DELETE"],
  ["admin/devices", "GET POST PATCH DELETE"], ["admin/news", "GET POST PATCH DELETE"],
  ["admin/reports", "GET"], ["admin/reports/[id]", "GET"],
  ["admin/reports/[id]/action", "POST"], ["admin/users", "GET"],
  ["admin/forum/me", "GET"], ["admin/forum/media", "GET DELETE"],
  ["admin/forum/posts", "GET PATCH DELETE"], ["admin/forum/reports", "GET"],
  ["admin/forum/circles", "GET POST PATCH"], ["admin/forum/circles/purge", "POST"],
  ["admin/moderation/approve", "POST"], ["admin/moderation/hide", "POST"],
  ["admin/moderation/reject", "POST"], ["admin/moderation/queue", "GET"],
  ["admin/moderation/lexicon-health", "GET"],
  ["admin/users/[id]/ban", "POST"], ["admin/users/[id]/unban", "POST"],
  ["admin/users/[id]/suspend", "POST"], ["admin/users/[id]/warn", "POST"],
  ["admin/users/[id]/clear-warning", "POST"], ["admin/users/[id]/safety", "GET"],
  ["admin/trusted-runtime/capability", "GET"],
];
const verificationCalls = ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session"];
const routeFailures = [];
for (const [path, methods, suffix = ""] of protectedRoutes) {
  console.log(`CHECK ${path} ${methods}${suffix}`);
  const route = await import(`../src/pages/api/${path}.ts`);
  for (const method of methods.split(" ")) {
    const name = `${path} ${method}${suffix}`;
    const test = fixture({ verified: false });
    try {
      const result = await route[method]({
        request: new Request(`https://app.test/api/${path.replaceAll("[slug]", "local").replaceAll("[id]", userId)}${suffix}`, {
          method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          ...(["POST", "PUT", "PATCH"].includes(method) ? { body: "{}" } : {}),
        }),
        params: { slug: "local", id: userId }, locals: {},
      });
      assert.equal(result.status, 403, name);
      assert.deepEqual(await result.json(), { error: "VERIFICATION_REQUIRED" }, name);
      assert.equal(result.headers.get("cache-control"), "no-store", `${name}: cache policy`);
      assert.deepEqual(test.calls.map((call) => call.path), verificationCalls, `${name}: downstream call`);
      console.log(`PASS PENDING ${name}`);
    } catch (error) {
      routeFailures.push(`${name}: ${error.message}`);
    } finally { test.restore(); }
  }
}
assert.deepEqual(routeFailures, [], `Protected route failures:\n${routeFailures.join("\n")}`);
const { GET: publicCirclesGet } = await import("../src/pages/api/forum/circles.ts");
for (const [name, headers, expectedPaths] of [
  ["ANONYMOUS_PUBLIC_CIRCLES", {}, ["/rest/v1/circles"]],
  ["PENDING_PUBLIC_CIRCLES", { authorization: `Bearer ${token}` }, ["/rest/v1/circles"]],
]) {
  const test = fixture();
  try {
    const result = await publicCirclesGet({ request: new Request("https://app.test/api/forum/circles", { headers }), locals: {} });
    assert.equal(result.status, 200, name);
    assert.deepEqual((await result.json()).circles, [], name);
    assert.deepEqual(test.calls.map((call) => call.path), expectedPaths, name);
    assert.equal(test.calls[0].token, env.SUPABASE_ANON_KEY, `${name}: anon client`);
    console.log(`PASS ${name}`);
  } finally { test.restore(); }
}
const { GET: publicCommentsGet } = await import("../src/pages/api/forum/comments.ts");
const { GET: publicSearchGet } = await import("../src/pages/api/forum/search.ts");
for (const [path, handler, suffix, expectedBodyKey, expectedPublicPaths] of [
  ["comments", publicCommentsGet, `?post_id=${userId}`, "comments", ["/rest/v1/posts", "/rest/v1/circles", "/rest/v1/comments"]],
  ["search", publicSearchGet, "?q=local&type=circles", "results", ["/rest/v1/circles"]],
]) {
  for (const [name, headers, authPaths] of [
    ["ANONYMOUS", {}, []],
    ["PENDING", { authorization: `Bearer ${token}` }, path === "comments" ? verificationCalls : []],
  ]) {
    const test = fixture({ publicCommentRead: path === "comments" });
    try {
      const result = await handler({ request: new Request(`https://app.test/api/forum/${path}${suffix}`, { headers }), locals: {} });
      assert.equal(result.status, 200, `${name} PUBLIC ${path}`);
      assert.ok(expectedBodyKey in await result.json(), `${name} PUBLIC ${path}`);
      assert.deepEqual(test.calls.map((call) => call.path), [...authPaths, ...expectedPublicPaths], `${name} PUBLIC ${path}`);
      assert.ok(test.calls.slice(authPaths.length).every((call) => call.token === env.SUPABASE_ANON_KEY), `${name} PUBLIC ${path}: anon reads`);
      console.log(`PASS ${name}_PUBLIC_${path.toUpperCase()}`);
    } finally { test.restore(); }
  }
}
const { POST: legalConsentPost } = await import("../src/pages/api/legal/consent.ts");
env.SUPABASE_SERVICE_ROLE_KEY = "local-service";
try {
  for (const [name, authorization, options, expectedStatus, expectedPaths] of [
    ["FORGED", `Bearer ${token.slice(0, -1)}x`, {}, 401, ["/auth/v1/user"]],
    ["INVALID_SIGNED_CLAIMS", `Bearer ${sign({ ...claims, aud: "anon" })}`, {}, 401, ["/auth/v1/user"]],
    ["SIGNED_SUB_MISMATCH", `Bearer ${sign({ ...claims, sub: sessionId })}`, {}, 401, ["/auth/v1/user", "/auth/v1/user"]],
    ["LIVE_USER_MISMATCH", `Bearer ${token}`, { secondUserId: sessionId }, 401, ["/auth/v1/user", "/auth/v1/user"]],
    ["AUTH_OUTAGE", `Bearer ${token}`, { secondAuthStatus: 503 }, 503, ["/auth/v1/user", "/auth/v1/user"]],
  ]) {
    const test = fixture(options);
    try {
      const result = await legalConsentPost({ request: new Request("https://app.test/api/legal/consent", {
        method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ accepted: true, source: "login" }),
      }) });
      assert.equal(result.status, expectedStatus, name);
      assert.deepEqual(test.calls.map((call) => call.path), expectedPaths, name);
      assert.equal(test.calls.some((call) => call.path.includes("ogh_record_policy_acceptance")), false, name);
      console.log(`PASS LEGAL_${name}_NO_WRITER`);
    } finally { test.restore(); }
  }
  {
    const test = fixture();
    try {
      const result = await legalConsentPost({ request: new Request("https://app.test/api/legal/consent", {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ accepted: false, source: "login" }),
      }) });
      assert.equal(result.status, 400, "unchecked consent");
      assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/auth/v1/user"]);
      console.log("PASS LEGAL_UNCHECKED_NO_WRITER");
    } finally { test.restore(); }
  }
  const test = fixture({ verified: false });
  try {
    const result = await legalConsentPost({ request: new Request("https://app.test/api/legal/consent", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ accepted: true, source: "login" }),
    }) });
    assert.equal(result.status, 200, "pending consent bootstrap");
    assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/ogh_has_current_policy_acceptance", "/rest/v1/rpc/ogh_record_policy_acceptance"]);
    assert.deepEqual(JSON.parse(test.calls[2].body), { p_bundle: "2026-07", p_terms: "2026-07", p_privacy: "2026-07", p_guidelines: "2026-07" });
    assert.equal(test.calls.at(-1).token, env.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(JSON.parse(test.calls.at(-1).body).p_user_id, userId);
    assert.equal("p_minimum_age" in JSON.parse(test.calls.at(-1).body), false);
    console.log("PASS LEGAL_PENDING_ACTOR_BOUND_BOOTSTRAP");
  } finally { test.restore(); }
} finally { delete env.SUPABASE_SERVICE_ROLE_KEY; }
const { handleAdminCirclePurge } = await import("../src/lib/server/admin-circle-purge.server.ts");
const { handleTrustedAdminRuntimeCapability } = await import("../src/lib/server/supabase-admin.server.ts");
for (const [name, invoke] of [
  ["PURGE_HELPER", handleAdminCirclePurge],
  ["TRUSTED_RUNTIME_HELPER", handleTrustedAdminRuntimeCapability],
]) {
  const test = fixture({ verified: false });
  let clientCreations = 0;
  try {
    const result = await invoke(new Request("https://app.test/api/admin/probe", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ id: userId, action: "preview" }),
    }), env, { createAdminClient: () => { clientCreations++; throw new Error("privileged client constructed"); } });
    assert.equal(result.status, 403, name);
    assert.deepEqual(await result.json(), { error: "VERIFICATION_REQUIRED" }, name);
    assert.equal(clientCreations, 0, name);
    assert.deepEqual(test.calls.map((call) => call.path), verificationCalls, name);
    console.log(`PASS ${name}_PENDING_NO_ADMIN_CLIENT`);
  } finally { test.restore(); }
}
const { handleStart } = await import("../src/pages/api/auth/login-challenge/start.ts");
const { handleResend } = await import("../src/pages/api/auth/login-challenge/resend.ts");
const { handleVerify } = await import("../src/pages/api/auth/login-challenge/verify.ts");
const challengeEnv = { ...env, SUPABASE_SERVICE_ROLE_KEY: "local-service", OGH_LOGIN_CODE_PEPPER: "local-pepper", RATE_LIMIT_SALT: "local-ip-key", BREVO_API_KEY: "local-brevo", BREVO_VERIFIED_SENDER_EMAIL: "sender@example.test" };
const currentEmail = "current@example.test";
function challengeFixture({ reserve = "RESERVED", consume = "VERIFIED", authStatus = 200, authStatusOnCall = 0, provider = { id: userId, email: currentEmail, email_confirmed_at: "2026-01-01T00:00:00Z" }, rpcStatus = 200, delivery = 201, finalize = true } = {}) {
  const calls = [];
  const previous = globalThis.fetch;
  let authCalls = 0;
  let consumeCalls = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, body });
    if (url.pathname === "/auth/v1/user") {
      authCalls++;
      const status = authCalls === authStatusOnCall ? 503 : authStatus;
      return status === 200 ? response(provider) : response({ message: "auth failed" }, status);
    }
    if (url.pathname === "/rest/v1/rpc/ogh_reserve_login_challenge") return response(reserve, rpcStatus);
    if (url.pathname === "/rest/v1/rpc/ogh_finalize_login_delivery") {
      if (finalize === "lost-response") throw new Error("mocked lost acknowledgement");
      return response(finalize, rpcStatus);
    }
    if (url.pathname === "/rest/v1/rpc/ogh_consume_login_challenge") {
      consumeCalls++;
      return response(typeof consume === "function" ? consume(body, consumeCalls) : consume, rpcStatus);
    }
    throw new Error(`Unexpected mocked request ${url.pathname}`);
  };
  const sends = [];
  const send = async (url, init) => { sends.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: delivery }); };
  return { calls, sends, send, restore: () => { globalThis.fetch = previous; } };
}
const challengeRequest = (route, body = {}, auth = `Bearer ${token}`, headers = {}) => new Request(`https://app.test/api/auth/login-challenge/${route}`, {
  method: "POST", headers: { authorization: auth, "content-type": "application/json", "cf-connecting-ip": "192.0.2.10", ...headers }, body: JSON.stringify(body),
});
async function challengeCase(name, route, options, body, expectedStatus, expectedError, assertion) {
  const fixture = challengeFixture(options);
  try {
    const handler = route === "start" ? handleStart : route === "resend" ? handleResend : handleVerify;
    const result = await handler(challengeRequest(route, body), challengeEnv, fixture.send);
    assert.equal(result.status, expectedStatus, name);
    assert.equal(result.headers.get("cache-control"), "no-store", name);
    const payload = await result.json();
    if (expectedError) assert.deepEqual(payload, { error: expectedError }, name);
    await assertion?.(payload, fixture);
    console.log(`PASS CHALLENGE_${name}`);
  } finally { fixture.restore(); }
}
await challengeCase("START_PROVIDER_EMAIL", "start", {}, { next: "/me/" }, 200, null, (payload, f) => {
  assert.equal(payload.status, "SENT"); assert.match(payload.challengeId, /^[0-9a-f-]{36}$/i); assert.equal(payload.next, "/me/");
  assert.equal(f.sends.length, 1); assert.deepEqual(f.sends[0].body.to, [{ email: currentEmail }]);
  const hash = f.calls.find((c) => c.path.endsWith("ogh_reserve_login_challenge")).body.p_ip_hash;
  assert.equal(hash, createHmac("sha256", challengeEnv.RATE_LIMIT_SALT).update("ogh-login-challenge-ip-budget-v1\0" + "192.0.2.10").digest("hex"));
  assert.equal(f.calls.filter((c) => c.path.endsWith("ogh_finalize_login_delivery")).length, 1);
});
{
  const f = challengeFixture();
  try {
    const jwtEmail = "stale-jwt@example.test";
    const misleadingToken = sign({ ...claims, email: jwtEmail });
    const result = await handleStart(challengeRequest("start", {}, `Bearer ${misleadingToken}`), challengeEnv, f.send);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).status, "SENT");
    assert.equal(f.sends.length, 1);
    assert.deepEqual(f.sends[0].body.to, [{ email: currentEmail }]);
    assert.notEqual(f.sends[0].body.to[0].email, jwtEmail);
    console.log("PASS CHALLENGE_JWT_EMAIL_IGNORED_CURRENT_PROVIDER_RECIPIENT");
  } finally { f.restore(); }
}
for (const field of ["email", "userId", "sessionId", "amr", "confirmed", "ipHash"]) {
  await challengeCase(`BODY_${field}`, "start", {}, { [field]: "attacker" }, 400, "INVALID_REQUEST", (_, f) => {
    assert.equal(f.calls.length, 0); assert.equal(f.sends.length, 0);
  });
}
await challengeCase("UNSAFE_NEXT", "start", {}, { next: "https://evil.test/" }, 200, null, (payload) => assert.equal(payload.next, "/"));
{
  const f = challengeFixture();
  try {
    const request = challengeRequest("start");
    request.headers.delete("cf-connecting-ip");
    request.headers.set("x-forwarded-for", "192.0.2.10");
    const result = await handleStart(request, challengeEnv, f.send);
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { error: "VERIFICATION_SERVICE_UNAVAILABLE" });
    assert.equal(f.sends.length, 0);
    console.log("PASS CHALLENGE_MISSING_TRUSTED_IP");
  } finally { f.restore(); }
}
for (const [name, options, code] of [
  ["STALE", { reserve: "SESSION_GONE" }, "INVALID_AUTH"],
  ["QUOTA", { reserve: "EMAIL_BUDGET_EXHAUSTED" }, "EMAIL_BUDGET_EXHAUSTED"],
  ["PROVIDER_FAIL", { authStatusOnCall: 2 }, "VERIFICATION_SERVICE_UNAVAILABLE"],
  ["PROVIDER_MISMATCH", { provider: { id: sessionId, email: currentEmail, email_confirmed_at: "2026-01-01T00:00:00Z" } }, "INVALID_AUTH"],
  ["PROVIDER_UNCONFIRMED", { provider: { id: userId, email: currentEmail } }, "INVALID_AUTH"],
  ["PROVIDER_NO_EMAIL", { provider: { id: userId, email_confirmed_at: "2026-01-01T00:00:00Z" } }, "INVALID_AUTH"],
  ["DB_FAIL", { rpcStatus: 503 }, "VERIFICATION_SERVICE_UNAVAILABLE"],
  ["DELIVERY_AMBIGUOUS", { delivery: 503 }, "VERIFICATION_SERVICE_UNAVAILABLE"],
  ["FINALIZE_AMBIGUOUS", { finalize: "lost-response" }, "VERIFICATION_SERVICE_UNAVAILABLE"],
]) await challengeCase(name, "start", options, {}, code === "EMAIL_BUDGET_EXHAUSTED" ? 429 : code === "INVALID_AUTH" ? 401 : 503, code, (_, f) => {
  assert.equal(f.sends.length, name === "DELIVERY_AMBIGUOUS" || name === "FINALIZE_AMBIGUOUS" ? 1 : 0);
  if (name === "FINALIZE_AMBIGUOUS") assert.equal(f.calls.filter((c) => c.path.endsWith("ogh_finalize_login_delivery")).length, 1);
  if (name === "PROVIDER_FAIL") {
    const reserveAt = f.calls.findIndex((c) => c.path.endsWith("ogh_reserve_login_challenge"));
    const finalizeAt = f.calls.findIndex((c) => c.path.endsWith("ogh_finalize_login_delivery"));
    assert.ok(reserveAt >= 0 && finalizeAt > reserveAt);
    assert.equal(f.calls[finalizeAt].body.p_accepted, false);
    assert.equal(f.calls.filter((c) => c.path === "/auth/v1/user").length, 2);
  }
});
await challengeCase("DUPLICATE", "start", { reserve: "PENDING" }, {}, 200, null, (payload, f) => {
  assert.deepEqual(payload, { status: "PENDING", next: "/" }); assert.equal(f.sends.length, 0);
});
await challengeCase("COOLDOWN", "resend", { reserve: "RESEND_COOLDOWN" }, {}, 429, "RESEND_COOLDOWN", (_, f) => assert.equal(f.sends.length, 0));
await challengeCase("RESEND", "resend", {}, {}, 200, null, (payload, f) => {
  assert.equal(payload.status, "SENT"); assert.equal(f.sends.length, 1);
  assert.equal(f.calls.find((c) => c.path.endsWith("ogh_reserve_login_challenge")).body.p_resend, true);
});
await challengeCase("RESEND_BODY_EMAIL", "resend", {}, { email: "attacker@example.test" }, 400, "INVALID_REQUEST", (_, f) => {
  assert.equal(f.calls.length, 0); assert.equal(f.sends.length, 0);
});
const verifyBody = { challengeId: "33333333-3333-4333-8333-333333333333", code: "123456" };
await challengeCase("VERIFY", "verify", {}, { ...verifyBody, next: "/me/" }, 200, null, (payload, f) => {
  assert.deepEqual(payload, { status: "VERIFIED", next: "/me/" }); assert.equal(f.sends.length, 0);
});
{
  const f = challengeFixture({ consume: (_body, attempt) => attempt === 1 ? "VERIFIED" : "CHALLENGE_INVALID" });
  try {
    const first = await handleVerify(challengeRequest("verify", verifyBody), challengeEnv);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).status, "VERIFIED");
    const replay = await handleVerify(challengeRequest("verify", verifyBody), challengeEnv);
    assert.equal(replay.status, 400);
    assert.deepEqual(await replay.json(), { error: "CHALLENGE_INVALID" });
    assert.equal(f.calls.filter((call) => call.path.endsWith("ogh_consume_login_challenge")).length, 2);
    assert.equal(f.sends.length, 0);
    console.log("PASS CHALLENGE_VERIFY_REPLAY_DENIED_BY_SQL");
  } finally { f.restore(); }
}
{
  const otherSessionId = "44444444-4444-4444-8444-444444444444";
  const f = challengeFixture({ consume: (body) => body.p_session_id === sessionId ? "VERIFIED" : "CHALLENGE_INVALID" });
  try {
    const otherToken = sign({ ...claims, session_id: otherSessionId });
    const crossSession = await handleVerify(challengeRequest("verify", verifyBody, `Bearer ${otherToken}`), challengeEnv);
    assert.equal(crossSession.status, 400);
    assert.deepEqual(await crossSession.json(), { error: "CHALLENGE_INVALID" });
    const consumeCall = f.calls.find((call) => call.path.endsWith("ogh_consume_login_challenge"));
    assert.equal(consumeCall.body.p_session_id, otherSessionId);
    assert.equal(f.sends.length, 0);
    console.log("PASS CHALLENGE_VERIFY_CROSS_SESSION_DENIED_BY_SQL");
  } finally { f.restore(); }
}
for (const outcome of ["CHALLENGE_INVALID", "CHALLENGE_EXPIRED", "CHALLENGE_SUPERSEDED", "CHALLENGE_EXHAUSTED", "SESSION_GONE"]) {
  await challengeCase(`VERIFY_${outcome}`, "verify", { consume: outcome }, verifyBody, outcome === "SESSION_GONE" ? 401 : 400, outcome);
}
await challengeCase("VERIFY_BAD_CODE", "verify", {}, { ...verifyBody, code: "12345" }, 400, "CHALLENGE_INVALID", (_, f) => assert.equal(f.calls.some((c) => c.path.endsWith("ogh_consume_login_challenge")), false));
for (const [name, auth] of [["MISSING_BEARER", ""], ["FORGED_TOKEN", "Bearer forged.token.value"], ["NO_PASSWORD", `Bearer ${sign({ ...claims, amr: [{ method: "otp" }] })}`]]) {
  const f = challengeFixture();
  try {
    const result = await handleStart(challengeRequest("start", {}, auth), challengeEnv, f.send);
    assert.equal(result.status, 401, name);
    assert.deepEqual(await result.json(), { error: "INVALID_AUTH" }, name);
    assert.equal(f.sends.length, 0, name);
    console.log(`PASS CHALLENGE_${name}`);
  } finally { f.restore(); }
}
for (const body of [{ ...verifyBody, email: currentEmail }, { ...verifyBody, sessionId }, { ...verifyBody, code: "1234567" }]) {
  const f = challengeFixture();
  try {
    const result = await handleVerify(challengeRequest("verify", body), challengeEnv);
    assert.equal(result.status, 400);
    assert.equal(f.calls.some((c) => c.path.endsWith("ogh_consume_login_challenge")), false);
  } finally { f.restore(); }
}
console.log("PASS CHALLENGE_VERIFY_REJECTS_EXTRA_IDENTITY_AND_CODE");
console.log("VERIFIED_SESSION_ROUTES_OK");
