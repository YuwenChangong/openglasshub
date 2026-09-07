import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { unstable_readConfig } from "wrangler";

import { resolveSiteOrigin } from "../src/lib/site-origin.ts";

const root = process.cwd();
const node = process.execPath;
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const localWorkerConfig = path.join(root, "dist", "server", "wrangler.json");

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === "string") throw new Error("LOCAL_SEARCH_TEST_PORT_UNAVAILABLE");
  return address.port;
}

async function waitForResponse(url, child) {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`LOCAL_SEARCH_TEST_WORKER_EXIT_${child.exitCode}`);
    try {
      return await fetch(url, { signal: AbortSignal.timeout(1_000) });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`LOCAL_SEARCH_TEST_WORKER_TIMEOUT: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
}

async function stopWorker(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
    setTimeout(resolve, 5_000).unref();
  });
}

function metadataValues(html, tagPattern, attribute) {
  return [...html.matchAll(tagPattern)].map((match) => match[0].match(attribute)?.[1]).filter(Boolean);
}

async function assertRenderedSearchSeo() {
  const productionConfig = unstable_readConfig(
    { config: path.join(root, "wrangler.toml"), env: "production" },
    { hideWarnings: true },
  );
  const origin = resolveSiteOrigin(productionConfig.vars?.SITE_ORIGIN);
  execFileSync(node, ["scripts/build-workers.mjs"], { cwd: root, stdio: "pipe" });

  const port = await availablePort();
  const child = spawn(node, [
    wrangler, "dev", "--config", localWorkerConfig, "--local", "--ip", "127.0.0.1", "--port", String(port),
    "--var", "SUPABASE_URL:http://127.0.0.1:1", "--var", "SUPABASE_ANON_KEY:local-search-test-key",
  ], { cwd: root, stdio: "ignore", windowsHide: true });
  try {
    for (const route of ["/search/", "/search/?q=x"]) {
      const response = await waitForResponse(`http://127.0.0.1:${port}${route}`, child);
      assert.equal(response.status, 200, `${route} must render locally`);
      const html = await response.text();
      const canonical = metadataValues(html, /<link\b[^>]*\brel=["']canonical["'][^>]*>/gi, /\bhref=["']([^"']+)["']/i);
      const ogUrl = metadataValues(html, /<meta\b[^>]*\bproperty=["']og:url["'][^>]*>/gi, /\bcontent=["']([^"']+)["']/i);
      assert.deepEqual(canonical, [`${origin}/search/`], `${route} must render one base canonical`);
      assert.deepEqual(ogUrl, [`${origin}/search/`], `${route} must render one base og:url`);
    }

    const workingResponse = await waitForResponse(`http://127.0.0.1:${port}/terms/`, child);
    assert.equal(workingResponse.status, 200, "established Terms page must remain locally renderable");
    const workingCanonical = metadataValues(await workingResponse.text(), /<link\b[^>]*\brel=["']canonical["'][^>]*>/gi, /\bhref=["']([^"']+)["']/i);
    assert.deepEqual(workingCanonical, [`${origin}/terms/`], "established Terms canonical must remain unchanged");
  } finally {
    await stopWorker(child);
  }
}

function sanitizeSearchInput(raw) {
  return String(raw)
    .trim()
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseForumSearchParams(rawQuery, rawType, rawCircle) {
  const query = sanitizeSearchInput(rawQuery);
  const circleSlug = String(rawCircle ?? "").trim().toLowerCase() || null;
  const type = circleSlug
    ? "posts"
    : ["posts", "circles", "users", "devices", "all"].includes(rawType)
      ? rawType
      : "all";

  if (query.length < 2 || query.length > 80) {
    return { ok: false, error: "INVALID_QUERY" };
  }

  return { ok: true, query, type, pattern: `%${query}%`, circleSlug };
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function scoreSearchText(value, query) {
  const candidate = normalizeSearchText(value);
  const normalizedQuery = normalizeSearchText(query);
  if (!candidate || !normalizedQuery) return 0;
  if (candidate === normalizedQuery) return 160;
  if (candidate.startsWith(`${normalizedQuery} `) || candidate.startsWith(normalizedQuery)) return 128;
  if (candidate.split(/[^\p{L}\p{N}]+/u).includes(normalizedQuery)) return 108;
  if (candidate.includes(normalizedQuery)) return 84;
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => candidate.includes(token))) return 48;
  return 0;
}

function buildExcerpt(body, maxLength = 120) {
  const text = String(body ?? "")
    .replace(/[#*_`>\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function read(relativePath) {
  return fs.readFile(path.resolve(root, relativePath), "utf8");
}

async function main() {
  assert.equal(sanitizeSearchInput("  XREAL   One  "), "XREAL One");
  assert.equal(sanitizeSearchInput("__RayNeo%%"), "RayNeo");
  assert.equal(buildExcerpt("hello world", 20), "hello world");
  assert.equal(buildExcerpt("1234567890", 5), "12345...");

  const chinese = parseForumSearchParams("测试", "all");
  assert.equal(chinese.ok, true);
  if (chinese.ok) {
    assert.equal(chinese.query, "测试");
    assert.equal(chinese.type, "all");
  }

  const english = parseForumSearchParams("AR glasses", "devices");
  assert.equal(english.ok, true);
  if (english.ok) {
    assert.equal(english.type, "devices");
    assert.equal(english.pattern, "%AR glasses%");
  }

  const invalid = parseForumSearchParams("a", "all");
  assert.equal(invalid.ok, false);
  assert.equal(parseForumSearchParams("x".repeat(81), "all").ok, false);
  assert.equal(parseForumSearchParams("xreal),status.eq.hidden", "all").ok, true);

  assert(scoreSearchText("XREAL One", "xreal") > scoreSearchText("A nice display device", "xreal"));
  assert(scoreSearchText("RayNeo X2", "rayneo x2") >= scoreSearchText("RayNeo smart glasses", "rayneo x2"));

  const forumSearchSource = await read("src/lib/forum-search.ts");
  const apiSource = await read("src/pages/api/forum/search.ts");
  const pageSource = await read("src/pages/search/index.astro");
  const typeSource = await read("src/lib/search-types.ts");

  assert(/minQueryLength: MIN_QUERY_LENGTH/.test(forumSearchSource), "search limits should still be exported");
  assert(/\.eq\("status", "published"\)/.test(forumSearchSource), "posts search must filter published status");
  assert(/\.eq\("moderation_status", "published"\)/.test(forumSearchSource), "posts search must filter moderation_status published");
  assert(/isPublicVisibleCircle/.test(forumSearchSource), "circle visibility helper must be used");
  assert(/isActivePublicSearchCircle/.test(forumSearchSource), "search must fail closed for missing, inactive, or hidden parent circles");
  assert(/circles:circle_id\(id,slug,name,status\)/.test(forumSearchSource), "post results must load parent-circle visibility fields");
  assert(/\[\^\\p\{L\}\\p\{N\}\\s-\]\+/.test(forumSearchSource), "query text must exclude PostgREST filter grammar");
  assert(/ForumSearchType = "all" \| "posts" \| "circles" \| "users" \| "devices"/.test(typeSource), "search types must include users/devices");
  assert(/ForumSearchUserResult/.test(typeSource) && /ForumSearchDeviceResult/.test(typeSource), "search result types must include users/devices");
  assert(/counts: ForumSearchCounts/.test(typeSource), "search results must include counts");
  assert(/limit_users/.test(apiSource) && /limit_devices/.test(apiSource), "API must accept users/devices limits");
  assert(/People/.test(pageSource) && /Devices/.test(pageSource), "search page must render people/devices sections");
  assert(!/email/i.test(typeSource), "search types must not expose email");

  await assertRenderedSearchSeo();

  console.log("SEARCH TEST PASSED");
}

main().catch((error) => {
  console.error("SEARCH TEST FAILED");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
