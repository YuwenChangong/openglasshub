import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env = globalThis.__resendTestEnv", shortCircuit: true };
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.(?:ts|tsx|js|mjs)$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });

const env = { SUPABASE_URL: "https://local.supabase.test", SUPABASE_ANON_KEY: "local-anon", SUPABASE_SERVICE_ROLE_KEY: "local-service", RATE_LIMIT_SALT: "local-only-salt" };
globalThis.__resendTestEnv = env;
const { POST } = await import("../src/pages/api/auth/resend-confirmation.ts");
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const expectedHash = (ip) => createHash("sha256").update(`${env.RATE_LIMIT_SALT}:${ip}`).digest("hex");

async function run({ body = { email: "  USER@example.test  ", next: "/me/" }, ip = "203.0.113.10", forwardedIp, rpc = { allowed: true, attempts: 1 }, rpcStatus = 200, resendStatus = 200, dbThrows = false } = {}) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const headers = new Headers(init.headers);
    const entry = { path: url.pathname, key: headers.get("apikey"), body: init.body ? JSON.parse(init.body) : null };
    calls.push(entry);
    if (url.pathname === "/rest/v1/rpc/consume_verification_email_resend_limit") {
      if (dbThrows) throw new Error("local RPC transport failure");
      return rpcStatus === 200 ? json([rpc]) : json({ code: "XX000", message: "local failure" }, rpcStatus);
    }
    if (url.pathname === "/auth/v1/resend") return resendStatus === 200 ? json({}) : json({ message: "unknown email" }, resendStatus);
    throw new Error(`unexpected request ${url.pathname}`);
  };
  try {
    const response = await POST({ request: new Request("https://app.test/api/auth/resend-confirmation", {
      method: "POST", headers: { "content-type": "application/json", ...(ip ? { "cf-connecting-ip": ip } : {}), ...(forwardedIp ? { "x-forwarded-for": forwardedIp } : {}) }, body: JSON.stringify(body),
    }) });
    return { response, body: await response.json(), calls };
  } finally { globalThis.fetch = previous; }
}

const success = await run();
assert.equal(success.response.status, 200);
assert.deepEqual(success.calls.map((call) => call.path), ["/rest/v1/rpc/consume_verification_email_resend_limit", "/auth/v1/resend"]);
assert.equal(success.calls[0].key, env.SUPABASE_SERVICE_ROLE_KEY, "only the narrow limiter RPC uses service role");
assert.equal(success.calls[1].key, env.SUPABASE_ANON_KEY, "normal Auth resend remains anon-key based");
assert.deepEqual(success.calls[0].body, { input_ip_hash: expectedHash("203.0.113.10"), max_attempts: 5, window_hours: 24 });
assert.equal(success.calls[1].body.email, "user@example.test");
assert.equal(success.calls[1].body.type, "signup");

const sameIp = await run({ body: { email: "other@example.test", next: "/feed/" } });
assert.equal(sameIp.calls[0].body.input_ip_hash, success.calls[0].body.input_ip_hash, "body email cannot choose rate-limit identity");
const otherIp = await run({ ip: "203.0.113.11" });
assert.notEqual(otherIp.calls[0].body.input_ip_hash, success.calls[0].body.input_ip_hash, "true server-observed IP has a separate bucket");
const untrustedIp = await run({ ip: null, forwardedIp: "203.0.113.99" });
assert.equal(untrustedIp.response.status, 500, "untrusted forwarded IP fails closed");
assert.equal(untrustedIp.calls.length, 0, "untrusted forwarded IP consumes no budget and sends no email");
for (const body of [{ email: "user@example.test", input_ip_hash: "a".repeat(64) }, { email: "user@example.test", max_attempts: 1000000 }, { email: "user@example.test", window_hours: 1 }]) {
  const invalid = await run({ body });
  assert.equal(invalid.response.status, 400, "browser-supplied limiter fields are rejected");
  assert.equal(invalid.calls.length, 0);
}

const missingService = env.SUPABASE_SERVICE_ROLE_KEY;
delete env.SUPABASE_SERVICE_ROLE_KEY;
try {
  const missing = await run();
  assert.equal(missing.response.status, 500, "missing service role fails closed");
  assert.ok(!missing.calls.some((call) => call.path === "/auth/v1/resend"), "missing service role sends no email");
} finally { env.SUPABASE_SERVICE_ROLE_KEY = missingService; }
for (const options of [{ rpcStatus: 503 }, { dbThrows: true }]) {
  const failed = await run(options);
  assert.equal(failed.response.status, 500, "limiter outage fails closed");
  assert.ok(!failed.calls.some((call) => call.path === "/auth/v1/resend"), "limiter outage sends no email");
}
const limited = await run({ rpc: { allowed: false, attempts: 5 } });
assert.equal(limited.response.status, 429);
assert.ok(!limited.calls.some((call) => call.path === "/auth/v1/resend"), "rate-limited route sends no email");
assert.equal(success.calls.filter((call) => call.path === "/auth/v1/resend").length, 1, "allowed route sends exactly one resend request");
const unknown = await run({ resendStatus: 400 });
assert.equal(unknown.response.status, 200);
assert.deepEqual(unknown.body, success.body, "provider account result stays generic");

const routeSource = await readFile(new URL("../src/pages/api/auth/resend-confirmation.ts", import.meta.url), "utf8");
assert.doesNotMatch(routeSource, /SUPABASE_SERVICE_ROLE_KEY/, "route does not handle privileged key directly");
console.log("PASS verification resend route: server hash, narrow service RPC, fail-closed ordering, generic response");
