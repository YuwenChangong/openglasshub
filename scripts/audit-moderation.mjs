import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  return {
    strict: argv.includes("--strict"),
    verbose: argv.includes("--verbose"),
  };
}

async function read(filePath) {
  return fs.readFile(path.resolve(process.cwd(), filePath), "utf8");
}

async function exists(filePath) {
  try {
    await fs.access(path.resolve(process.cwd(), filePath));
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else files.push(fullPath);
  }
  return files;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const errors = [];

  const requiredFiles = [
    "src/lib/moderation/local-sensitive-lexicon.server.ts",
    "src/lib/moderation/openai-forum-policy-classifier.server.ts",
    "src/lib/moderation/moderate-content.server.ts",
    "src/lib/moderation/sensitive-lexicon-loader.server.ts",
    "src/lib/moderation/moderate-asset.server.ts",
    "scripts/moderation/import-sensitive-lexicons.mjs",
    "src/data/moderation/sensitive-lexicon.generated.json",
    "src/data/moderation/sensitive-lexicon.generated.ts",
    "src/data/moderation/sensitive-lexicon-manifest.generated.json",
    "docs/moderation-policy.md",
  ];

  for (const file of requiredFiles) {
    if (!(await exists(file))) errors.push(`missing required file: ${file}`);
  }

  const postsApi = await read("src/pages/api/forum/posts.ts");
  const commentsApi = await read("src/pages/api/forum/comments.ts");
  const circlesApi = await read("src/pages/api/forum/circles.ts");
  const profileApi = await read("src/pages/api/users/me/profile.ts");
  const postMediaApi = await read("src/pages/api/forum/post-media.ts");
  const moderationCore = await read("src/lib/moderation/moderate-content.server.ts");
  const moderationAsset = await read("src/lib/moderation/moderate-asset.server.ts");
  const moderationMedia = await read("src/lib/moderation/moderation-media.server.ts");
  const providerSource = await read("src/lib/moderation/moderation-provider.server.ts");
  const matcherSource = await read("src/lib/moderation/local-sensitive-lexicon.server.ts");
  const moderationAdmin = await read("src/lib/server/moderation-admin.ts");
  const policyDoc = await read("docs/moderation-policy.md");
  const setupDoc = await read("docs/openai-moderation-setup.md");
  const customReview = await read("src/data/moderation/custom-reviewlist.json");
  const customDeny = await read("src/data/moderation/custom-denylist.json");
  const customAllow = await read("src/data/moderation/custom-allowlist.json");

  if (!postsApi.includes("moderateContent(")) errors.push("posts API does not call moderateContent");
  if (!commentsApi.includes("moderateContent(")) errors.push("comments API does not call moderateContent");
  if (!circlesApi.includes("moderateContent(")) errors.push("circles API does not call moderateContent");
  if (!profileApi.includes("moderateContent(")) errors.push("profile API does not call moderateContent");
  if (!profileApi.includes("moderateAsset(")) errors.push("profile API does not call moderateAsset");
  if (!circlesApi.includes("moderateAsset(")) errors.push("circles API does not call moderateAsset");
  if (!postMediaApi.includes("evaluateLocalSensitiveLexicon(")) errors.push("post media API does not call local sensitive lexicon for media metadata");
  if (!postMediaApi.includes("moderateAsset(")) errors.push("post media API does not call moderateAsset");
  if (!/createSignedModerationUrls/.test(moderationMedia)) errors.push("moderation media helper missing signed moderation url resolver");
  if (!/absolutizeSignedUrl/.test(moderationMedia)) errors.push("moderation media helper should absolutize signed URLs");
  if (/\.single\(\)/.test(moderationAdmin)) errors.push("moderation admin actions should avoid unsafe .single() coercion");
  if (!/evaluateLocalSensitiveLexicon/.test(moderationCore)) errors.push("moderation core missing local sensitive lexicon layer");
  if (!/runOpenAIForumPolicyClassifier/.test(moderationCore)) errors.push("moderation core missing forum policy classifier layer");
  if (!/resolveModerationProviderUnavailablePolicy/.test(providerSource)) errors.push("provider unavailable policy resolver missing");
  if (!/openai_provider_unavailable_local_allow/.test(moderationCore)) errors.push("moderation core missing degraded local-only reason");
  if (!/forumPolicyClassifierEnabled/.test(moderationCore)) errors.push("moderation core missing explicit optional classifier gate");
  if (!/local_only_safe/.test(policyDoc)) errors.push("moderation policy doc missing local_only_safe mode");
  if (!/not equivalent to full OpenAI moderation/i.test(policyDoc)) errors.push("moderation policy doc should explain degraded mode is not full OpenAI moderation");
  if (!/Default moderation stack/i.test(setupDoc)) errors.push("setup doc should describe the default moderation stack");
  if (!/Optional paid enhancement/i.test(setupDoc)) errors.push("setup doc should describe paid classifier as optional");
  if (!/reject|review|allow/.test(policyDoc)) errors.push("moderation policy doc looks incomplete");
  if (!/compiledLexicon/.test(matcherSource)) errors.push("local matcher does not appear to cache compiled lexicon data");
  if (!/isLocalDegradedModerationResult/.test(postsApi)) errors.push("posts API does not preserve degraded metadata");
  if (!/isLocalDegradedModerationResult/.test(commentsApi)) errors.push("comments API does not preserve degraded metadata");

  const filterFiles = [
    "src/lib/forum-feed.ts",
    "src/lib/forum-search.ts",
    "src/lib/profile-data.ts",
    "src/pages/index.astro",
    "src/pages/circles/[slug].astro",
    "src/pages/posts/[id].astro",
  ];

  for (const file of filterFiles) {
    const content = await read(file);
    if (!/moderation_status"\s*,\s*"published"|moderation_status', 'published'|moderation_status", "published"/.test(content)) {
      errors.push(`missing moderation_status published filter: ${file}`);
    }
  }

  const srcFiles = await walk(path.resolve(process.cwd(), "src"));
  const serviceRoleAllowlist = new Map([
    ["src/lib/server/legal-consent-repository.server.ts", /createLegalConsentWriteClient/],
    ["src/lib/server/moderation-notifications.server.ts", /createModerationNotificationServiceClient/],
    ["src/lib/server/consume-forum-rate-limit.server.ts", /createRateLimitRpcClient/],
  ]);
  for (const file of srcFiles) {
    const content = await fs.readFile(file, "utf8");
    const normalized = path.relative(process.cwd(), file).replace(/\\/g, "/");
    if (/window\.confirm|window\.alert|window\.prompt/.test(content)) {
      errors.push(`native browser dialog found: ${normalized}`);
    }
    if (/SUPABASE_SERVICE_ROLE_KEY|service_role/.test(content)) {
      const narrowBoundary = serviceRoleAllowlist.get(normalized);
      if (!narrowBoundary) {
        errors.push(`service role reference found in src: ${normalized}`);
      } else if (!normalized.includes("/server/") || !narrowBoundary.test(content)) {
        errors.push(`invalid service role allowlist entry: ${normalized}`);
      }
    }
    if (/raw response|category_scores/i.test(content) && normalized.startsWith("src/components")) {
      errors.push(`client path references raw moderation data: ${normalized}`);
    }
  }

  const criticalSources = `${matcherSource}\n${moderationCore}\n${policyDoc}\n${customReview}\n${customDeny}\n${customAllow}`.toLowerCase();
  const criticalTerms = ["人口贩卖", "嫖娼", "卖淫", "私聊", "完整资料入口", "加微信", "telegram", "二维码", "外部链接诱导", "下载链接"];
  for (const term of criticalTerms) {
    if (!criticalSources.includes(term.toLowerCase())) {
      errors.push(`critical term coverage not evident for: ${term}`);
    }
  }

  console.log(`required files: ${requiredFiles.length}`);
  console.log(`errors: ${errors.length}`);
  if (args.verbose) {
    requiredFiles.forEach((file) => console.log(`- file: ${file}`));
  }

  if (errors.length > 0) {
    console.error("\nMODERATION AUDIT FAILED");
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  console.log("\nMODERATION AUDIT PASSED");
}

main().catch((error) => {
  console.error("audit-moderation failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
