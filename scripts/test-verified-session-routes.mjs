import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: "data:text/javascript,export const env = globalThis.__routeTestEnv", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const env = { SUPABASE_URL: "https://local.supabase.test", SUPABASE_ANON_KEY: "local-anon" };
globalThis.__routeTestEnv = env;
const { GET, ALL } = await import("../src/pages/api/auth/session-state.ts");
const { requireModerator } = await import("../src/lib/server/admin-auth.ts");
const { requireForumUser } = await import("../src/lib/server/circle-management.ts");
const { requireVerifiedLegalConsentMutation } = await import("../src/lib/server/legal-consent-mutation.server.ts");

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
function fixture({ verified = false, policy = false, policyStatus = 200, rpcStatus = 200, authStatus = 200, secondAuthStatus = 200, secondAuthNetworkFailure = false, secondUserId = userId, profileRole = "moderator" } = {}) {
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
      if (status !== 200) return response({ message: "local auth failure" }, status);
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
await check("PENDING_POLICY_REQUIRED", { verified: false }, `Bearer ${token}`, { status: 200, body: { state: "PENDING_VERIFICATION", policy: "NEEDS_ACCEPTANCE" } }, ["/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/rpc/ogh_has_current_policy_acceptance"]);
await check("PENDING_POLICY_CURRENT", { verified: false, policy: true }, `Bearer ${token}`, { status: 200, body: { state: "PENDING_VERIFICATION", policy: "CURRENT" } }, ["/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/rpc/ogh_has_current_policy_acceptance"]);
await check("VERIFIED_POLICY_REQUIRED", { verified: true }, `Bearer ${token}`, { status: 200, body: { state: "VERIFIED_AUTHENTICATED", policy: "NEEDS_ACCEPTANCE" } }, ["/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/rpc/ogh_has_current_policy_acceptance"]);
await check("VERIFIED_POLICY_CURRENT", { verified: true, policy: true }, `Bearer ${token}`, { status: 200, body: { state: "VERIFIED_AUTHENTICATED", policy: "CURRENT" } }, ["/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/rpc/ogh_has_current_policy_acceptance"]);
await check("PENDING_POLICY_UNAVAILABLE", { verified: false, policyStatus: 503 }, `Bearer ${token}`, { status: 200, body: { state: "PENDING_VERIFICATION", policy: "UNAVAILABLE" } }, ["/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/rpc/ogh_has_current_policy_acceptance"]);
await check("VERIFICATION_DB_UNAVAILABLE", { rpcStatus: 503 }, `Bearer ${token}`, { status: 503, body: { error: "VERIFICATION_SERVICE_UNAVAILABLE" } }, ["/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session"]);
await check("AUTH_UNAVAILABLE", { authStatus: 503 }, `Bearer ${token}`, { status: 503, body: { error: "VERIFICATION_SERVICE_UNAVAILABLE" } }, ["/auth/v1/user"]);
assert.equal((await ALL()).status, 405);

for (const [name, guard] of [["MODERATOR", requireModerator], ["FORUM_USER", requireForumUser]]) {
  const test = fixture({ verified: false });
  try {
    const error = await guard(request(`Bearer ${token}`), env).then(() => null, (failure) => failure);
    assert.equal(error.status, 403, name);
    assert.deepEqual(await error.json(), { error: "VERIFICATION_REQUIRED" }, name);
    assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session"], name);
    console.log(`PASS ${name}_PENDING_NO_PROFILE`);
  } finally { test.restore(); }
}
{
  const test = fixture({ verified: true, profileRole: "moderator" });
  try {
    const auth = await requireModerator(request(`Bearer ${token}`), env);
    assert.equal(auth.user.id, userId);
    assert.equal(auth.profile.role, "moderator");
    assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/profiles"]);
    console.log("PASS VERIFIED_MODERATOR");
  } finally { test.restore(); }
}
{
  const test = fixture({ verified: true, profileRole: "member" });
  try {
    const auth = await requireForumUser(request(`Bearer ${token}`), env);
    assert.equal(auth.user.id, userId);
    assert.equal(auth.profile.role, "member");
    assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/auth/v1/user", "/rest/v1/profiles"]);
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
    assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/auth/v1/user"], name);
    console.log(`PASS ${name}`);
  } finally { test.restore(); }
}
{
  const test = fixture({ verified: true, profileRole: "member" });
  try {
    await assert.rejects(requireModerator(request(`Bearer ${token}`), env), (error) => error.status === 403);
    assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/profiles"]);
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
    assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session"]);
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
    assert.deepEqual(test.calls.map((call) => call.path), ["/auth/v1/user", "/rest/v1/rpc/ogh_is_verified_session", "/rest/v1/rpc/ogh_has_current_policy_acceptance"], name);
    console.log(`PASS ${name}_GUARD`);
  } finally { test.restore(); }
}
console.log("VERIFIED_SESSION_ROUTES_OK");
