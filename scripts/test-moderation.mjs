import assert from "node:assert/strict";

const { evaluateLocalModeration, mergeModerationResults } = await import("../src/lib/moderation/moderate-content.server.ts");
const { parseModerationActionPayload } = await import("../src/lib/server/moderation-admin.ts");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("local moderation allows normal AR glasses discussion", () => {
  const result = evaluateLocalModeration({
    contentType: "post_body",
    userId: "u1",
    text: "想讨论 XREAL One 和 RayNeo X2 的显示差异，尤其是日常佩戴和开发体验。",
  });
  assert.equal(result.decision, "allow");
});

test("local moderation reviews suspicious redirect copy", () => {
  const result = evaluateLocalModeration({
    contentType: "post_body",
    userId: "u1",
    text: "加群获取完整资料，私聊我拿链接。",
  });
  assert.equal(result.decision, "review");
  assert.equal(result.reason, "sensitive_review");
});

test("local moderation rejects obvious scam content", () => {
  const result = evaluateLocalModeration({
    contentType: "post_body",
    userId: "u1",
    text: "稳赚不赔，带单老师带你一夜暴富，马上加微。",
  });
  assert.equal(result.decision, "reject");
});

test("excessive links trigger review", () => {
  const result = evaluateLocalModeration({
    contentType: "comment_body",
    userId: "u1",
    text: "看看这些 https://a.com https://b.com https://c.com",
  });
  assert.equal(result.decision, "review");
});

test("too many links trigger reject", () => {
  const result = evaluateLocalModeration({
    contentType: "comment_body",
    userId: "u1",
    text: "https://a.com https://b.com https://c.com https://d.com https://e.com https://f.com",
  });
  assert.equal(result.decision, "reject");
});

test("merge moderation results prefers reject", () => {
  const result = mergeModerationResults([
    { decision: "allow", reason: null, score: 0.01, matchedRules: [], provider: "local" },
    { decision: "review", reason: "spam", score: 0.5, matchedRules: ["r1"], provider: "local" },
    { decision: "reject", reason: "scam", score: 0.9, matchedRules: ["r2"], provider: "local" },
  ]);
  assert.equal(result.decision, "reject");
  assert.equal(result.reason, "scam");
});

test("admin moderation payload parser validates target", () => {
  const result = parseModerationActionPayload({ target_type: "post", target_id: "11111111-1111-1111-1111-111111111111" });
  assert.equal(result.ok, true);
});

console.log("MODERATION TESTS PASSED");
