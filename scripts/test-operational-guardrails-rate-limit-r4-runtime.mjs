import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const wrapper = await import("../src/lib/server/consume-forum-rate-limit.server.ts");
const rateLimit = await import("../src/lib/server/rate-limit.ts");
const env = { SUPABASE_URL: "https://local.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-only-not-a-secret" };
const input = { userId: "00000000-0000-0000-0000-000000000001", ipHash: "a".repeat(64), purpose: "post_create", bytes: 0 };
const fake = (data, error = null) => ({ createClient: () => ({ rpc: async () => ({ data, error }) }) });

assert.deepEqual(await wrapper.consumeForumRateLimit(env, input, fake([{ allowed: true, decision: "ALLOWED" }])), { allowed: true, reason: "ALLOWED" });
assert.deepEqual(await wrapper.consumeForumRateLimit(env, input, fake([{ allowed: false, decision: "RATE_LIMITED" }])), { allowed: false, reason: "RATE_LIMITED" });
for (const data of [[], [{ allowed: true, decision: "ALLOWED" }, { allowed: true, decision: "ALLOWED" }], [{ allowed: "true", decision: "ALLOWED" }], [{ allowed: true, decision: "UNKNOWN" }], [{ allowed: true, decision: "RATE_LIMITED" }]]) {
  await assert.rejects(() => wrapper.consumeForumRateLimit(env, input, fake(data)), { message: "RATE_LIMIT_MALFORMED_RESULT" });
}
for (const error of [{ message: "permission denied" }, { message: "function missing" }]) {
  await assert.rejects(() => wrapper.consumeForumRateLimit(env, input, fake(null, error)), { message: "RATE_LIMIT_SERVICE_UNAVAILABLE" });
}
let calls = 0;
await assert.rejects(() => wrapper.consumeForumRateLimit(env, input, { createClient: () => ({ rpc: async () => { calls += 1; return new Promise(() => {}); } }), timeoutMs: 5 }), { message: "RATE_LIMIT_TIMEOUT" });
assert.equal(calls, 1, "the RPC has no automatic retry");
assert.equal(wrapper.RATE_LIMIT_RUNTIME_DEADLINE_MS, 4000);
assert.deepEqual(await rateLimit.enforceUserRateLimit({ env, userId: input.userId, ipHash: input.ipHash, purpose: "post_create" }), { allowed: false, reason: "RATE_LIMIT_SERVICE_UNAVAILABLE" }, "missing live service fails closed");

const paths = [
  "src/pages/api/forum/posts.ts",
  "src/pages/api/forum/comments.ts",
  "src/pages/api/forum/circles.ts",
  "src/pages/api/forum/media-upload-guard.ts",
  "src/pages/api/forum/external-video-upload.ts",
];
const sources = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await readFile(path, "utf8")])));
for (const source of Object.values(sources)) {
  assert.doesNotMatch(source, /forum_upload_attempts/);
  assert.match(source, /RATE_LIMITED[\s\S]*429[\s\S]*Rate limit service temporarily unavailable[\s\S]*503/s);
}
assert.match(sources["src/pages/api/forum/posts.ts"], /purpose: "post_create"[\s\S]*bytes: 0/s);
assert.match(sources["src/pages/api/forum/comments.ts"], /purpose: "comment_create"[\s\S]*bytes: 0/s);
assert.match(sources["src/pages/api/forum/circles.ts"], /purpose: "circle_create"[\s\S]*bytes: 0/s);
assert.match(sources["src/pages/api/forum/media-upload-guard.ts"], /purpose: "post_media_upload"[\s\S]*bytes: sizeBytes/s);
assert.match(sources["src/pages/api/forum/external-video-upload.ts"], /purpose: "external_video_upload"[\s\S]*bytes: sizeBytes[\s\S]*signR2PutUrl/s);
const wrapperSource = await readFile("src/lib/server/consume-forum-rate-limit.server.ts", "utf8");
assert.doesNotMatch(await readFile("src/lib/supabase-browser.ts", "utf8").catch(() => ""), /SUPABASE_SERVICE_ROLE_KEY|consume_forum_rate_limit/);
assert.doesNotMatch(wrapperSource, /export function createRateLimitRpcClient|export \{[^}]*createRateLimitRpcClient/);
assert.doesNotMatch(wrapperSource, /console\.(?:log|warn|error)/);
console.log("operational-guardrails R4 fail-closed runtime: PASS offline-only");
