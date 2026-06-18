import fs from "node:fs/promises";
import path from "node:path";

const REQUIRED_FILES = [
  "src/lib/moderation/moderation-types.ts",
  "src/lib/moderation/moderation-policy.ts",
  "src/lib/moderation/sensitive-terms.server.ts",
  "src/lib/moderation/moderate-content.server.ts",
  "src/lib/moderation/moderation-provider.server.ts",
  "src/pages/api/admin/moderation/queue.ts",
  "src/pages/api/admin/moderation/approve.ts",
  "src/pages/api/admin/moderation/reject.ts",
  "src/pages/api/admin/moderation/hide.ts",
  "src/pages/admin/moderation/index.astro",
];

function parseArgs(argv) {
  return {
    strict: argv.includes("--strict"),
    verbose: argv.includes("--verbose"),
  };
}

async function exists(filePath) {
  try {
    await fs.access(path.resolve(process.cwd(), filePath));
    return true;
  } catch {
    return false;
  }
}

async function read(filePath) {
  return fs.readFile(path.resolve(process.cwd(), filePath), "utf8");
}

function fail(errors, message) {
  errors.push(message);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const errors = [];
  const warnings = [];

  for (const file of REQUIRED_FILES) {
    if (!(await exists(file))) fail(errors, `missing required file: ${file}`);
  }

  const postsApi = await read("src/pages/api/forum/posts.ts");
  const commentsApi = await read("src/pages/api/forum/comments.ts");
  const moderationPage = await read("src/pages/admin/moderation/index.astro");
  const moderationComponent = await read("src/components/admin/AdminModerationQueue.tsx");
  const sensitiveTermsSource = await read("src/lib/moderation/sensitive-terms.server.ts");
  const moderationCore = await read("src/lib/moderation/moderate-content.server.ts");
  const feedSource = await read("src/lib/forum-feed.ts");
  const searchSource = await read("src/lib/forum-search.ts");
  const profileSource = await read("src/lib/profile-data.ts");
  const engagementSource = await read("src/lib/post-engagement.ts");
  const postDetailSource = await read("src/pages/posts/[id].astro");
  const commentsSource = await read("src/pages/api/forum/comments.ts");
  const circlePageSource = await read("src/pages/circles/[slug].astro");
  const homePageSource = await read("src/pages/index.astro");

  if (!postsApi.includes("moderateContent(")) fail(errors, "posts API does not call moderateContent");
  if (!commentsApi.includes("moderateContent(")) fail(errors, "comments API does not call moderateContent");
  if (!postsApi.includes("pending_review")) fail(errors, "posts API missing pending_review handling");
  if (!commentsApi.includes("pending_review")) fail(errors, "comments API missing pending_review handling");
  if (!moderationCore.includes('return buildResult("allow"')) fail(errors, "moderation core missing default allow result");
  if (!postsApi.includes('moderation_status: moderation.decision === "review" ? "pending_review" : "published"')) fail(errors, "posts API missing published moderation_status allow branch");
  if (!commentsApi.includes('moderation_status: moderation.decision === "review" ? "pending_review" : "published"')) fail(errors, "comments API missing published moderation_status allow branch");
  if (!feedSource.includes('.eq("moderation_status", "published")')) fail(errors, "forum feed missing moderation_status published filter");
  if (!searchSource.includes('.eq("moderation_status", "published")')) fail(errors, "forum search missing moderation_status published filter");
  if (!profileSource.includes('.eq("moderation_status", "published")')) fail(errors, "profile data missing moderation_status published filter");
  if (!engagementSource.includes('.eq("moderation_status", "published")')) fail(errors, "post engagement comment counts missing moderation_status published filter");
  if (!postDetailSource.includes('.eq("moderation_status", "published")')) fail(errors, "post detail missing moderation_status published filter");
  if (!circlePageSource.includes('.eq("moderation_status", "published")')) fail(errors, "circle page missing moderation_status published filter");
  if (!homePageSource.includes('.eq("moderation_status", "published")')) fail(errors, "homepage missing moderation_status published filter");
  if (!commentsSource.includes('viewerUserId === c.author_id')) fail(errors, "comments API missing owner-only pending visibility handling");
  if (!moderationPage.includes("AdminModerationQueue")) fail(errors, "admin moderation page not wired");
  if (!moderationComponent.includes("/api/admin/moderation/approve")) fail(errors, "moderation queue missing approve action");
  if (!moderationComponent.includes("/api/admin/moderation/reject")) fail(errors, "moderation queue missing reject action");
  if (!moderationComponent.includes("/api/admin/moderation/hide")) fail(errors, "moderation queue missing hide action");
  if (!moderationComponent.includes('item.moderation_status === "pending_review"')) fail(errors, "admin moderation queue missing handled-state action guard");

  const clientRoots = ["src/components", "src/pages"];
  for (const root of clientRoots) {
    const files = await walk(path.resolve(process.cwd(), root));
    for (const file of files) {
      const content = await fs.readFile(file, "utf8");
      if (/sensitive-terms\.server|moderate-content\.server|moderation-provider\.server/i.test(content)) {
        const normalized = path.relative(process.cwd(), file).replace(/\\/g, "/");
        if (!normalized.startsWith("src/pages/api/")) {
          fail(errors, `client/public path imports server moderation file: ${normalized}`);
        }
      }
    }
  }

  const srcFiles = await walk(path.resolve(process.cwd(), "src"));
  for (const file of srcFiles) {
    const content = await fs.readFile(file, "utf8");
    const normalized = path.relative(process.cwd(), file).replace(/\\/g, "/");
    if (/MODERATION_PROVIDER|MODERATION_FAIL_MODE/.test(content) && !/src\/lib\/moderation\/|src\/pages\/api\//.test(normalized)) {
      fail(errors, `moderation env referenced outside server paths: ${normalized}`);
    }
    if (/window\.confirm|window\.alert|window\.prompt/.test(content)) {
      fail(errors, `native browser dialog found: ${normalized}`);
    }
    if (/SUPABASE_SERVICE_ROLE_KEY|service_role/.test(content)) {
      fail(errors, `service role reference found in src: ${normalized}`);
    }
  }

  if (!/obvious|spam|scam/i.test(sensitiveTermsSource)) {
    warnings.push("sensitive terms source looks unexpectedly small; manual review recommended");
  }

  const migrationFiles = (await walk(path.resolve(process.cwd(), "supabase/migrations")))
    .map((file) => path.relative(process.cwd(), file).replace(/\\/g, "/"))
    .filter((file) => file.includes("moderation") || file.includes("20260616_community_moderation_mvp.sql"));

  console.log(`required files: ${REQUIRED_FILES.length}`);
  console.log(`migration files: ${migrationFiles.length}`);
  console.log(`errors: ${errors.length}`);
  console.log(`warnings: ${warnings.length}`);

  if (args.verbose) {
    migrationFiles.forEach((file) => console.log(`- migration: ${file}`));
    warnings.forEach((warning) => console.log(`- warning: ${warning}`));
  }

  if (args.strict && (errors.length > 0 || warnings.length > 0)) {
    if (errors.length > 0) {
      console.error("\nMODERATION AUDIT FAILED");
      errors.forEach((error) => console.error(`- ${error}`));
    }
    if (warnings.length > 0) {
      console.error("\nMODERATION AUDIT WARNINGS");
      warnings.forEach((warning) => console.error(`- ${warning}`));
    }
    process.exitCode = 1;
    return;
  }

  if (errors.length > 0) {
    console.error("\nMODERATION AUDIT FAILED");
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  console.log("\nMODERATION AUDIT PASSED");
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

main().catch((error) => {
  console.error("audit-moderation failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
