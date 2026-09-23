import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { getTrustedSessionClaims, getCurrentConfirmedAuthUser, requireVerifiedSession } from "../src/lib/server/verified-session.server.ts";

const secret = "disposable-local-signing-secret";
const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const env = { SUPABASE_URL: "https://local.supabase.test", SUPABASE_ANON_KEY: "local-anon" };
const now = Math.floor(Date.now() / 1000);
const base = {
  iss: `${env.SUPABASE_URL}/auth/v1`, aud: "authenticated", role: "authenticated",
  sub: userId, session_id: sessionId, exp: now + 3600, nbf: now - 1,
  is_anonymous: false, amr: [{ method: "password", timestamp: now - 10 }],
  email: "jwt-attacker@example.test", user_metadata: { verified: true, role: "admin" },
};
const provider = { id: userId, email: "current@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function sign(payload) {
  const input = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}
function validSignature(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  return parts[2] === expected;
}
function harness({ user = provider, rpc = true, authFailure = false } = {}) {
  const calls = [];
  const prior = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const token = new Headers(init.headers).get("authorization")?.replace(/^Bearer /, "");
    calls.push({ path: url.pathname, token, body: init.body });
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/auth/v1/user") {
      if (authFailure || !token || !validSignature(token)) return json({ message: "invalid token" }, 401);
      return json(user ?? { message: "no user" }, user ? 200 : 401);
    }
    if (url.pathname === "/rest/v1/rpc/ogh_is_verified_session") {
      if (rpc === "unavailable") return json({ message: "unavailable" }, 503);
      return json(rpc);
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  };
  return { calls, restore: () => { globalThis.fetch = prior; } };
}
let count = 0;
async function test(name, fn) {
  const mock = harness();
  try { await fn(mock); count++; console.log(`PASS ${name}`); }
  finally { mock.restore(); }
}
async function rejected(name, payload) {
  await test(name, async () => {
    await assert.rejects(getTrustedSessionClaims(sign(payload), env));
    console.log(`${name}=REJECTED`);
  });
}

await test("SIGNED_VALID", async () => {
  assert.deepEqual(await getTrustedSessionClaims(sign(base), env), {
    userId, sessionId, amr: base.amr, expiresAt: base.exp,
  });
});
await test("SIGNED_AUDIENCE_ARRAY", async () => {
  assert.equal((await getTrustedSessionClaims(sign({ ...base, aud: ["authenticated", "other"] }), env)).userId, userId);
});
await test("TAMPERED_SIGNATURE", async () => {
  const token = sign(base);
  const parts = token.split(".");
  parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  await assert.rejects(getTrustedSessionClaims(parts.join("."), env));
});
await test("FORGED_SESSION", async () => {
  const token = sign(base);
  const parts = token.split(".");
  parts[1] = encode({ ...base, session_id: "33333333-3333-4333-8333-333333333333" });
  await assert.rejects(getTrustedSessionClaims(parts.join("."), env));
});
await test("FORGED_AMR", async () => {
  const token = sign({ ...base, amr: [{ method: "otp" }] });
  const parts = token.split(".");
  parts[1] = encode({ ...base, amr: [{ method: "password" }] });
  await assert.rejects(getTrustedSessionClaims(parts.join("."), env));
});
const negatives = {
  WRONG_ISSUER: { iss: "https://other.test/auth/v1" },
  WRONG_AUDIENCE: { aud: "anon" },
  WRONG_ROLE: { role: "service_role" },
  MISSING_SESSION_ID: { session_id: undefined },
  MALFORMED_SUB: { sub: "not-a-uuid" },
  MALFORMED_SESSION_ID: { session_id: "not-a-uuid" },
  ANONYMOUS_TOKEN: { is_anonymous: true },
  FUTURE_NBF: { nbf: now + 3600 },
  EXPIRED_TOKEN: { exp: now - 1 },
  MISSING_ANONYMOUS_FLAG: { is_anonymous: undefined },
  MALFORMED_NBF: { nbf: "tomorrow" },
  MISSING_AMR: { amr: undefined },
  MALFORMED_AMR: { amr: [{ method: "" }] },
  MALFORMED_AMR_TIMESTAMP: { amr: [{ method: "password", timestamp: "bad" }] },
};
for (const [name, fields] of Object.entries(negatives)) await rejected(name, { ...base, ...fields });
await test("USER_METADATA_AUTHZ_EFFECT", async () => {
  const a = await getTrustedSessionClaims(sign({ ...base, user_metadata: { verified: false } }), env);
  const b = await getTrustedSessionClaims(sign({ ...base, user_metadata: { verified: true, role: "admin" } }), env);
  assert.deepEqual(a, b);
  console.log("USER_METADATA_AUTHZ_EFFECT=NONE");
});
await test("CURRENT_CONFIRMED_PROVIDER_EMAIL", async () => {
  const claims = await getTrustedSessionClaims(sign(base), env);
  assert.deepEqual(await getCurrentConfirmedAuthUser(sign(base), env, claims), { id: userId, email: provider.email });
});
await test("REQUEST_AND_JWT_EMAIL_IGNORED", async (mock) => {
  const token = sign({ ...base, email: "jwt-attacker@example.test" });
  const claims = await getTrustedSessionClaims(token, env);
  const request = new Request("https://app.test/api/auth/challenge", { method: "POST", body: JSON.stringify({ email: "body-attacker@example.test" }), headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual(await getCurrentConfirmedAuthUser(token, env, claims), { id: userId, email: provider.email });
  assert.equal((await requireVerifiedSession(request, env)).claims.userId, userId);
  assert.equal(mock.calls.find((call) => call.path === "/rest/v1/rpc/ogh_is_verified_session")?.token, token);
});
for (const [name, user] of Object.entries({
  ID_MISMATCH: { ...provider, id: sessionId },
  UNCONFIRMED_EMAIL: { ...provider, email_confirmed_at: undefined, confirmed_at: "2026-01-01T00:00:00Z" },
  MISSING_EMAIL: { ...provider, email: undefined },
  BAD_CONFIRMATION_DATE: { ...provider, email_confirmed_at: "not-a-date" },
})) {
  const mock = harness({ user });
  try { await assert.rejects(getCurrentConfirmedAuthUser(sign(base), env, { userId, sessionId, amr: base.amr, expiresAt: base.exp })); count++; console.log(`PASS ${name}`); }
  finally { mock.restore(); }
}
{
  const mock = harness({ authFailure: true });
  try { await assert.rejects(getCurrentConfirmedAuthUser(sign(base), env, { userId, sessionId, amr: base.amr, expiresAt: base.exp })); count++; console.log("PASS GET_USER_FAILURE"); }
  finally { mock.restore(); }
}
{
  const mock = harness({ authFailure: true });
  try { await assert.rejects(getTrustedSessionClaims(sign(base), env)); count++; console.log("PASS GET_CLAIMS_FAILURE"); }
  finally { mock.restore(); }
}
for (const [name, rpc, status] of [["PENDING", false, 403], ["DB_UNAVAILABLE", "unavailable", 503], ["STALE", null, 503]]) {
  const mock = harness({ rpc });
  try {
    const request = new Request("https://app.test/protected", { headers: { authorization: `Bearer ${sign(base)}` } });
    await assert.rejects(requireVerifiedSession(request, env), (error) => error instanceof Response && error.status === status);
    assert.equal(mock.calls.filter((call) => call.path === "/rest/v1/rpc/ogh_is_verified_session").length, 1);
    count++; console.log(`PASS ${name}`);
  } finally { mock.restore(); }
}
await test("MISSING_BEARER", async () => {
  await assert.rejects(requireVerifiedSession(new Request("https://app.test/protected"), env), (error) => error instanceof Response && error.status === 401);
});
console.log(JSON.stringify({ passed: count }));
