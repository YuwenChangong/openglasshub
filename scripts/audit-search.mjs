import fs from "node:fs/promises";
import path from "node:path";

const SEARCH_SOURCE_FILES = [
  "src/lib/forum-search.ts",
  "src/lib/search-types.ts",
  "src/pages/api/forum/search.ts",
  "src/pages/search/index.astro",
  "src/components/community/GlobalSearchBox.tsx",
];

const FORBIDDEN_SOURCE_TERMS = [
  "category_scores",
  "sourceurl",
];

const REQUIRED_SOURCE_PATTERNS = [
  /posts/i,
  /circles/i,
  /people/i,
  /devices/i,
  /counts/i,
  /No results found/i,
  /Try another keyword/i,
];

const DIST_TERMS = [
  "category_scores",
  "sourceurl",
  "@example.com",
  "supabase_service_role_key",
  "openai_api_key",
];

function parseArgs(argv) {
  const getValue = (flag, fallback = null) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] ?? fallback : fallback;
  };

  return {
    dist: getValue("--dist", "dist"),
    strict: argv.includes("--strict"),
    verbose: argv.includes("--verbose"),
  };
}

async function exists(target) {
  try {
    await fs.access(target);
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

function isSearchClientAsset(file) {
  const normalized = file.replace(/\\/g, "/");
  return (
    normalized.endsWith("/search/index.html") ||
    normalized.includes("/GlobalSearchBox") ||
    /\/search[\/._-]/i.test(normalized) ||
    /_astro\/.*search/i.test(normalized)
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const errors = [];
  const root = process.cwd();

  const sourceContents = await Promise.all(
    SEARCH_SOURCE_FILES.map(async (file) => ({ file, content: await fs.readFile(path.resolve(root, file), "utf8") })),
  );

  for (const { file, content } of sourceContents) {
    const lowered = content.toLowerCase();
    for (const term of FORBIDDEN_SOURCE_TERMS) {
      if (lowered.includes(term)) {
        errors.push(`forbidden search source term in ${file}: ${term}`);
      }
    }
  }

  const combined = sourceContents.map((entry) => entry.content).join("\n");
  for (const pattern of REQUIRED_SOURCE_PATTERNS) {
    if (!pattern.test(combined)) {
      errors.push(`missing required search UX pattern: ${pattern}`);
    }
  }

  const distPath = path.resolve(root, args.dist);
  let distFiles = [];
  if (await exists(distPath)) {
    distFiles = (await walk(distPath)).filter(isSearchClientAsset);
    for (const file of distFiles) {
      const content = await fs.readFile(file, "utf8").catch(() => null);
      if (!content) continue;
      const lowered = content.toLowerCase();
      for (const term of DIST_TERMS) {
        if (lowered.includes(term)) {
          errors.push(`forbidden dist term in ${path.relative(root, file)}: ${term}`);
        }
      }
    }
  } else if (args.strict) {
    errors.push(`dist not found at ${distPath}`);
  }

  console.log(`search source files scanned: ${sourceContents.length}`);
  console.log(`search dist files scanned: ${distFiles.length}`);
  console.log(`search audit errors: ${errors.length}`);

  if (args.verbose && errors.length > 0) {
    for (const error of errors) console.log(`- ${error}`);
  }

  if (errors.length > 0) {
    console.error("\nSEARCH AUDIT FAILED");
    process.exitCode = 1;
    return;
  }

  console.log("\nSEARCH AUDIT PASSED");
}

main().catch((error) => {
  console.error("search audit failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
