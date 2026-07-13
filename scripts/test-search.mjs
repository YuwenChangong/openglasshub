import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

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

  console.log("SEARCH TEST PASSED");
}

main().catch((error) => {
  console.error("SEARCH TEST FAILED");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
