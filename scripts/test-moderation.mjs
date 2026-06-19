import assert from "node:assert/strict";
import fs from "node:fs/promises";

const { evaluateLocalModeration, mergeModerationResults } = await import("../src/lib/moderation/moderate-content.server.ts");
const { moderateContent } = await import("../src/lib/moderation/moderate-content.server.ts");
const { parseModerationActionPayload } = await import("../src/lib/server/moderation-admin.ts");

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

await test("local moderation allows normal AR glasses discussion", () => {
  const result = evaluateLocalModeration({
    contentType: "post_body",
    userId: "u1",
    text: "想讨论 XREAL One 和 RayNeo X2 的显示差异，尤其是日常佩戴和开发体验。",
  });
  assert.equal(result.decision, "allow");
});

await test("local moderation allows short but meaningful Chinese title", () => {
  const result = evaluateLocalModeration({
    contentType: "post_title",
    userId: "u1",
    text: "想问一下",
  });
  assert.equal(result.decision, "allow");
});

await test("local moderation reviews suspicious redirect copy", () => {
  const result = evaluateLocalModeration({
    contentType: "post_body",
    userId: "u1",
    text: "加群获取完整资料，私聊我拿链接。",
  });
  assert.equal(result.decision, "review");
  assert.equal(result.reason, "sensitive_review");
});

await test("local moderation rejects obvious scam content", () => {
  const result = evaluateLocalModeration({
    contentType: "post_body",
    userId: "u1",
    text: "稳赚不赔，带单老师带你一夜暴富，马上加微。",
  });
  assert.equal(result.decision, "reject");
});

await test("excessive links trigger review", () => {
  const result = evaluateLocalModeration({
    contentType: "comment_body",
    userId: "u1",
    text: "看看这些 https://a.com https://b.com https://c.com",
  });
  assert.equal(result.decision, "review");
});

await test("too many links trigger reject", () => {
  const result = evaluateLocalModeration({
    contentType: "comment_body",
    userId: "u1",
    text: "https://a.com https://b.com https://c.com https://d.com https://e.com https://f.com",
  });
  assert.equal(result.decision, "reject");
});

await test("provider default does not force clean content into review", async () => {
  const result = await moderateContent({}, {
    contentType: "post_body",
    userId: "u1",
    text: "想讨论一下 XREAL One 和 RayNeo X2 的日常使用差异。",
  });
  assert.equal(result.decision, "allow");
});

await test("public visibility filters require moderation_status published", async () => {
  const files = [
    "src/lib/forum-feed.ts",
    "src/lib/forum-search.ts",
    "src/lib/profile-data.ts",
    "src/lib/post-engagement.ts",
    "src/pages/index.astro",
    "src/pages/circles/[slug].astro",
    "src/pages/posts/[id].astro",
  ];

  for (const file of files) {
    const content = await fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(content, /moderation_status"\s*,\s*"published"|moderation_status', 'published'|moderation_status", "published"/);
  }
});

await test("post creation keeps review decisions out of published state", async () => {
  const content = await fs.readFile(new URL("../src/pages/api/forum/posts.ts", import.meta.url), "utf8");
  assert.match(content, /const requiresReview = moderation\.decision === "review"/);
  assert.match(content, /status: insertedStatus/);
  assert.match(content, /moderation_status: insertedModerationStatus/);
  assert.match(content, /pending_review: requiresReview/);
});

await test("comment creation keeps review decisions out of published state", async () => {
  const content = await fs.readFile(new URL("../src/pages/api/forum/comments.ts", import.meta.url), "utf8");
  assert.match(content, /const requiresReview = moderation\.decision === "review"/);
  assert.match(content, /status: insertedStatus/);
  assert.match(content, /moderation_status: insertedModerationStatus/);
  assert.match(content, /pending_review: requiresReview/);
});

await test("merge moderation results prefers reject", () => {
  const result = mergeModerationResults([
    { decision: "allow", reason: null, score: 0.01, matchedRules: [], provider: "local" },
    { decision: "review", reason: "spam", score: 0.5, matchedRules: ["r1"], provider: "local" },
    { decision: "reject", reason: "scam", score: 0.9, matchedRules: ["r2"], provider: "local" },
  ]);
  assert.equal(result.decision, "reject");
  assert.equal(result.reason, "scam");
});

await test("admin moderation payload parser validates target", () => {
  const result = parseModerationActionPayload({ target_type: "post", target_id: "11111111-1111-1111-1111-111111111111" });
  assert.equal(result.ok, true);
});

console.log("MODERATION TESTS PASSED");
