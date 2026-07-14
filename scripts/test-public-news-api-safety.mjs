import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const root = process.cwd();

function payload() {
  return {
    articles: [{ id: "news-1", slug: "safe-news", title: "Safe news" }],
    featuredArticle: null,
    hotArticles: [],
    total: 1,
    page: 2,
    limit: 7,
    total_pages: 1,
    hasMore: false,
  };
}

async function main() {
  const routePath = path.join(root, "src/pages/api/news.ts");
  const helperPath = path.join(root, "src/lib/news.ts");
  const [routeSource, helperSource] = await Promise.all([readFile(routePath, "utf8"), readFile(helperPath, "utf8")]);

  assert.match(routeSource, /parsePublicNewsQuery/);
  assert.match(routeSource, /NEWS_UNAVAILABLE/);
  assert.match(routeSource, /NEWS_FETCH_FAILED/);
  assert.doesNotMatch(routeSource, /\bfetch\(|Authorization|request\.headers\.get/);
  assert.match(helperSource, /normalizePublicNewsArticle/);
  assert.match(helperSource, /isPrivateOrLocalHostname/);
  assert.doesNotMatch(helperSource.match(/export async function listPublicNewsFeed[\s\S]*?(?=export async function getPublicNewsArticleBySlug)/)?.[0] ?? "", /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|\bfetch\(/);

  const vite = await createServer({ root, logLevel: "error", server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
  try {
    const route = await vite.ssrLoadModule("/src/pages/api/news.ts");
    const news = await vite.ssrLoadModule("/src/lib/news.ts");
    const { createPublicNewsGet, parsePublicNewsPositiveInt, parsePublicNewsQuery } = route;
    const { listPublicNewsFeed, normalizeNewsUrl, normalizePublicNewsArticle } = news;

    assert.equal(parsePublicNewsPositiveInt(null, 5, 12), 5);
    assert.equal(parsePublicNewsPositiveInt("12", 5, 12), 12);
    for (const value of ["0", "01", "1x", "100", "-1", " 2", "2 ", "\u0000", "9999"]) assert.equal(parsePublicNewsPositiveInt(value, 5, 12), null, value);
    assert.deepEqual(parsePublicNewsQuery(new URL("https://app.example/api/news?category=devices&page=2&limit=7")), { category: "devices", page: 2, limit: 7 });
    for (const search of ["?category=https://internal.example", "?category=DEVICES", "?page=1x", "?page=1001", "?limit=13", "?limit=0", "?limit=%00"]) assert.equal(parsePublicNewsQuery(new URL(`https://app.example/api/news${search}`)), null, search);

    assert.equal(normalizeNewsUrl("https://example.com/news"), "https://example.com/news");
    for (const unsafeUrl of ["javascript:alert(1)", "data:text/html,boom", "https://user:password@example.com/news", "http://127.0.0.1/private", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "https://localhost/admin"]) assert.equal(normalizeNewsUrl(unsafeUrl), null, unsafeUrl);
    const safeArticle = normalizePublicNewsArticle({
      id: "news-1",
      slug: "safe-news",
      title: "<script>alert(1)</script> Safe title",
      summary: "<img src=x onerror=alert(1)> Summary",
      content: "<script>alert(1)</script>Body [link](javascript:alert(1))",
      cover_image_url: "data:image/svg+xml,boom",
      source_name: "<b>Source</b>",
      source_url: "https://user:password@example.com/news",
      category: "industry",
      status: "published",
      author_id: "private-author-id",
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    });
    assert.ok(safeArticle);
    assert.doesNotMatch(safeArticle.title, /<script/i);
    assert.doesNotMatch(safeArticle.summary, /<img/i);
    assert.doesNotMatch(safeArticle.content, /<script/i);
    assert.equal(safeArticle.cover_image_url, null);
    assert.equal(safeArticle.source_url, null);
    assert.equal(safeArticle.author_id, null);
    assert.equal(normalizePublicNewsArticle({ ...safeArticle, status: "draft" }), null);
    assert.equal(normalizePublicNewsArticle({ ...safeArticle, category: "unexpected" }), null);

    const effects = { client: 0, reads: 0, outbound: 0, writes: 0, cache: 0 };
    let lastOptions;
    const handler = createPublicNewsGet({
      createSSRClient: () => {
        effects.client += 1;
        return {};
      },
      listPublicNewsFeed: async (_client, options) => {
        effects.reads += 1;
        lastOptions = options;
        return payload();
      },
    });
    const run = async (search = "", env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon" }, headers = {}) => {
      const response = await handler({
        request: new Request(`https://app.example/api/news${search}`, { headers }),
        locals: { runtime: { env } },
      });
      return response;
    };

    const allowed = await run("?category=devices&page=2&limit=7");
    assert.equal(allowed.status, 200);
    assert.deepEqual(lastOptions, { filter: "devices", page: 2, limit: 7 });
    assert.equal(effects.client, 1);
    assert.equal(effects.reads, 1);

    const publicWithBearer = await run("?category=devices&page=2&limit=7", undefined, { authorization: "Bearer malformed" });
    assert.equal(publicWithBearer.status, 200);
    assert.equal(effects.reads, 2, "bearer input does not change the public database-read branch");

    for (const search of ["?category=https://localhost", "?page=1x", "?page=1001", "?limit=13", "?limit=0", "?limit=%00"]) {
      const readsBefore = effects.reads;
      const response = await run(search);
      assert.equal(response.status, 400, search);
      assert.equal(effects.reads, readsBefore, `${search} stops before the public news read`);
    }
    assert.equal(effects.outbound + effects.writes + effects.cache, 0, "the route has no provider fetch, cache, or persistent effect");

    const unavailable = await run("", {});
    assert.equal(unavailable.status, 500);
    assert.deepEqual(await unavailable.json(), { error: "NEWS_UNAVAILABLE" });

    const failingHandler = createPublicNewsGet({
      createSSRClient: () => ({}),
      listPublicNewsFeed: async () => { throw new Error("provider token=secret internal.example"); },
    });
    const failed = await failingHandler({
      request: new Request("https://app.example/api/news"),
      locals: { runtime: { env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon" } } },
    });
    assert.equal(failed.status, 500);
    const failedBody = await failed.text();
    assert.deepEqual(JSON.parse(failedBody), { error: "NEWS_FETCH_FAILED" });
    assert.doesNotMatch(failedBody, /secret|internal\.example/i);

    assert.doesNotMatch(listPublicNewsFeed.toString(), /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|\bfetch\(/);
  } finally {
    await vite.close();
  }

  console.log(JSON.stringify({
    provider: "none; public news is an anon-RLS Supabase read only",
    allowed: ["allowlisted category", "bounded page and limit", "ordinary/malformed bearer has the same public result", "safe published rows"],
    deniedOrSanitized: ["invalid category/page/limit before database read", "javascript/data/credentialed/local URLs", "HTML tags and controls", "nonpublished or invalid-category rows", "raw helper errors"],
    effects: "no provider fetch, cache, write, user state, or real network/database operation",
  }));
}

await main();
