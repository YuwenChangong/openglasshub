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
    "src/lib/moderation/moderate-asset.server.ts",
    "docs/openai-moderation-setup.md",
    ".env.example",
  ];

  for (const file of requiredFiles) {
    if (!(await exists(file))) errors.push(`missing required file: ${file}`);
  }

  const envExample = await read(".env.example");
  const packageJson = await read("package.json");
  const setupDoc = await read("docs/openai-moderation-setup.md");
  const watchlistDoc = await read("docs/post-launch-watchlist.md");
  const moderationCore = await read("src/lib/moderation/moderate-content.server.ts");
  const moderationAsset = await read("src/lib/moderation/moderate-asset.server.ts");
  const moderationTypes = await read("src/lib/moderation/moderation-types.ts");
  const moderationTests = await read("scripts/test-moderation.mjs");

  if (/PUBLIC_OPENAI_API_KEY/i.test(envExample)) errors.push("PUBLIC_OPENAI_API_KEY should not exist");
  if (!/OPENAI_MODERATION_ENABLED=false/.test(envExample)) errors.push("OPENAI_MODERATION_ENABLED should default to false in .env.example");
  if (!/OPENAI_MODERATION_FAIL_MODE=review/.test(envExample)) errors.push("OPENAI_MODERATION_FAIL_MODE should default to review in .env.example");
  if (!/OPENAI_POST_IMAGE_MODERATION_ENABLED=false/.test(envExample)) errors.push("OPENAI_POST_IMAGE_MODERATION_ENABLED should default to false in .env.example");
  if (!/OPENAI_PROFILE_IMAGE_MODERATION_ENABLED=false/.test(envExample)) errors.push("OPENAI_PROFILE_IMAGE_MODERATION_ENABLED should default to false in .env.example");
  if (!/OPENAI_CIRCLE_COVER_MODERATION_ENABLED=false/.test(envExample)) errors.push("OPENAI_CIRCLE_COVER_MODERATION_ENABLED should default to false in .env.example");
  if (!/OPENAI_VIDEO_THUMBNAIL_MODERATION_ENABLED=false/.test(envExample)) errors.push("OPENAI_VIDEO_THUMBNAIL_MODERATION_ENABLED should default to false in .env.example");
  if (!/test:openai-moderation/.test(packageJson)) errors.push("package.json missing test:openai-moderation script");
  if (!/server-only/i.test(setupDoc)) errors.push("openai moderation setup doc should mention server-only key handling");
  if (!/primary server-side moderation provider/i.test(setupDoc)) errors.push("openai moderation setup doc should describe OpenAI as primary provider when enabled");
  if (!/profile avatar \/ banner/i.test(setupDoc)) errors.push("openai moderation setup doc should cover profile images");
  if (!/Full video moderation still not implemented/i.test(watchlistDoc)) errors.push("watchlist should mention full video moderation is not implemented");
  if (!/openai_provider_error_missing_key/.test(moderationTypes)) errors.push("moderation types missing openai_provider_error_missing_key");
  if (!/openai_threshold_review/.test(moderationTypes)) errors.push("moderation types missing openai_threshold_review");
  if (!/isConfigLevelProviderStatus/.test(moderationCore)) errors.push("moderation core missing config-level provider fallback helper");
  if (!/isConfigLevelProviderStatus/.test(moderationAsset)) errors.push("asset moderation missing config-level provider fallback helper");
  if (!/OpenAI missing key degrades to local-only for clean text/.test(moderationTests)) errors.push("missing test for provider missing-key local-only clean text path");
  if (!/flagged false never maps to review by score summary alone/.test(moderationTests)) errors.push("missing test for flagged false allow mapping");

  const srcFiles = await walk(path.resolve(process.cwd(), "src"));
  const distDir = path.resolve(process.cwd(), "dist");
  const distFiles = (await exists("dist")) ? await walk(distDir) : [];

  for (const file of srcFiles) {
    const content = await fs.readFile(file, "utf8");
    const normalized = path.relative(process.cwd(), file).replace(/\\/g, "/");
    if (/PUBLIC_OPENAI/i.test(content)) errors.push(`PUBLIC_OPENAI reference found in src: ${normalized}`);
    if (/from\s+["']openai["']|import\("openai"\)/i.test(content) && !normalized.includes("scripts/")) {
      errors.push(`browser/server SDK import not expected in src: ${normalized}`);
    }
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
