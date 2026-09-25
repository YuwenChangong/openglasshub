import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.(?:ts|tsx|js|mjs)$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });

const { consumeVerificationEmailResendLimit } = await import("../src/lib/server/consume-verification-email-resend-limit.server.ts");
const hash = "a".repeat(64);
const env = { SUPABASE_URL: "https://local.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "local-service" };
let calls = 0;
const client = { rpc: async (name, args) => {
  calls++;
  assert.equal(name, "consume_verification_email_resend_limit");
  assert.deepEqual(args, { input_ip_hash: hash, max_attempts: 5, window_hours: 24 });
  return { data: [{ allowed: true, attempts: 1 }], error: null };
} };
assert.deepEqual(await consumeVerificationEmailResendLimit(env, hash, { createClient: () => client }), { allowed: true, reason: "ALLOWED" });
assert.deepEqual(await consumeVerificationEmailResendLimit(env, "invalid", { createClient: () => client }), { allowed: false, reason: "RATE_LIMIT_SERVICE_UNAVAILABLE" });
assert.equal(calls, 1, "invalid hash never reaches the privileged RPC");
const denied = await consumeVerificationEmailResendLimit(env, hash, { createClient: () => ({ rpc: async () => ({ data: [{ allowed: false, attempts: 5 }], error: null }) }) });
assert.deepEqual(denied, { allowed: false, reason: "RATE_LIMITED" });
for (const data of [null, [], [{ allowed: "true" }], [{ allowed: true }, { allowed: true }]]) {
  assert.equal((await consumeVerificationEmailResendLimit(env, hash, { createClient: () => ({ rpc: async () => ({ data, error: null }) }) })).allowed, false);
}
const failed = await consumeVerificationEmailResendLimit(env, hash, { createClient: () => ({ rpc: async () => { throw new Error("local DB error"); } }) });
assert.deepEqual(failed, { allowed: false, reason: "RATE_LIMIT_SERVICE_UNAVAILABLE" });
let aborted = false;
const timedOut = await consumeVerificationEmailResendLimit(env, hash, {
  timeoutMs: 20,
  createClient: (_env, signal) => {
    signal.addEventListener("abort", () => { aborted = true; });
    return { rpc: () => new Promise(() => {}) };
  },
});
assert.deepEqual(timedOut, { allowed: false, reason: "RATE_LIMIT_SERVICE_UNAVAILABLE" });
assert.equal(aborted, true, "timeout aborts the RPC transport");
console.log("PASS verification resend helper: fixed policy, hash validation, bounded fail-closed RPC");
