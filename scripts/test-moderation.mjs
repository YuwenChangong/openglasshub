import assert from "node:assert/strict";
import fs from "node:fs/promises";

const { evaluateLocalModeration, mergeModerationResults, moderateContent } = await import("../src/lib/moderation/moderate-content.server.ts");
const { moderateAsset } = await import("../src/lib/moderation/moderate-asset.server.ts");
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

await test("local allow + openai allow => published path stays allow", async () => {
  const result = await moderateContent(
    { OPENAI_MODERATION_ENABLED: "true" },
    {
      contentType: "post_body",
      userId: "u1",
      text: "想讨论一下 XREAL One 和 RayNeo X2 的日常使用差异。",
      providerInput: { targetType: "post_text", body: "想讨论一下 XREAL One 和 RayNeo X2 的日常使用差异。" },
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "allow",
        reasonCode: "openai_allow",
        flagged: false,
      }),
    },
  );
  assert.equal(result.decision, "allow");
  assert.equal(result.provider, "local+openai");
});

await test("local allow + openai review => pending_review", async () => {
  const result = await moderateContent(
    { OPENAI_MODERATION_ENABLED: "true" },
    {
      contentType: "post_body",
      userId: "u1",
      text: "测试内容",
      providerInput: { targetType: "post_text", body: "测试内容" },
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "review",
        reasonCode: "openai_flagged_harassment",
        flagged: true,
        categories: ["harassment"],
        scoresSummary: { harassment: "medium" },
      }),
    },
  );
  assert.equal(result.decision, "review");
});

await test("local allow + openai reject => rejected", async () => {
  const result = await moderateContent(
    { OPENAI_MODERATION_ENABLED: "true" },
    {
      contentType: "post_body",
      userId: "u1",
      text: "测试内容",
      providerInput: { targetType: "post_text", body: "测试内容" },
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "reject",
        reasonCode: "openai_flagged_violence_graphic",
        flagged: true,
        categories: ["violence/graphic"],
        scoresSummary: { "violence/graphic": "high" },
      }),
    },
  );
  assert.equal(result.decision, "reject");
});

await test("local review + openai allow => pending_review", async () => {
  const result = await moderateContent(
    { OPENAI_MODERATION_ENABLED: "true" },
    {
      contentType: "post_body",
      userId: "u1",
      text: "加群获取完整资料，私聊我拿链接。",
      providerInput: { targetType: "post_text", body: "加群获取完整资料，私聊我拿链接。" },
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "allow",
        reasonCode: "openai_allow",
        flagged: false,
      }),
    },
  );
  assert.equal(result.decision, "review");
});

await test("local reject does not call OpenAI", async () => {
  let called = false;
  const result = await moderateContent(
    { OPENAI_MODERATION_ENABLED: "true" },
    {
      contentType: "post_body",
      userId: "u1",
      text: "稳赚不赔，带单老师带你一夜暴富，马上加微。",
      providerInput: { targetType: "post_text", body: "稳赚不赔，带单老师带你一夜暴富，马上加微。" },
    },
    {
      openaiRunner: async () => {
        called = true;
        return {
          provider: "openai",
          decision: "allow",
          reasonCode: "openai_allow",
          flagged: false,
        };
      },
    },
  );
  assert.equal(result.decision, "reject");
  assert.equal(called, false);
});

await test("OpenAI timeout degrades to local-only for clean text even when fail_mode=review", async () => {
  const result = await moderateContent(
    { OPENAI_MODERATION_ENABLED: "true", OPENAI_MODERATION_FAIL_MODE: "review" },
    {
      contentType: "comment_body",
      userId: "u1",
      text: "正常评论",
      providerInput: { targetType: "comment_text", body: "正常评论" },
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "error",
        reasonCode: "openai_provider_error_timeout",
        flagged: false,
        providerStatus: "timeout",
      }),
    },
  );
  assert.equal(result.decision, "allow");
  assert.equal(result.providerDetails?.providerStatus, "timeout");
});

await test("OpenAI timeout + fail_mode=local_only => local decision", async () => {
  const result = await moderateContent(
    { OPENAI_MODERATION_ENABLED: "true", OPENAI_MODERATION_FAIL_MODE: "local_only" },
    {
      contentType: "comment_body",
      userId: "u1",
      text: "正常评论",
      providerInput: { targetType: "comment_text", body: "正常评论" },
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "error",
        reasonCode: "openai_provider_error_timeout",
        flagged: false,
        providerStatus: "timeout",
      }),
    },
  );
  assert.equal(result.decision, "allow");
});

await test("OpenAI missing key degrades to local-only for clean text", async () => {
  const result = await moderateContent(
    { OPENAI_MODERATION_ENABLED: "true", OPENAI_MODERATION_FAIL_MODE: "review" },
    {
      contentType: "post_body",
      userId: "u1",
      text: "想讨论一下 XREAL One 和 RayNeo Air 3s 的日常使用差异。",
      providerInput: { targetType: "post_text", body: "想讨论一下 XREAL One 和 RayNeo Air 3s 的日常使用差异。" },
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "error",
        reasonCode: "openai_provider_error_missing_key",
        flagged: false,
        providerStatus: "missing_key",
        safeSummary: "OpenAI moderation key is not configured.",
      }),
    },
  );
  assert.equal(result.decision, "allow");
  assert.equal(result.providerDetails?.providerStatus, "missing_key");
});

await test("OpenAI http error degrades to local-only for clean text", async () => {
  const result = await moderateContent(
    { OPENAI_MODERATION_ENABLED: "true", OPENAI_MODERATION_FAIL_MODE: "review" },
    {
      contentType: "post_body",
      userId: "u1",
      text: "想讨论一下 XREAL One 和 RayNeo Air 3s 的日常使用差异。",
      providerInput: { targetType: "post_text", body: "想讨论一下 XREAL One 和 RayNeo Air 3s 的日常使用差异。" },
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "error",
        reasonCode: "openai_provider_error_http",
        flagged: false,
        providerStatus: "http_error",
        safeSummary: "OpenAI moderation returned an HTTP error.",
      }),
    },
  );
  assert.equal(result.decision, "allow");
  assert.equal(result.providerDetails?.providerStatus, "http_error");
});

await test("clean profile text stays allow when provider config is missing", async () => {
  const result = await moderateContent(
    { OPENAI_MODERATION_ENABLED: "true", OPENAI_MODERATION_FAIL_MODE: "review" },
    {
      contentType: "profile_text",
      userId: "u1",
      text: "Display name: Test\nBio: AR glasses enthusiast. Interested in spatial computing.",
      providerInput: {
        targetType: "profile_text",
        body: "Display name: Test\nBio: AR glasses enthusiast. Interested in spatial computing.",
      },
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "error",
        reasonCode: "openai_provider_error_missing_key",
        flagged: false,
        providerStatus: "missing_key",
      }),
    },
  );
  assert.equal(result.decision, "allow");
});

await test("clean circle text stays allow when provider config is missing", async () => {
  const result = await moderateContent(
    { OPENAI_MODERATION_ENABLED: "true", OPENAI_MODERATION_FAIL_MODE: "review" },
    {
      contentType: "circle_description",
      userId: "u1",
      text: "[OPENAI-QA-FP] AR Glasses Daily\nDiscuss daily use, comfort, display quality and software experience.",
      localInputs: [
        { contentType: "circle_name", text: "[OPENAI-QA-FP] AR Glasses Daily" },
        { contentType: "circle_description", text: "Discuss daily use, comfort, display quality and software experience." },
      ],
      providerInput: {
        targetType: "circle_text",
        title: "[OPENAI-QA-FP] AR Glasses Daily",
        description: "Discuss daily use, comfort, display quality and software experience.",
      },
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "error",
        reasonCode: "openai_provider_error_missing_key",
        flagged: false,
        providerStatus: "missing_key",
      }),
    },
  );
  assert.equal(result.decision, "allow");
});

await test("image moderation disabled keeps provider input image-free path harmless", async () => {
  const result = await moderateContent(
    { OPENAI_MODERATION_ENABLED: "true", OPENAI_MODERATION_IMAGE_ENABLED: "false" },
    {
      contentType: "post_body",
      userId: "u1",
      text: "正常图片帖",
      providerInput: { targetType: "post_text", body: "正常图片帖", imageUrls: ["https://example.com/image.png"] },
    },
    {
      openaiRunner: async (_env, providerInput) => {
        assert.deepEqual(providerInput.imageUrls, ["https://example.com/image.png"]);
        return {
          provider: "openai",
          decision: "allow",
          reasonCode: "openai_allow",
          flagged: false,
        };
      },
    },
  );
  assert.equal(result.decision, "allow");
});

await test("image moderation enabled + flagged => pending/reject path available", async () => {
  const result = await moderateContent(
    { OPENAI_MODERATION_ENABLED: "true", OPENAI_MODERATION_IMAGE_ENABLED: "true" },
    {
      contentType: "post_body",
      userId: "u1",
      text: "正常图片帖",
      providerInput: { targetType: "post", body: "正常图片帖", imageUrls: ["https://example.com/image.png"] },
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "review",
        reasonCode: "openai_threshold_review",
        flagged: true,
        providerStatus: "success",
        categories: ["sexual"],
        scoresSummary: { sexual: "medium" },
      }),
    },
  );
  assert.equal(result.decision, "review");
});

await test("profile text uses OpenAI primary path when enabled", async () => {
  const result = await moderateContent(
    { OPENAI_MODERATION_ENABLED: "true" },
    {
      contentType: "profile_text",
      userId: "u1",
      text: "Display name: Test\nBio: 正常资料",
      providerInput: { targetType: "profile_text", body: "Display name: Test\nBio: 正常资料" },
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "allow",
        reasonCode: "openai_allow",
        flagged: false,
        providerStatus: "success",
      }),
    },
  );
  assert.equal(result.decision, "allow");
});

await test("flagged false never maps to review by score summary alone", async () => {
  const result = await moderateContent(
    { OPENAI_MODERATION_ENABLED: "true" },
    {
      contentType: "post_body",
      userId: "u1",
      text: "正常内容",
      providerInput: { targetType: "post_text", body: "正常内容" },
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "allow",
        reasonCode: "openai_allow",
        flagged: false,
        providerStatus: "success",
        scoresSummary: { harassment: "high" },
      }),
    },
  );
  assert.equal(result.decision, "allow");
});

await test("asset moderation blocks flagged avatar image", async () => {
  const result = await moderateAsset(
    { OPENAI_MODERATION_ENABLED: "true" },
    {
      targetType: "profile_avatar_image",
      imageUrls: ["https://example.com/avatar.png"],
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "reject",
        reasonCode: "openai_flagged_harassment_threatening",
        flagged: true,
      }),
    },
  );
  assert.equal(result.decision, "reject");
});

await test("asset moderation provider error degrades to local-only for clean media", async () => {
  const result = await moderateAsset(
    { OPENAI_MODERATION_ENABLED: "true", OPENAI_MODERATION_FAIL_MODE: "review" },
    {
      targetType: "circle_cover_image",
      imageUrls: ["https://example.com/cover.png"],
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "error",
        reasonCode: "openai_provider_error_timeout",
        flagged: false,
        providerStatus: "timeout",
      }),
    },
  );
  assert.equal(result.decision, "allow");
  assert.equal(result.providerDetails?.providerStatus, "timeout");
});

await test("asset moderation provider error respects local_only fail mode", async () => {
  const result = await moderateAsset(
    { OPENAI_MODERATION_ENABLED: "true", OPENAI_MODERATION_FAIL_MODE: "local_only" },
    {
      targetType: "profile_banner_image",
      imageUrls: ["https://example.com/banner.png"],
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "error",
        reasonCode: "openai_provider_error_timeout",
        flagged: false,
        providerStatus: "timeout",
      }),
    },
  );
  assert.equal(result.decision, "allow");
});

await test("asset moderation missing key degrades to local-only even with review fail mode", async () => {
  const result = await moderateAsset(
    { OPENAI_MODERATION_ENABLED: "true", OPENAI_MODERATION_FAIL_MODE: "review" },
    {
      targetType: "post_image",
      imageUrls: ["https://example.com/cover.png"],
    },
    {
      openaiRunner: async () => ({
        provider: "openai",
        decision: "error",
        reasonCode: "openai_provider_error_missing_key",
        flagged: false,
        providerStatus: "missing_key",
        safeSummary: "OpenAI moderation key is not configured.",
      }),
    },
  );
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

await test("circle creation moderates name and description before insert", async () => {
  const content = await fs.readFile(new URL("../src/pages/api/forum/circles.ts", import.meta.url), "utf8");
  assert.match(content, /contentType: "circle_name"/);
  assert.match(content, /contentType: "circle_description"/);
  assert.match(content, /localInputs/);
  assert.match(content, /CONTENT_REJECTED|MODERATION_TEMPORARILY_UNAVAILABLE/);
});

await test("profile save uses server moderation API", async () => {
  const content = await fs.readFile(new URL("../src/components/profile/EditProfileForm.tsx", import.meta.url), "utf8");
  assert.match(content, /\/api\/users\/me\/profile/);
});

await test("profile API distinguishes provider unavailability from content rejection", async () => {
  const content = await fs.readFile(new URL("../src/pages/api/users/me/profile.ts", import.meta.url), "utf8");
  assert.match(content, /PROFILE_MODERATION_UNAVAILABLE/);
  assert.match(content, /资料审核暂时不可用/);
});

await test("circle APIs distinguish provider unavailability from content rejection", async () => {
  const content = await fs.readFile(new URL("../src/pages/api/forum/circles.ts", import.meta.url), "utf8");
  assert.match(content, /MODERATION_TEMPORARILY_UNAVAILABLE/);
  assert.match(content, /isProviderErrorModerationResult/);
});

await test("post media moderation supports video thumbnail review fallback", async () => {
  const content = await fs.readFile(new URL("../src/pages/api/forum/post-media.ts", import.meta.url), "utf8");
  assert.match(content, /openai_video_thumbnail_missing_review/);
  assert.match(content, /post_video_metadata/);
  assert.match(content, /reason_code:\s*moderatedPost\?\.moderation_reason/);
  assert.match(content, /视频已提交审核/);
});

await test("create post form falls back on failed external video fetch", async () => {
  const content = await fs.readFile(new URL("../src/components/forum/CreatePostForm.tsx", import.meta.url), "utf8");
  assert.match(content, /Failed to fetch/);
  assert.match(content, /视频已提交审核/);
});

await test("external video upload route returns JSON on catch-all errors", async () => {
  const content = await fs.readFile(new URL("../src/pages/api/forum/external-video-upload.ts", import.meta.url), "utf8");
  assert.match(content, /return json\(\{ error: `\[\$\{stage\}\] \$\{message\}` \}, 500\)/);
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
