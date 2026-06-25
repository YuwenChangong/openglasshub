import fs from "node:fs/promises";
import path from "node:path";

const SIGNED_URL_PATTERNS = [
  /supabase\.co\/storage\/v1\/object\/sign\//i,
  /[?&]token=[A-Za-z0-9._%-]+/i,
  /X-Amz-Signature=/i,
];

const PUBLIC_PAGE_PATHS = ["/", "/feed/", "/circles/", "/search/?q=ar"];
const SRC_FILES = [
  "src/lib/profile-media.ts",
  "src/lib/circle-cover.ts",
  "src/lib/forum-media.ts",
  "src/lib/moderation/openai-moderation-provider.server.ts",
  "src/pages/posts/[id].astro",
  "src/pages/feed/index.astro",
  "src/pages/index.astro",
  "src/pages/circles/[slug].astro",
  "src/pages/circles/index.astro",
  "src/pages/search/index.astro",
];

function parseArgs(argv) {
  const getValue = (flag, fallback = null) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] ?? fallback : fallback;
  };

  return {
    dist: getValue("--dist", "dist"),
    url: getValue("--url"),
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

function findSignedUrlHits(content) {
  return SIGNED_URL_PATTERNS.filter((pattern) => pattern.test(content)).map((pattern) => pattern.source);
}

async function scanFiles(files) {
  const hits = [];
  for (const file of files) {
    const content = await fs.readFile(file, "utf8").catch(() => null);
    if (content == null) continue;
    const matched = findSignedUrlHits(content);
    if (matched.length > 0) {
      hits.push({
        file: path.relative(process.cwd(), file).replace(/\\/g, "/"),
        matches: matched,
      });
    }
  }
  return hits;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "OpenGlassHubMediaPrivacyAudit/1.0",
      accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    },
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await response.text(),
  };
}

async function scanRemote(url) {
  const hits = [];
  for (const route of PUBLIC_PAGE_PATHS) {
    const target = new URL(route, url).toString();
    const result = await fetchText(target);
    if (!result.ok) {
      hits.push({ file: target, matches: [`http_${result.status}`] });
      continue;
    }
    const matched = findSignedUrlHits(result.body);
    if (matched.length > 0) {
      hits.push({ file: target, matches: matched });
    }
  }
  return hits;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const errors = [];
  const distPath = path.resolve(process.cwd(), args.dist);

  if (!(await exists(distPath))) {
    console.error(`dist not found at ${distPath}; run npm run build first.`);
    process.exitCode = 1;
    return;
  }

  const distFiles = (await walk(distPath)).filter((file) => {
    const relative = path.relative(distPath, file).replace(/\\/g, "/");
    return (
      relative.startsWith("_astro/") ||
      relative.endsWith(".html") ||
      relative.endsWith(".css") ||
      relative.endsWith(".js") ||
      relative.endsWith(".json") ||
      relative.endsWith(".xml") ||
      relative.endsWith(".txt")
    );
  });
  const distHits = await scanFiles(distFiles);

  const srcContents = await Promise.all(
    SRC_FILES.map(async (file) => ({
      file,
      content: await fs.readFile(path.resolve(process.cwd(), file), "utf8"),
    })),
  );

  const profileMediaSource = srcContents.find((entry) => entry.file.endsWith("profile-media.ts"))?.content ?? "";
  const circleCoverSource = srcContents.find((entry) => entry.file.endsWith("circle-cover.ts"))?.content ?? "";
  const forumMediaSource = srcContents.find((entry) => entry.file.endsWith("forum-media.ts"))?.content ?? "";
  const openAiProviderSource = srcContents.find((entry) => entry.file.endsWith("openai-moderation-provider.server.ts"))?.content ?? "";

  if (!/PROFILE_MEDIA_EXPIRES_IN\s*=\s*10\s*\*\s*60/.test(profileMediaSource)) {
    errors.push("profile media TTL is not reduced to 10 minutes");
  }
  if (!/CIRCLE_COVER_EXPIRES_IN\s*=\s*10\s*\*\s*60/.test(circleCoverSource)) {
    errors.push("circle cover TTL is not reduced to 10 minutes");
  }
  if (!/publicProxy/.test(forumMediaSource)) {
    errors.push("forum media resolver is missing public proxy support");
  }
  if (!/redactSignedUrl/.test(openAiProviderSource)) {
    errors.push("OpenAI moderation provider is missing signed URL redaction");
  }

  let remoteHits = [];
  if (args.url) {
    remoteHits = await scanRemote(args.url);
  }

  if (distHits.length > 0) {
    errors.push(`signed media URL pattern found in dist files: ${distHits.length}`);
  }
  if (remoteHits.length > 0) {
    errors.push(`signed media URL pattern found in remote public pages: ${remoteHits.length}`);
  }

  console.log(`dist files scanned: ${distFiles.length}`);
  console.log(`dist hits: ${distHits.length}`);
  console.log(`remote hits: ${remoteHits.length}`);
  console.log(`source checks: ${SRC_FILES.length}`);
  console.log(`errors: ${errors.length}`);

  if (args.verbose) {
    for (const hit of distHits) {
      console.log(`[dist] ${hit.file} -> ${hit.matches.join(", ")}`);
    }
    for (const hit of remoteHits) {
      console.log(`[remote] ${hit.file} -> ${hit.matches.join(", ")}`);
    }
    for (const error of errors) {
      console.log(`[error] ${error}`);
    }
  }

  if (errors.length > 0) {
    console.error("\nMEDIA URL PRIVACY AUDIT FAILED");
    process.exitCode = 1;
    return;
  }

  console.log("\nMEDIA URL PRIVACY AUDIT PASSED");
}

main().catch((error) => {
  console.error("media url privacy audit failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
