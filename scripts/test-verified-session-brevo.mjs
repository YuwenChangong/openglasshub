import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { sendFreshLoginCode } from "../src/lib/server/brevo-challenge.server.ts";
import { startChallenge, resendChallenge, verifyChallenge } from "../src/lib/server/login-challenge.server.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const secret = "local-signing-secret";
const env = {
  SUPABASE_URL: "https://local.supabase.test", SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "local-service", BREVO_API_KEY: "local-brevo-key",
  BREVO_VERIFIED_SENDER_EMAIL: "verified@example.test", OGH_LOGIN_CODE_PEPPER: "local-pepper",
};
const now = Math.floor(Date.now() / 1000);
const claims = {
  iss: `${env.SUPABASE_URL}/auth/v1`, aud: "authenticated", role: "authenticated",
  sub: userId, session_id: sessionId, exp: now + 3600, is_anonymous: false,
  amr: [{ method: "password", timestamp: now - 10 }], email: "jwt@example.test",
};
const provider = { id: userId, email: "current@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function tokenFor(payload = claims) {
  const input = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}
function harness({ reserve = "RESERVED", user = provider, authFailure = false, rpcFailure = false, finalize = true, consume = "VERIFIED", delivery = "accepted" } = {}) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, body, headers: new Headers(init.headers) });
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/auth/v1/user") return authFailure ? json({ message: "unavailable" }, 503) : json(user);
    if (url.pathname === "/rest/v1/rpc/ogh_reserve_login_challenge") return rpcFailure ? json({ message: "unavailable" }, 503) : json(reserve);
    if (url.pathname === "/rest/v1/rpc/ogh_finalize_login_delivery") return rpcFailure ? json({ message: "unavailable" }, 503) : json(finalize);
    if (url.pathname === "/rest/v1/rpc/ogh_consume_login_challenge") return rpcFailure ? json({ message: "unavailable" }, 503) : json(consume);
    throw new Error(`Unexpected local mock path: ${url.pathname}`);
  };
  const providerCalls = [];
  const send = async (url, init) => {
    providerCalls.push({ url, init });
    if (delivery === "network") throw new Error("offline");
    if (delivery === "timeout") return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    return new Response(null, { status: delivery === "accepted" ? 201 : delivery === "reject" ? 400 : 503 });
  };
  return { calls, providerCalls, send, restore: () => { globalThis.fetch = previous; } };
}
const options = { token: tokenFor(), ipHash: "local-ip-hash" };
let passed = 0;
async function test(name, setup, run) {
  const mock = harness(setup);
  try { await run(mock); passed++; console.log(`PASS ${name}`); }
  finally { mock.restore(); }
}
const errorCode = (code) => (error) => error?.code === code;

await test("BREVO_DEFINITE_2XX", {}, async ({ send, providerCalls }) => {
  await sendFreshLoginCode({ to: provider.email, code: "123456", requestId: "req-local" }, env, send);
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(providerCalls[0].init.method, "POST");
  assert.equal(providerCalls[0].init.headers["api-key"], env.BREVO_API_KEY);
  assert.deepEqual(JSON.parse(providerCalls[0].init.body).to, [{ email: provider.email }]);
  assert.deepEqual(JSON.parse(providerCalls[0].init.body).sender, { email: env.BREVO_VERIFIED_SENDER_EMAIL });
  assert.match(JSON.parse(providerCalls[0].init.body).htmlContent, /123456/);
  assert.ok(providerCalls[0].init.signal);
});
for (const [name, config] of Object.entries({ MISSING_KEY: { BREVO_API_KEY: undefined }, MISSING_SENDER: { BREVO_VERIFIED_SENDER_EMAIL: undefined } })) {
  await test(name, {}, async ({ send, providerCalls }) => {
    await assert.rejects(sendFreshLoginCode({ to: provider.email, code: "123456", requestId: "req-local" }, { ...env, ...config }, send), errorCode("VERIFICATION_SERVICE_UNAVAILABLE"));
    assert.equal(providerCalls.length, 0);
  });
}
for (const delivery of ["timeout", "network", "reject", "server"]) {
  await test(`BREVO_${delivery.toUpperCase()}_UNUSABLE`, { delivery }, async ({ send, providerCalls }) => {
    await assert.rejects(startChallenge(options, env, send), errorCode("VERIFICATION_SERVICE_UNAVAILABLE"));
    assert.equal(providerCalls.length, 1);
  });
}
await test("START_CURRENT_PROVIDER_EMAIL_ONLY", {}, async ({ calls, providerCalls, send }) => {
  const result = await startChallenge({ ...options, body: {} }, env, send);
  assert.equal(result.status, "SENT");
  assert.match(result.challengeId, /^[0-9a-f-]{36}$/i);
  assert.equal(providerCalls.length, 1);
  assert.deepEqual(JSON.parse(providerCalls[0].init.body).to, [{ email: provider.email }]);
  const reserve = calls.find((call) => call.path.endsWith("ogh_reserve_login_challenge"));
  const finalize = calls.find((call) => call.path.endsWith("ogh_finalize_login_delivery"));
  assert.equal(reserve.body.p_user_id, userId);
  assert.equal(reserve.body.p_session_id, sessionId);
  assert.equal(reserve.body.p_resend, false);
  assert.equal(reserve.body.p_ip_hash, options.ipHash);
  assert.match(reserve.body.p_digest, /^\\x[0-9a-f]{64}$/);
  const sentCode = JSON.parse(providerCalls[0].init.body).htmlContent.match(/<strong>(\d{6})<\/strong>/)?.[1];
  assert.ok(sentCode);
  assert.equal(reserve.body.p_digest, `\\x${createHmac("sha256", env.OGH_LOGIN_CODE_PEPPER)
    .update(JSON.stringify([result.challengeId, userId, sessionId, sentCode])).digest("hex")}`);
  assert.equal(finalize.body.p_accepted, true);
  assert.equal(calls.filter((call) => call.path === "/auth/v1/user").length >= 1, true);
  assert.ok(calls.findIndex((call) => call.path.endsWith("ogh_reserve_login_challenge")) < calls.findLastIndex((call) => call.path === "/auth/v1/user"));
});
for (const [name, setup, input, code] of [
  ["SESSION_GONE", { reserve: "SESSION_GONE" }, options, "INVALID_AUTH"],
  ["DUPLICATE_START", { reserve: "PENDING" }, options, null],
  ["QUOTA", { reserve: "EMAIL_BUDGET_EXHAUSTED" }, options, "EMAIL_BUDGET_EXHAUSTED"],
  ["NO_PASSWORD_AMR", {}, { ...options, token: tokenFor({ ...claims, amr: [{ method: "otp" }] }) }, "INVALID_AUTH"],
  ["GET_USER_FAILURE", { authFailure: true }, options, "INVALID_AUTH"],
  ["UNKNOWN_ACCOUNT", { user: null }, options, "INVALID_AUTH"],
  ["ID_MISMATCH", { user: { ...provider, id: sessionId } }, options, "INVALID_AUTH"],
  ["MISSING_EMAIL", { user: { ...provider, email: undefined } }, options, "INVALID_AUTH"],
  ["UNCONFIRMED_EMAIL", { user: { ...provider, email_confirmed_at: undefined } }, options, "INVALID_AUTH"],
  ["HOSTILE_BODY_EMAIL", {}, { ...options, body: { email: "attacker@example.test" } }, "INVALID_REQUEST"],
]) {
  await test(name, setup, async ({ send, providerCalls, calls }) => {
    if (code) await assert.rejects(startChallenge(input, env, send), errorCode(code));
    else assert.equal((await startChallenge(input, env, send)).status, "PENDING");
    assert.equal(providerCalls.length, 0);
    if (name === "SESSION_GONE") assert.equal(calls.filter((call) => call.path === "/auth/v1/user").length, 1);
    if (["ID_MISMATCH", "MISSING_EMAIL", "UNCONFIRMED_EMAIL"].includes(name)) {
      assert.equal(calls.find((call) => call.path.endsWith("ogh_finalize_login_delivery")).body.p_accepted, false);
    }
  });
}
await test("MISSING_PEPPER", {}, async ({ send, providerCalls, calls }) => {
  await assert.rejects(startChallenge(options, { ...env, OGH_LOGIN_CODE_PEPPER: undefined }, send), errorCode("VERIFICATION_SERVICE_UNAVAILABLE"));
  assert.equal(providerCalls.length, 0);
  assert.equal(calls.some((call) => call.path.endsWith("ogh_reserve_login_challenge")), false);
});
await test("MISSING_SERVICE_KEY", {}, async ({ send, providerCalls, calls }) => {
  await assert.rejects(startChallenge(options, { ...env, SUPABASE_SERVICE_ROLE_KEY: undefined }, send), errorCode("VERIFICATION_SERVICE_UNAVAILABLE"));
  assert.equal(providerCalls.length, 0);
  assert.equal(calls.some((call) => call.path.endsWith("ogh_reserve_login_challenge")), false);
});
await test("DATABASE_FAILURE", { rpcFailure: true }, async ({ send, providerCalls }) => {
  await assert.rejects(startChallenge(options, env, send), errorCode("VERIFICATION_SERVICE_UNAVAILABLE"));
  assert.equal(providerCalls.length, 0);
});
await test("RESEND_COOLDOWN", { reserve: "RESEND_COOLDOWN" }, async ({ send, providerCalls, calls }) => {
  await assert.rejects(resendChallenge(options, env, send), errorCode("RESEND_COOLDOWN"));
  assert.equal(providerCalls.length, 0);
  assert.equal(calls.find((call) => call.path.endsWith("ogh_reserve_login_challenge")).body.p_resend, true);
});
await test("RESEND_SUCCESS", {}, async ({ send, providerCalls }) => {
  assert.equal((await resendChallenge(options, env, send)).status, "SENT");
  assert.equal(providerCalls.length, 1);
});
await test("FINALIZE_FAILURE_NEVER_SUCCESS", { finalize: false }, async ({ send }) => {
  await assert.rejects(startChallenge(options, env, send), errorCode("VERIFICATION_SERVICE_UNAVAILABLE"));
});
await test("VERIFY_ATOMIC_RPC", {}, async ({ calls }) => {
  assert.deepEqual(await verifyChallenge({ token: options.token, challengeId: "33333333-3333-4333-8333-333333333333", code: "123456" }, env), { status: "VERIFIED" });
  const call = calls.find((item) => item.path.endsWith("ogh_consume_login_challenge"));
  assert.equal(call.body.p_user_id, userId);
  assert.equal(call.body.p_session_id, sessionId);
  assert.match(call.body.p_digest, /^\\x[0-9a-f]{64}$/);
});
for (const result of ["CHALLENGE_INVALID", "CHALLENGE_EXPIRED", "CHALLENGE_SUPERSEDED", "CHALLENGE_EXHAUSTED", "SESSION_GONE"]) {
  await test(`VERIFY_${result}`, { consume: result }, async () => {
    await assert.rejects(verifyChallenge({ token: options.token, challengeId: "33333333-3333-4333-8333-333333333333", code: "123456" }, env), errorCode(result));
  });
}
console.log(JSON.stringify({ passed }));
