import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { dev } from "astro";
import cloudflare from "@astrojs/cloudflare";
import { getUiMessages, formatUiMessage } from "../src/lib/i18n/catalog.ts";
import { formatCommunityPostTime, localizeCommunityStatus } from "../src/lib/i18n/messages/community.ts";
import { formatPostTime } from "../src/lib/format-time.ts";
import { serializePreferenceCookie } from "../src/lib/i18n/preference-cookie.ts";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
const files = ["pages/feed/index.astro", "pages/circles/index.astro", "pages/circles/[slug].astro", "pages/posts/[id].astro", "components/community/PostCard.astro", "components/community/CircleCard.astro", "components/community/PostMediaPreview.astro", "components/community/EmptyFeedState.astro", "layouts/ForumLayout.astro"];
for (const component of ["CreatePostForm", "CreateCircleForm", "CommentForm", "CommentsSection", "CircleOwnerDashboard", "CircleManageEntry", "CircleCoverEditor", "PostSocialActions", "SharePostButton", "PostModerationActions", "PostMediaGallery"]) {
  const source = await readFile(new URL(`../src/components/forum/${component}.tsx`, import.meta.url), "utf8");
  assert.ok(source.includes("useLocale("), `${component} must select interaction copy`);
}
for (const file of files) {
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  assert.match(source, /localeContext/, `${file} must read request locale`);
  assert.match(source, /getUiMessages/, `${file} must select community copy`);
  assert.doesNotMatch(source, /toLocaleDateString\("zh-CN"\)/);
}
const now = new Date("2026-10-01T00:10:00Z");
for (const locale of ["en", "zh-CN"]) {
  const text = getUiMessages(locale).community;
  assert.equal(localizeCommunityStatus("Comment published.", locale), text.commentPublished);
  assert.equal(localizeCommunityStatus("Comment submitted for review.", locale), text.commentReview);
  assert.equal(localizeCommunityStatus("Post published.", locale), text.published);
  assert.equal(localizeCommunityStatus("Post submitted for review.", locale), text.postReview);
  assert.equal(localizeCommunityStatus("原始 unknown status", locale), "原始 unknown status");
}
for (const created of ["invalid", "2026-10-01T00:10:00Z", "2026-10-01T00:09:00Z", "2026-10-01T00:01:00Z", "2026-09-30T00:00:00Z"]) {
  assert.equal(formatCommunityPostTime(created, "zh-CN", now), formatPostTime(created, now));
}
assert.equal(formatCommunityPostTime("2026-10-01T00:09:00Z", "en", now), "Posted 1 minute ago");
assert.equal(formatCommunityPostTime("invalid", "en", now), "invalid");
const originalFetch = globalThis.fetch;
let external = 0, server, fixtureRoot, vite, browser;
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
  await server.stop(); server = undefined;
  await writeFile(path.join(fixtureRoot, "index.html"), '<html><body><main id="root"></main><script type="module" src="/main.tsx"></script></body></html>');
  await writeFile(path.join(fixtureRoot, "main.tsx"), `
import React from "react";
import { createRoot } from "react-dom/client";
import { resolveLocale } from "${sourceRoot}/lib/i18n/locale";
import CommentForm from "${sourceRoot}/components/forum/CommentForm";
import CreateCircleForm from "${sourceRoot}/components/forum/CreateCircleForm";
import CreatePostForm from "${sourceRoot}/components/forum/CreatePostForm";
import ReportTrigger from "${sourceRoot}/components/reports/ReportTrigger";
import PostModerationActions from "${sourceRoot}/components/forum/PostModerationActions";
import NotificationsPage from "${sourceRoot}/components/notifications/NotificationsPage";
import SharePostButton from "${sourceRoot}/components/forum/SharePostButton";
import PostMediaGallery from "${sourceRoot}/components/forum/PostMediaGallery";
const params = new URLSearchParams(location.search);
const localeContext = resolveLocale({current:params.get("locale")});
const common = {localeContext};
const cases = {
 comment:<CommentForm {...common} postId="owned-post"/>,
 circle:<CreateCircleForm {...common} mode="page"/>,
 post:<CreatePostForm {...common}/>,
 report:<ReportTrigger {...common} targetType="post" targetId="owned-post"/>,
 moderation:<PostModerationActions {...common} postId="owned-post" authorId="owned-actor"/>,
 notifications:<NotificationsPage {...common}/>,
 share:<SharePostButton {...common} postPath="/posts/owned-post/"/>,
 media:<PostMediaGallery {...common} postTitle="原始 title" media={[{id:"media",kind:"video_link",displayUrl:"/owned-video",alt_text:"原始 alt"}]}/>,
};
createRoot(document.getElementById("root")).render(cases[params.get("kind")]);
`);
  const authStub = `
const session = {access_token:"owned-local-fixture",user:{id:"owned-actor"}};
const chain = new Proxy({}, {get(target,key) {
 if(key === "then") return resolve => resolve({data:null,error:null,count:0});
 return () => chain;
}});
const client = {auth:{getSession:async()=>({data:{session:new URLSearchParams(location.search).get("anon") ? null : session},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>chain,channel:()=>chain,removeChannel:async()=>{},storage:{from:()=>chain}};
export const createBrowserSupabaseClient = () => client;
export const syncBrowserRealtimeAuth = async () => null;
`;
  vite = await createServer({ root: fixtureRoot, configFile: false, logLevel: "error", plugins: [{ name: "owned-local-auth", enforce: "pre", resolveId(id) { if (/(?:^|\/)supabase-browser(?:\.ts)?$/.test(id)) return "\0owned-local-auth"; }, load(id) { if (id === "\0owned-local-auth") return authStub; } }, react()], server: { host: "127.0.0.1", port: 0, fs: { allow: [process.cwd()] } } });
  await vite.listen(); const browserOrigin = new URL(vite.resolvedUrls.local[0]).origin;
  browser = await chromium.launch({ headless: true, args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
  for (const locale of ["en", "zh-CN"]) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const errors = [], mutations = [];
    let accepted = false;
    let holdMutation = false, releaseMutation;
    let unread = false;
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== browserOrigin) { external++; return route.abort(); }
      if (!url.pathname.startsWith("/api/")) return route.continue();
      let payload = {}, status = 200;
      if (request.method() !== "GET") {
        mutations.push({ path: url.pathname, method: request.method(), body: request.postDataJSON() });
        if (holdMutation) await new Promise(resolve => { releaseMutation = resolve; });
        status = 429; payload = { code: "RATE_LIMITED", error: "RATE_LIMITED" };
        if (accepted && url.pathname === "/api/forum/comments") {
          status = 201; payload = { comment: { id: "owned-comment" }, pending_review: true, message: "Comment submitted for review." };
        }
        if (accepted && url.pathname === "/api/forum/posts") {
          status = 201; payload = { post: { id: "owned-post", status: "pending" }, pending_review: true, message: "Post submitted for review." };
        }
        if (unread && url.pathname === "/api/users/me/notifications") { status = 200; payload = { ok: true }; }
      } else if (url.pathname === "/api/forum/circles") payload = { circles: [{ id: "owned-circle", slug: "owned-circle", name: "原始 circle" }] };
      else if (url.pathname === "/api/forum/posts") payload = { is_author: true, can_moderate: false };
      else if (url.pathname === "/api/users/me/notifications") payload = { ok: true, unread_count: unread ? 1 : 0, notifications: [{ id: "notice", type: "post_like", read_at: unread ? null : "2026-10-01T00:00:00Z", href: "/posts/owned-post/", message: "原始 notification", preview: "原始 preview", created_at: new Date().toISOString(), actor: { id: "owned-actor", display_name: "原始 author" } }] };
      return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    });
    await context.routeWebSocket("**/*", socket => { if (new URL(socket.url()).origin === browserOrigin.replace("http:", "ws:")) socket.connectToServer(); else { external++; socket.close(); } });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    const text = getUiMessages(locale).community;
    const open = async kind => { mutations.length = 0; await page.goto(browserOrigin + "/?" + new URLSearchParams({ kind, locale })); };
    await open("comment");
    await page.getByPlaceholder(text.writeComment).fill("原始 comment body");
    await page.getByRole("button", { name: text.submitComment, exact: true }).click();
    await page.getByText(text.commentRateLimited, { exact: true }).waitFor();
    assert.deepEqual(mutations, [{ path: "/api/forum/comments", method: "POST", body: { post_id: "owned-post", body: "原始 comment body" } }]);
    accepted = true;
    holdMutation = true;
    await open("comment");
    await page.getByPlaceholder(text.writeComment).fill("原始 accepted comment");
    await page.getByRole("button", { name: text.submitComment, exact: true }).click();
    const sending = page.getByRole("button", { name: text.submitting, exact: true });
    await sending.waitFor(); assert.equal(await sending.isDisabled(), true);
    assert.equal(mutations.length, 1); releaseMutation(); holdMutation = false;
    await page.getByText(text.commentReview, { exact: true }).waitFor();
    assert.equal(mutations.length, 1);
    accepted = false;
    await open("circle");
    await page.getByLabel(text.circleName, { exact: true }).fill("原始 circle");
    await page.getByRole("button", { name: text.createCircle, exact: true }).click();
    await page.getByText(text.createRateLimited, { exact: true }).waitFor();
    assert.deepEqual(mutations, [{ path: "/api/forum/circles", method: "POST", body: { name: "原始 circle", description: "", type: "topic", image_path: null } }]);
    await open("post");
    await page.getByLabel(text.title, { exact: true }).fill("原始 post title");
    await page.locator("textarea").fill("原始 post body");
    await page.getByRole("button", { name: text.submitPost, exact: true }).click();
    await page.getByText(text.actionRateLimited, { exact: true }).waitFor();
    assert.equal(mutations.length, 1); assert.equal(mutations[0].body.title, "原始 post title"); assert.equal(mutations[0].body.body, "原始 post body");
    assert.equal(mutations[0].body.circle_slug, "owned-circle"); assert.doesNotMatch(JSON.stringify(mutations[0].body), /consent|locale|preference/);
    accepted = true;
    await open("post");
    await page.getByLabel(text.title, { exact: true }).fill("原始 pending title");
    await page.locator("textarea").fill("原始 pending body");
    await page.getByRole("button", { name: text.submitPost, exact: true }).click();
    await page.getByText(text.postReview, { exact: true }).waitFor();
    assert.equal(mutations.length, 1);
    accepted = false;
    await open("report");
    await page.getByRole("button", { name: text.report, exact: true }).click();
    await page.getByRole("button", { name: text.reportReasons.privacy, exact: true }).click();
    await page.locator("textarea").fill("four"); await page.getByRole("button", { name: text.submitReport, exact: true }).click();
    await page.getByText(text.reportReasonShort, { exact: true }).waitFor(); assert.equal(mutations.length, 0);
    await page.locator("textarea").fill("原始 report details"); await page.getByRole("button", { name: text.submitReport, exact: true }).click();
    await page.getByText(text.reportRateLimited, { exact: true }).waitFor();
    assert.deepEqual(mutations, [{ path: "/api/forum/reports", method: "POST", body: { target_type: "post", target_id: "owned-post", reason_code: "privacy", reason_text: "原始 report details" } }]);
    await open("moderation"); await page.getByRole("button", { name: text.deletePost, exact: true }).click();
    const dialog = page.getByRole("alertdialog"); await dialog.waitFor();
    await dialog.getByRole("button", { name: text.cancel, exact: true }).click(); assert.equal(mutations.length, 0);
    await page.getByRole("button", { name: text.deletePost, exact: true }).click();
    await dialog.getByRole("button", { name: text.confirmDelete, exact: true }).click();
    await page.getByText(new RegExp(text.deleteFailed.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&"))).waitFor(); assert.equal(mutations.length, 1); assert.equal(mutations[0].method, "DELETE");
    await open("notifications"); await page.getByText("原始 notification", { exact: true }).waitFor(); await page.getByText("原始 preview", { exact: true }).waitFor();
    assert.equal(mutations.length, 0); await page.getByRole("button", { name: text.markAllRead, exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: text.markAllRead, exact: true }).isDisabled(), true);
    unread = true;
    const marked = page.waitForResponse(response => response.url().includes("/api/users/me/notifications") && response.request().method() === "PATCH");
    await open("notifications");
    await marked;
    assert.deepEqual(mutations, [{ path: "/api/users/me/notifications", method: "PATCH", body: { action: "mark_all_read" } }]);
    unread = false;
    await open("media"); await page.getByText(text.externalVideoHint, { exact: true }).waitFor(); assert.ok((await page.locator("main").innerText()).includes("原始 alt"));
    await open("share"); await page.getByRole("button", { name: text.share, exact: true }).waitFor();
    assert.deepEqual(errors, []); await context.close();
  }
  assert.equal(external, 0);
  console.log("LOCALE_COMMUNITY=PASS ACTUAL_ASTRO_SSR_BOTH_LOCALES=PASS INTERACTION_PAYLOADS_AND_SINGLE_SEND=PASS UGC_AND_PATHS_PRESERVED=PASS EXTERNAL_REQUESTS=0");
} finally {
  await browser?.close(); await vite?.close(); await server?.stop();
  if (fixtureRoot) {
    const relative = path.relative(path.join(process.cwd(), "node_modules/.cache"), path.resolve(fixtureRoot));
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    await rm(fixtureRoot, { recursive: true, force: true });
  }
  globalThis.fetch = originalFetch;
}
