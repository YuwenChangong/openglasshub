import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { getUiMessages } from "../src/lib/i18n/catalog.ts";
import { resolveLocale } from "../src/lib/i18n/locale.ts";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const names = ["UsersDashboard", "ReportsPanel", "NewsDashboard", "ModerationQueue", "MediaDashboard", "ForumDashboard", "DevicesDashboard", "CirclesDashboard"];
const base = "318a252d8b8e6489044b322c3e9eefd72e9d6e08";
for (const locale of ["zh-CN", "en"]) {
  const admin = getUiMessages(locale).admin;
  assert.ok(admin, `${locale} admin catalog must exist`);
  for (const value of [admin.reports.filters.status.all, admin.reports.filters.target.all,
    admin.reports.actions.dismiss.label, admin.reports.actions.hide_target.label, admin.reports.actions.ban_user.label]) {
    assert.equal(typeof value, "string"); assert.ok(value.trim());
  }
}
for (const name of names) {
  const source = await readFile(`src/components/admin/Admin${name}.tsx`, "utf8");
  assert.match(source, /useLocale\(localeContext\)/, `${name} consumes request locale`);
  assert.match(source, /getUiMessages\(locale\)\.admin/, `${name} consumes admin messages`);
}
for (const page of ["users", "reports", "news", "moderation", "media", "forum", "devices", "circles"]) {
  const source = await readFile(`src/pages/admin/${page}/index.astro`, "utf8");
  assert.match(source, /localeContext=\{Astro\.locals\.localeContext\}/, `${page} island receives SSR snapshot`);
}
for (const file of ["src/components/admin/useAdminSession.ts", "src/lib/server/moderation-notifications.server.ts", "src/lib/server/admin-auth.ts"]) {
  assert.equal((await readFile(file, "utf8")).replaceAll("\r\n", "\n"), execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" }).replaceAll("\r\n", "\n"), `${file} security contract unchanged`);
}

let externalRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { externalRequests++; throw new Error("EXTERNAL_FORBIDDEN"); };
const requests = [];
const fixture = { state: { status: "checking", message: "正在确认登录状态..." }, session: null, me: null, supabase: null, setState() {} };
globalThis.__localeAdminFixture = fixture;
globalThis.__localeAdminFetch = async (path, options) => {
  requests.push({ path, method: options.method ?? "GET", body: options.body, session: options.session });
  assert.equal(options.session, fixture.session, "existing verified session is passed unchanged");
  return { users: [], reports: [], articles: [], items: [], media: [], posts: [], devices: [], circles: [] };
};
const vite = await createServer({ configFile: false, logLevel: "error", plugins: [{
  name: "owned-admin-fixtures", enforce: "pre",
  load(id) {
    if (/\/admin\/useAdminSession\.ts$/.test(id.replaceAll("\\", "/"))) return "export function useAdminSession(){return globalThis.__localeAdminFixture;}";
    if (/\/admin-api-client\.ts$/.test(id.replaceAll("\\", "/"))) return "export class AdminApiError extends Error{};export const adminFetch=(...args)=>globalThis.__localeAdminFetch(...args);";
  },
}], esbuild: { jsx: "automatic" }, ssr: { external: ["react", "react-dom", "react/jsx-runtime"] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const modules = {};
  for (const name of names) modules[name] = (await vite.ssrLoadModule(`/src/components/admin/Admin${name}.tsx`)).default;
  for (const locale of ["zh-CN", "en"]) {
    const localeContext = resolveLocale({ current: locale });
    for (const [status, message] of [["checking", "正在确认登录状态..."], ["signed_out", "请先登录"], ["forbidden", "当前账号没有管理员权限"], ["error", "管理员权限确认失败"], ["ready", "管理员权限已确认"]]) {
      fixture.state = { status, message };
      fixture.session = status === "ready" ? { access_token: "owned-fixture-only" } : null;
      fixture.me = status === "ready" ? { user_id: "owned-admin", role: "admin", profile: { display_name: "原始管理员 UGC" } } : null;
      for (const name of names) {
        const html = renderToStaticMarkup(createElement(modules[name], { localeContext }));
        assert.ok(html.length > 0, `${name}/${locale}/${status} renders`);
        if (locale === "en") assert.doesNotMatch(html, /正在确认登录状态|请先登录|当前账号没有管理员权限|管理员权限确认失败/, `${name} localizes owned session presentation`);
      }
    }
  }
  assert.equal(requests.length, 0, "SSR rendering never starts privileged requests");
  assert.equal(externalRequests, 0);
  console.log("LOCALE_ADMIN=PASS SSR_BOTH_LOCALES=PASS SECURITY_SOURCES_UNCHANGED=PASS EXTERNAL_REQUESTS=0");
} finally {
  await vite.close(); globalThis.fetch = originalFetch;
  delete globalThis.__localeAdminFixture; delete globalThis.__localeAdminFetch;
}
