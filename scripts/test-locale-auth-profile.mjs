import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getAuthMessages } from "../src/lib/auth-messages.ts";
import { getUiMessages } from "../src/lib/i18n/catalog.ts";
import { createServer } from "vite";
import { cloudflareWorkersTestPlugin } from "./lib/cloudflare-workers-test-plugin.mjs";
import { resolveLocale } from "../src/lib/i18n/locale.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
for (const file of ["login/index.astro", "auth/callback.astro", "auth/reset-password/index.astro", "me/index.astro", "me/edit.astro", "u/[username].astro", "users/[id].astro"]) {
  const source = await readFile(new URL(`../src/pages/${file}`, import.meta.url), "utf8");
  assert.match(source, /localeContext/, `${file} must use request context`);
  assert.doesNotMatch(source, /locale="zh-CN"/);
}
for (const locale of ["zh-CN", "en"]) {
  const auth = getAuthMessages(locale), ui = getUiMessages(locale).account;
  assert.ok(ui.myProfile && ui.profileUnavailable && ui.editProfile);
  assert.ok(auth.accountMayExist && auth.captchaRetry && auth.resetMismatch);
}
for (const file of ["AuthPanel", "AuthCallback", "ResetPasswordForm"]) {
  const directory = file === "AuthPanel" ? "forum" : "auth";
  const source = await readFile(new URL(`../src/components/${directory}/${file}.tsx`, import.meta.url), "utf8");
  assert.match(source, /useLocale\(/); assert.match(source, /getAuthMessages\(/);
  assert.doesNotMatch(source, /siteverify/i);
}
const originalFetch = globalThis.fetch;
let externalRequests = 0;
globalThis.fetch = async () => { externalRequests++; throw new Error("EXTERNAL_FORBIDDEN"); };
const vite = await createServer({ root: process.cwd(), configFile: false, logLevel: "error", plugins: [cloudflareWorkersTestPlugin()], esbuild: { jsx: "automatic" }, ssr: { external: ["react", "react-dom", "react/jsx-runtime"] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const modules = {};
  for (const [name, directory] of [["AuthPanel", "forum"], ["AuthCallback", "auth"], ["ResetPasswordForm", "auth"], ["MyProfilePage", "profile"], ["EditProfileForm", "profile"], ["ProfilePostCard", "profile"]]) {
    modules[name] = (await vite.ssrLoadModule(`/src/components/${directory}/${name}.tsx`)).default;
  }
  for (const locale of ["en", "zh-CN"]) {
    const localeContext = resolveLocale({ current: locale });
    const render = (name, props = {}) => renderToStaticMarkup(createElement(modules[name], { localeContext, ...props }));
    const auth = getAuthMessages(locale), account = getUiMessages(locale).account;
    for (const initialMode of ["login", "signup"]) {
      const html = render("AuthPanel", { initialMode, captchaMode: "off", next: "/feed/", authAdapter: {} });
      assert.ok(html.includes(initialMode === "login" ? auth.login : auth.signup));
      assert.doesNotMatch(html, /type="checkbox"/);
    }
    assert.ok(render("MyProfilePage").includes(account.loading));
    assert.ok(render("EditProfileForm").includes(account.loading));
    assert.ok(render("AuthCallback").length > 0);
    assert.ok(render("ResetPasswordForm").length > 0);
    const post = render("ProfilePostCard", { id: "owned-post", title: "原始 UGC title", body: "原始 UGC body", circleName: "原始圈子", circleSlug: "owned-circle", createdAt: "2026-10-01T00:00:00Z", likeCount: 2, commentCount: 3, mediaResolved: [] });
    for (const original of ["原始 UGC title", "原始 UGC body", "原始圈子", '/posts/owned-post/', '/circles/owned-circle/']) assert.ok(post.includes(original));
    assert.ok(post.includes(account.viewPost));
  }
  assert.equal(externalRequests, 0);
  console.log("LOCALE_AUTH_PROFILE_CONTRACT=PASS SSR_BOTH_LOCALES=PASS UGC_PRESERVED=PASS EXTERNAL_REQUESTS=0");
} finally { await vite.close(); globalThis.fetch = originalFetch; }
