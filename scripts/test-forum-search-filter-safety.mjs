import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { parseForumSearchParams } = await vite.ssrLoadModule("/src/lib/forum-search.ts");

const parsed = parseForumSearchParams("alpha),role.eq.admin", "all");
if (!parsed.ok) {
  throw new Error("Expected a valid normalized search query");
}
if (/[(),]/.test(parsed.pattern)) {
  throw new Error(`Unsafe PostgREST filter syntax survived normalization: ${parsed.pattern}`);
}

console.log("FORUM_SEARCH_FILTER_SAFETY_OK");
await vite.close();
