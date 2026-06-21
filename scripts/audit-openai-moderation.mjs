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
    "src/lib/moderation/openai-moderation-provider.server.ts",
    "src/lib/moderation/openai-forum-policy-classifier.server.ts",
    "src/lib/moderation/moderate-content.server.ts",
    "src/lib/moderation/moderate-asset.server.ts",
    "scripts/qa/check-openai-moderation-provider.mjs",
    "docs/openai-moderation-setup.md",
    ".env.example",
  ];

  for (const file of requiredFiles) {
    if (!(await exists(file))) errors.push(`missing required file: ${file}`);
  }

  const envExample = await read(".env.example");
  const packageJson = await read("package.json");
  const setupDoc = await read("docs/openai-moderation-setup.md");
  const moderationCore = await read("src/lib/moderation/moderate-content.server.ts");
  const moderationAsset = await read("src/lib/moderation/moderate-asset.server.ts");
  const classifierSource = await read("src/lib/moderation/openai-forum-policy-classifier.server.ts");
  const providerSource = await read("src/lib/moderation/openai-moderation-provider.server.ts");

  if (/PUBLIC_OPENAI/i.test(envExample)) errors.push("PUBLIC_OPENAI env should not exist");
  if (!/OPENAI_MODERATION_ENABLED=false/.test(envExample)) errors.push(".env.example missing OPENAI_MODERATION_ENABLED=false");
  if (!/OPENAI_MODERATION_FAIL_MODE=review/.test(envExample)) errors.push(".env.example missing OPENAI_MODERATION_FAIL_MODE=review");
  if (!/MODERATION_PROVIDER_UNAVAILABLE_POLICY=review_all/.test(envExample)) errors.push(".env.example missing MODERATION_PROVIDER_UNAVAILABLE_POLICY=review_all");
  if (!/OPENAI_FORUM_POLICY_ENABLED=false/.test(envExample)) errors.push(".env.example missing OPENAI_FORUM_POLICY_ENABLED=false");
  if (!/OPENAI_FORUM_POLICY_FAIL_MODE=review/.test(envExample)) errors.push(".env.example missing OPENAI_FORUM_POLICY_FAIL_MODE=review");
  if (!/Optional paid enhancement/i.test(setupDoc)) errors.push("setup doc should mark forum policy classifier as optional paid enhancement");
  if (!/Default moderation stack:/i.test(setupDoc)) errors.push("setup doc should declare the default moderation stack");
  if (!/OpenAI forum policy classifier[\s\S]*disabled by default/i.test(setupDoc)) errors.push("setup doc should state classifier is disabled by default");
  if (!/normal OpenAI model/i.test(setupDoc) || !/cost money|consume API credits/i.test(setupDoc)) errors.push("setup doc should explain classifier uses a paid normal model");
  if (!/test:sensitive-lexicon/.test(packageJson)) errors.push("package.json missing test:sensitive-lexicon");
  if (!/server-side only/i.test(setupDoc) && !/server-only/i.test(setupDoc)) errors.push("setup doc should mention server-only key handling");
  if (!/local_only_safe/i.test(setupDoc)) errors.push("setup doc should document degraded local_only_safe behavior");
  if (!/does not count as OpenAI success/i.test(setupDoc)) errors.push("setup doc should state provider errors are not OpenAI success");
  if (!/fail closed/i.test(setupDoc)) errors.push("setup doc should document fail-closed behavior");
  if (!/Full video-stream moderation is not implemented/i.test(setupDoc)) errors.push("setup doc should document video limitation");
  if (!/forumPolicyClassifierEnabled/.test(moderationCore)) errors.push("moderation core should use an explicit forum policy classifier enable gate");
  if (!/openai_provider_unavailable_local_allow/.test(moderationCore)) errors.push("moderation core missing degraded local-only allow reason");
  if (!/resolveModerationProviderUnavailablePolicy/.test(moderationCore)) errors.push("moderation core missing provider unavailable policy resolver");
  if (!/http_429|http_5xx/.test(providerSource)) errors.push("OpenAI moderation provider missing 429/5xx status mapping");
  if (!/http_429|http_5xx/.test(classifierSource)) errors.push("forum policy classifier missing 429/5xx status mapping");
  if (!/chat\/completions/.test(classifierSource)) errors.push("forum policy classifier missing OpenAI chat completions call");
  if (!/api\.openai\.com\/v1\/moderations/.test(providerSource)) errors.push("OpenAI moderation endpoint missing");

  const srcFiles = await walk(path.resolve(process.cwd(), "src"));
  const distDir = path.resolve(process.cwd(), "dist");
  const distFiles = (await exists("dist")) ? await walk(distDir) : [];

  for (const file of srcFiles) {
    const content = await fs.readFile(file, "utf8");
    const normalized = path.relative(process.cwd(), file).replace(/\\/g, "/");
    if (/OPENAI_API_KEY/.test(content) && normalized.startsWith("src/components")) {
      errors.push(`OPENAI_API_KEY referenced from client component: ${normalized}`);
    }
    if (/PUBLIC_OPENAI/i.test(content)) {
      errors.push(`PUBLIC_OPENAI reference found in src: ${normalized}`);
    }
  }

  for (const file of distFiles) {
    const content = await fs.readFile(file, "utf8");
    const normalized = path.relative(process.cwd(), file).replace(/\\/g, "/");
    if (/OPENAI_API_KEY|PUBLIC_OPENAI|category_scores/i.test(content)) {
      errors.push(`sensitive OpenAI string leaked to dist: ${normalized}`);
    }
  }

  console.log(`required files: ${requiredFiles.length}`);
  console.log(`errors: ${errors.length}`);
  if (args.verbose) {
    requiredFiles.forEach((file) => console.log(`- file: ${file}`));
  }

  if (errors.length > 0) {
    console.error("\nOPENAI MODERATION AUDIT FAILED");
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  console.log("\nOPENAI MODERATION AUDIT PASSED");
}

main().catch((error) => {
  console.error("audit-openai-moderation failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
