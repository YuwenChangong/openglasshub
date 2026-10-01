import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { dev } from "astro";
import cloudflare from "@astrojs/cloudflare";
import { getUiMessages, formatUiMessage } from "../src/lib/i18n/catalog.ts";
import { formatCommunityPostTime } from "../src/lib/i18n/messages/community.ts";
import { formatPostTime } from "../src/lib/format-time.ts";
import { serializePreferenceCookie } from "../src/lib/i18n/preference-cookie.ts";
const files = ["pages/feed/index.astro", "pages/circles/index.astro", "pages/circles/[slug].astro", "pages/posts/[id].astro", "components/community/PostCard.astro", "components/community/CircleCard.astro", "components/community/PostMediaPreview.astro", "components/community/EmptyFeedState.astro", "layouts/ForumLayout.astro"];
for (const file of files) {
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  assert.match(source, /localeContext/, `${file} must read request locale`);
  assert.match(source, /getUiMessages/, `${file} must select community copy`);
  assert.doesNotMatch(source, /toLocaleDateString\("zh-CN"\)/);
}
const now = new Date("2026-10-01T00:10:00Z");
for (const created of ["invalid", "2026-10-01T00:10:00Z", "2026-10-01T00:09:00Z", "2026-10-01T00:01:00Z", "2026-09-30T00:00:00Z"]) {
  assert.equal(formatCommunityPostTime(created, "zh-CN", now), formatPostTime(created, now));
}
assert.equal(formatCommunityPostTime("2026-10-01T00:09:00Z", "en", now), "Posted 1 minute ago");
assert.equal(formatCommunityPostTime("invalid", "en", now), "invalid");
const originalFetch = globalThis.fetch;
let external = 0, server, fixtureRoot;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) { external++; throw new Error("EXTERNAL_FORBIDDEN"); }
  return originalFetch(input, init);
};
try {
  const cache = path.join(process.cwd(), "node_modules/.cache");
  await mkdir(cache, { recursive: true });
  fixtureRoot = await mkdtemp(path.join(cache, "locale-community-"));
  const sourceRoot = path.join(process.cwd(), "src").replaceAll("\\", "/");
  const component = path.join(fixtureRoot, "community.astro");
  await writeFile(component, `---
import ForumLayout from "${sourceRoot}/layouts/ForumLayout.astro";
import PostCard from "${sourceRoot}/components/community/PostCard.astro";
import CircleCard from "${sourceRoot}/components/community/CircleCard.astro";
import EmptyFeedState from "${sourceRoot}/components/community/EmptyFeedState.astro";
import PostMediaPreview from "${sourceRoot}/components/community/PostMediaPreview.astro";
import { getUiMessages } from "${sourceRoot}/lib/i18n/catalog";
const text = getUiMessages(Astro.locals.localeContext.locale).community;
---
<ForumLayout title={text.feed} activeTab="feed">
<PostCard id="owned-post" title="原始 title" excerpt="原始 body" circleName="原始 circle" circleSlug="owned-circle" authorName="原始 author" authorId="owned-author" timestamp="fixed-time" commentCount={3}/>
<CircleCard id="owned-circle" slug="owned-circle" name="原始 circle" description="原始 description"/>
<EmptyFeedState/>
<PostMediaPreview href="/posts/owned-post/" media={[{kind:"video_link",displayUrl:"/owned-media",alt_text:"原始 alt"}]}/>
</ForumLayout>`, "utf8");
  server = await dev({ root: new URL("../", import.meta.url), logLevel: "error", devToolbar: { enabled: false }, server: { host: "127.0.0.1", port: 0 }, adapter: cloudflare({ platformProxy: { enabled: true, remoteBindings: false, envFiles: [], persist: false }, prerenderEnvironment: "node" }), integrations: [{ name: "owned-community-fixture", hooks: { "astro:config:setup": ({ injectRoute }) => injectRoute({ pattern: "/__locale-community/", entrypoint: component, prerender: false }) } }] });
  const origin = `http://127.0.0.1:${server.address.port}`;
  for (const locale of ["en", "zh-CN"]) {
    const cookie = serializePreferenceCookie({ version: 1, preference: locale, generation: 1, provenance: "device_explicit" }).split(";")[0];
    const response = await fetch(`${origin}/__locale-community/`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const html = await response.text(), text = getUiMessages(locale).community;
    for (const label of [text.noPosts, text.noPostsDetail, text.comments, text.details, text.enterCircle, text.publicDiscussion, text.videoLink, text.channels]) assert.ok(html.includes(label), `${locale} missing rendered community label`);
    for (const ugc of ["原始 title", "原始 body", "原始 circle", "原始 author", "原始 description", "原始 alt", "fixed-time", "/posts/owned-post/", "/circles/owned-circle/"]) assert.ok(html.includes(ugc));
    assert.ok(html.includes(formatUiMessage(text.page, { page: 2 })) === false, "fixture cannot invent pagination data");
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  assert.equal(external, 0);
  console.log("LOCALE_COMMUNITY=PASS ACTUAL_ASTRO_SSR_BOTH_LOCALES=PASS UGC_AND_PATHS_PRESERVED=PASS EXTERNAL_REQUESTS=0");
} finally { await server?.stop(); if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true }); globalThis.fetch = originalFetch; }
