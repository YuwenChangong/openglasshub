import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "output/playwright/admin-devices-access");
const host = "127.0.0.1";
const port = 4397;
const origin = `http://${host}:${port}`;
const shell = ".admin-news-dashboard,.admin-news-toolbar,.admin-news-toolbar__filters,.admin-news-dashboard__list,.admin-news-form,form,input,textarea,h1";
const views = [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 430, height: 932 }];

// The child receives only explicit OS runtime variables, never inherited credentials.
function childEnvironment() {
  const env = { CI: "1", ASTRO_TELEMETRY_DISABLED: "1", ASTRO_DISABLE_UPDATE_CHECK: "true", NODE_ENV: "development" };
  for (const key of ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "TEMP", "TMP", "COMSPEC"])
    if (process.env[key]) env[key] = process.env[key];
  return env;
}

async function ssrChild() {
  const net = await import("node:net");
  const dns = await import("node:dns");
  const denied = [];
  const reject = (kind, hostname) => { denied.push({ kind, hostname }); throw new Error("NON_LOOPBACK_NETWORK_BLOCKED"); };
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const [options] = net._normalizeArgs(args);
    if (options.host && ![host, "::1", "localhost"].includes(options.host)) reject("tcp", options.host);
    return connect.apply(this, args);
  };
  const lookup = dns.default.lookup;
  dns.default.lookup = function (name, ...args) {
    if (!net.isIP(name) && name !== "localhost") reject("dns", name);
    return lookup.call(this, name, ...args);
  };
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, ...args) => {
    const hostname = new URL(typeof url === "string" || url instanceof URL ? url : url.url).hostname;
    if (![host, "[::1]"].includes(hostname)) reject("fetch", hostname);
    return nativeFetch(url, ...args);
  };
  const { syncBuiltinESMExports } = await import("node:module");
  syncBuiltinESMExports();
  const { dev } = await import("astro");
  const { default: react } = await import("@astrojs/react");
  const project = path.join(output, "ssr-project");
  await mkdir(project, { recursive: true });
  const server = await dev({
    root: project, configFile: false, srcDir: path.join(root, "src"),
    publicDir: path.join(root, "public"), cacheDir: path.join(project, "cache"),
    outDir: path.join(project, "dist"), output: "server", integrations: [react()],
    server: { host, port: 4398 }, logLevel: "silent",
    vite: { envDir: false, server: { strictPort: true, hmr: false }, plugins: [{
      name: "access-only-content", enforce: "pre",
      transform(source, id) {
        if (id.replaceAll("\\", "/").endsWith("/src/content.config.ts")) return "export const collections = {};";
      },
    }] },
  });
  process.send?.({ ready: true });
  process.on("message", async (message) => {
    if (message !== "stop") return;
    await server.stop();
    process.send?.({ stopped: true, denied });
    process.disconnect();
  });
}

const entry = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { createAdminDevicesDashboard } from "./src/components/admin/AdminDevicesDashboard.tsx";
import { AdminApiError } from "./src/lib/admin-api-client.ts";
import { resolveLocale } from "./src/lib/i18n/locale.ts";
const query = new URLSearchParams(location.search);
const locale = query.get("locale") || "en";
const fixture = window.fixture = { calls: [], pending: [], mutations: [], mutationPending: false, refreshes: 0, response: query.get("response") || "success" };
const session = { access_token: "OFFLINE_FIXTURE_ONLY", user: { id: "fixture-admin" } };
const state = (status, role = "admin", allowed = true, token = true) => status === "ready"
  ? { status, message: "RAW_PROVIDER_MUST_NOT_RENDER", session: token ? session : { ...session, access_token: "" }, me: { role, allowed, user_id: session.user.id } }
  : { status, message: "RAW_PROVIDER_MUST_NOT_RENDER", details: "RAW_PROVIDER_MUST_NOT_RENDER" };
fixture.state = state;
const device = { id: "fixture-device", slug: "fixture-device", name: "Fixture Glasses", brandName: "Offline Brand", publicationStatus: "draft", slugLocked: false, releaseYear: "2026" };
const Dashboard = createAdminDevicesDashboard({
  useSession() {
    const [current, update] = useState(state(query.get("status") || "signed_out", query.get("role") || "admin", query.get("allowed") !== "false", query.get("token") !== "false"));
    fixture.setState = update;
    return { state: current, setState: update, session: current.status === "ready" ? current.session : null,
      me: current.status === "ready" ? current.me : null, refresh() { fixture.refreshes++; } };
  },
  async fetchAdmin(url, options) {
    fixture.calls.push({ url, method: options.method || "GET", signal: options.signal, userId: options.session.user.id });
    if (options.method && options.method !== "GET" && fixture.mutationPending) return new Promise(resolve => fixture.mutations.push({
      userId: options.session.user.id, resolve: () => resolve({ device: { ...device, name: "COMPLETED_FIXTURE_MUTATION" } }),
    }));
    if (fixture.response === "pending") return new Promise(resolve => fixture.pending.push(resolve));
    if (/^error-/.test(fixture.response)) throw new AdminApiError("RAW_PROVIDER_MUST_NOT_RENDER", Number(fixture.response.slice(6)));
    return { devices: [device] };
  },
});
fixture.release = () => { for (const resolve of fixture.pending.splice(0)) resolve({ devices: [{ ...device, name: "STALE_PRIVATE_DEVICE" }] }); };
createRoot(document.getElementById("root")).render(React.createElement(Dashboard, { localeContext: resolveLocale({ acceptLanguage: locale }) }));
`;

async function fixtureAssets() {
  const layout = await readFile(path.join(root, "src/layouts/CommunityLayout.astro"), "utf8");
  const baseCss = layout.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert.ok(baseCss, "REAL_LAYOUT_BASE_CSS_REQUIRED");
  const css = await readFile(path.join(root, "src/styles/community.css"), "utf8");
  const bundle = await build({
    stdin: { contents: entry, resolveDir: root, sourcefile: "admin-access-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "no-real-session", setup(builder) {
      builder.onResolve({ filter: /^\.\/useAdminSession$/ }, () => ({ path: "session", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export function useAdminSession() { throw new Error("REAL_SESSION_FORBIDDEN"); }' }));
      builder.onResolve({ filter: /supabase-browser|@supabase\/supabase-js/ }, () => { throw new Error("SUPABASE_IMPORT_FORBIDDEN"); });
    } }],
  });
  return {
    "/fixture.js": ["text/javascript", bundle.outputFiles[0].text],
    "/fixture.css": ["text/css", `${css}\n${baseCss}`],
    "/": ["text/html", '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main class="community-shell"><section class="community-section" style="padding-top:1rem"><div id="root"></div></section></main><script type="module" src="/fixture.js"></script></body></html>'],
  };
}

async function geometry(page) {
  return page.locator("#root").evaluate((root) => {
    const failures = [];
    const textRanges = [];
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width && r.height && s.visibility !== "hidden" && s.display !== "none"; };
    const label = (el) => `${el.tagName.toLowerCase()}.${String(el.className).trim().replaceAll(" ", ".")}`;
    const contained = (a, b) => a.left >= b.left - 2 && a.right <= b.right + 2 && a.top >= b.top - 2 && a.bottom <= b.bottom + 2;
    for (const el of root.querySelectorAll("*")) {
      if (!visible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.left < -1 || rect.right > innerWidth + 1) failures.push({ type: "horizontal", element: label(el), left: rect.left, right: rect.right });
      if (!el.matches("input,textarea,select") && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).display !== "inline")
        failures.push({ type: "element-overflow", element: label(el), scroll: el.scrollWidth, width: el.clientWidth });
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const text of range.getClientRects()) {
          textRanges.push({ el, rect: text });
          if (!contained(text, rect)) failures.push({ type: "text-outside", element: label(el), text: node.textContent.trim().slice(0, 60) });
        }
      }
    }
    const controls = [...root.querySelectorAll("button,a,input,textarea,select")].filter(visible);
    const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
    for (let i = 0; i < textRanges.length; i++) for (let j = i + 1; j < textRanges.length; j++) {
      if (textRanges[i].el === textRanges[j].el) continue;
      if (overlaps(textRanges[i].rect, textRanges[j].rect)) failures.push({ type: "text-overlap", elements: [label(textRanges[i].el), label(textRanges[j].el)] });
    }
    for (const text of textRanges) for (const control of controls) {
      if (control.contains(text.el)) continue;
      if (overlaps(text.rect, control.getBoundingClientRect())) failures.push({ type: "text-control-overlap", elements: [label(text.el), label(control)] });
    }
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
      const a = controls[i].getBoundingClientRect(), b = controls[j].getBoundingClientRect();
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2)
        failures.push({ type: "controls-overlap", elements: [label(controls[i]), label(controls[j])] });
    }
    const list = root.querySelector(".admin-news-dashboard__list")?.getBoundingClientRect();
    const form = root.querySelector(".admin-news-form")?.getBoundingClientRect();
    if (list && form && Math.min(list.right, form.right) - Math.max(list.left, form.left) > 2 && Math.min(list.bottom, form.bottom) - Math.max(list.top, form.top) > 2)
      failures.push({ type: "list-form-overlap" });
    return { documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, failures };
  });
}

async function verifySsr(browser, report) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--ssr-child"], {
    cwd: root, env: childEnvironment(), windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let diagnostic = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { diagnostic = (diagnostic + chunk).slice(-12000); });
  let stopped;
  const exited = new Promise(resolve => child.once("exit", (code) => resolve(code)));
  try {
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("SSR_START_TIMEOUT")), 45000);
      child.on("message", (message) => { if (message.ready) { clearTimeout(deadline); resolve(); } });
      child.once("error", (error) => { clearTimeout(deadline); reject(error); });
      child.once("exit", () => { clearTimeout(deadline); reject(new Error("SSR_CHILD_EXITED")); });
    });
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block", extraHTTPHeaders: { "accept-language": "en" } });
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/")) { report.apiNetworkRequests++; return route.abort(); }
      if (url.origin !== "http://127.0.0.1:4398") { report.externalRequestsBlocked++; return route.abort(); }
      return route.continue();
    });
    try {
      const page = await context.newPage();
      for (const locale of ["en", "zh-CN"]) {
        const response = await page.goto("http://127.0.0.1:4398/admin/devices/", { waitUntil: "domcontentloaded", timeout: 45000 });
        assert.equal(response.status(), 200, "ACTUAL_ASTRO_ROUTE_HTTP_200_REQUIRED");
        await page.locator("main .admin-state-message").waitFor();
        assert.equal(await page.locator(`main :is(${shell})`).count(), 0, "SSR_MANAGEMENT_SHELL_MUST_BE_ABSENT");
        assert.ok((await page.locator("main").textContent()).trim());
        report.ssr.push({ locale, status: response.status(), managementCount: 0, javaScript: false });
        for (const view of views) {
          await page.setViewportSize(view);
          const file = `${view.width}x${view.height}-${locale}-actual-astro-ssr.png`;
          await page.screenshot({ path: path.join(output, file), animations: "disabled" });
          report.screenshots.push(file);
        }
        await page.setExtraHTTPHeaders({ "accept-language": "zh-CN" });
      }
      await writeFile(path.join(output, "astro-ssr.html"), await page.content());
    } finally { await context.close(); }
  } catch (error) {
    await writeFile(path.join(output, "ssr-diagnostic.txt"), diagnostic);
    throw error;
  } finally {
    if (child.exitCode === null) {
      stopped = new Promise(resolve => child.on("message", message => { if (message.stopped) resolve(message); }));
      if (child.connected) child.send("stop"); else child.kill();
      const outcome = await Promise.race([stopped, exited, new Promise(resolve => { const timer = setTimeout(() => resolve("timeout"), 8000); timer.unref(); })]);
      if (outcome === "timeout") child.kill();
      if (outcome?.stopped) { report.ssrDeniedNetworkAttempts = outcome.denied.length; report.ssrDeniedNetworkDetails = outcome.denied; }
      await exited;
    }
  }
}

async function serveFixture(assets) {
  const server = createServer((request, response) => {
    if (request.headers.host !== `127.0.0.1:${port}`) { response.writeHead(403); response.end(); return; }
    const pathname = new URL(request.url, origin).pathname;
    const asset = assets[pathname];
    response.writeHead(asset ? 200 : 404, { "content-type": asset?.[0] ?? "text/plain", "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'" });
    response.end(asset?.[1] ?? "Not found");
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  return server;
}

async function preview() {
  const server = await serveFixture(await fixtureAssets());
  console.log(`ADMIN_ACCESS_OFFLINE_PREVIEW=${origin}/`);
  console.log(`ADMIN_ACCESS_OFFLINE_ADMIN_FIXTURE=${origin}/?status=ready`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close());
}

async function run() {
  await mkdir(output, { recursive: true });
  const report = { fixtureOnly: true, realDashboard: true, realCss: true, realSessionHook: false, realSupabase: false,
    apiNetworkRequests: 0, externalRequestsBlocked: 0, websocketAttemptsBlocked: 0, pageErrors: [], cases: [], layoutIssues: [], screenshots: [], ssr: [] };
  const server = await serveFixture(await fixtureAssets());
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
    for (const view of process.argv.includes("--ssr-only") ? [] : views) for (const locale of ["en", "zh-CN"]) {
      const context = await browser.newContext({ viewport: view, serviceWorkers: "block" });
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith("/api/")) { report.apiNetworkRequests++; return route.abort(); }
        if (url.origin !== origin) { report.externalRequestsBlocked++; return route.abort(); }
        return route.continue();
      });
      await context.routeWebSocket("**/*", socket => { report.websocketAttemptsBlocked++; socket.close(); });
      const page = await context.newPage();
      page.on("pageerror", error => report.pageErrors.push(error.message));
      const open = async (params) => {
        await page.goto(`${origin}/?${new URLSearchParams({ locale, ...params })}`);
        await page.waitForFunction(() => typeof window.fixture?.setState === "function");
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      };
      const calls = () => page.evaluate(() => window.fixture.calls.length);
      const denied = async () => {
        await page.locator(".admin-state-message").waitFor();
        assert.equal(await page.locator(shell).count(), 0, "UNAUTHORIZED_MANAGEMENT_SHELL");
        assert.doesNotMatch(await page.locator("body").textContent(), /RAW_PROVIDER|STALE_PRIVATE_DEVICE/);
      };
      const record = async (name) => {
        const size = `${view.width}x${view.height}`;
        await page.evaluate(() => { for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish(); });
        const stateOpacity = await page.locator(".admin-state-message").evaluateAll(elements => elements.map(element => getComputedStyle(element).opacity));
        assert.ok(stateOpacity.every(opacity => opacity === "1"), "STATE_SCREENSHOT_MUST_BE_FULLY_VISIBLE");
        const result = await geometry(page);
        if (result.documentWidth > view.width + 1) result.failures.push({ type: "document-overflow" });
        if (result.failures.length) report.layoutIssues.push({ size, locale, name, ...result });
        const file = `${size}-${locale}-${name}.png`;
        await page.screenshot({ path: path.join(output, file), fullPage: true, animations: "disabled" });
        report.screenshots.push(file);
        if (name === "ready-admin") {
          const crop = `${size}-${locale}-${name}-viewport.png`;
          await page.screenshot({ path: path.join(output, crop), animations: "disabled" });
          report.screenshots.push(crop);
        }
        report.cases.push({ size, locale, name, apiCalls: await calls(), layoutIssues: result.failures.length, stateOpacity });
      };
      try {
        for (const status of ["checking", "signed_out", "forbidden", "error", "timeout"]) {
          await open({ status }); await denied(); assert.equal(await calls(), 0);
          if (status === "signed_out") assert.equal(await page.locator(".admin-state-message a").getAttribute("href"), "/login/?next=%2Fadmin%2Fdevices%2F");
          if (["error", "timeout"].includes(status)) { await page.locator(".admin-state-message button").click(); assert.equal(await page.evaluate(() => window.fixture.refreshes), 1); }
          await record(status);
        }
        for (const params of [{ role: "user" }, { role: "moderator" }, { allowed: "false" }, { token: "false" }]) {
          await open({ status: "ready", ...params }); await denied(); assert.equal(await calls(), 0);
          await record(`denied-${Object.keys(params)[0]}-${Object.values(params)[0]}`);
        }
        await open({ status: "ready" });
        await page.locator(".admin-news-card").waitFor();
        assert.equal(await calls(), 1); assert.equal(await page.locator("form").count(), 1);
        await page.locator(".admin-news-card").click();
        assert.equal(await page.locator(".admin-news-form input").nth(2).inputValue(), "Fixture Glasses");
        await record("ready-admin");
        for (const status of [401, 403, 500]) {
          await open({ status: "ready", response: `error-${status}` });
          if (status === 500) { await page.locator("[role=alert]").waitFor(); assert.equal(await page.locator("form").count(), 1); }
          else await denied();
          assert.equal(await calls(), 1);
          assert.doesNotMatch(await page.locator("body").textContent(), /RAW_PROVIDER|Loading devices|No devices/);
          await record(`list-${status}`);
          if (status === 500) {
            await page.evaluate(() => { window.fixture.response = "success"; });
            await page.locator("[role=alert] button").click();
            await page.locator(".admin-news-card").waitFor(); assert.equal(await calls(), 2);
          }
        }
        for (const [name, next] of [["revoked", "forbidden"], ["expired", "signed_out"]]) {
          await open({ status: "ready" }); await page.locator(".admin-news-card").waitFor();
          await page.locator(".admin-news-card").click();
          await page.evaluate(status => window.fixture.setState(window.fixture.state(status)), next);
          await denied(); assert.equal(await calls(), 1); await record(name);
        }
        await open({ status: "ready" }); await page.locator(".admin-news-card").waitFor();
        await page.locator(".admin-news-card").click();
        await page.evaluate(() => {
          const next = window.fixture.state("ready");
          next.session = { access_token: "OFFLINE_FIXTURE_B", user: { id: "fixture-admin-b" } };
          next.me.user_id = "fixture-admin-b";
          window.fixture.setState(next);
        });
        await page.waitForFunction(() => window.fixture.calls.length === 2);
        await page.locator(".admin-news-card").waitFor();
        assert.equal(await page.locator(".admin-news-form input").nth(2).inputValue(), "");
        await record("account-switch");
        await open({ status: "ready" }); await page.locator(".admin-news-card").waitFor();
        await page.locator(".admin-news-card").click();
        await page.locator(".admin-news-form input").nth(2).fill("UNSAVED_SAME_USER_DRAFT");
        await page.evaluate(() => window.fixture.setState(window.fixture.state("checking")));
        await denied(); assert.equal(await calls(), 1);
        await page.evaluate(() => {
          const next = window.fixture.state("ready");
          next.session = { ...next.session, access_token: "OFFLINE_REFRESHED_TOKEN" };
          window.fixture.setState(next);
        });
        await page.waitForFunction(() => window.fixture.calls.length === 2);
        await page.locator(".admin-news-card").waitFor();
        assert.equal(await page.locator(".admin-news-form input").nth(2).inputValue(), "UNSAVED_SAME_USER_DRAFT");
        await record("same-user-token-refresh");
        await open({ status: "ready" }); await page.locator(".admin-news-card").waitFor();
        await page.evaluate(() => { window.fixture.mutationPending = true; });
        const submit = page.locator("form button[type=submit]");
        await submit.click();
        await page.waitForFunction(() => window.fixture.mutations.length === 1);
        assert.equal(await submit.isDisabled(), true);
        await page.evaluate(() => {
          const next = window.fixture.state("ready");
          next.session = { access_token: "OFFLINE_FIXTURE_B", user: { id: "fixture-admin-b" } };
          next.me.user_id = "fixture-admin-b";
          window.fixture.setState(next);
        });
        await page.waitForFunction(() => window.fixture.calls.length === 3);
        await page.locator(".admin-news-card").waitFor();
        assert.equal(await submit.isDisabled(), false);
        await submit.click();
        await page.waitForFunction(() => window.fixture.mutations.length === 2);
        assert.equal(await submit.isDisabled(), true);
        await page.evaluate(() => window.fixture.mutations[0].resolve());
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await submit.isDisabled(), true, "OLD_OWNER_FINALLY_MUST_NOT_UNLOCK_CURRENT_OWNER");
        await page.locator("form").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        assert.equal(await page.evaluate(() => window.fixture.mutations.length), 2, "CURRENT_OWNER_DUPLICATE_MUTATION_BLOCKED");
        assert.deepEqual(await page.evaluate(() => window.fixture.mutations.map(item => item.userId)), ["fixture-admin", "fixture-admin-b"]);
        await record("account-switch-pending-mutation");
        await page.evaluate(() => window.fixture.mutations[1].resolve());
        await page.waitForFunction(() => !document.querySelector("form button[type=submit]").disabled);
        assert.equal(await calls(), 5);
        await open({ status: "ready", response: "pending" });
        await page.waitForFunction(() => window.fixture.calls.length === 1);
        await record("list-loading");
        await page.evaluate(() => window.fixture.setState(window.fixture.state("signed_out")));
        await denied();
        assert.equal(await page.evaluate(() => window.fixture.calls[0].signal.aborted), true);
        await page.evaluate(() => window.fixture.release());
        await denied(); assert.equal(await calls(), 1); await record("expired-pending-response");
        await page.clock.install();
        await open({ status: "ready", response: "pending" });
        await page.waitForFunction(() => window.fixture.calls.length === 1);
        await page.clock.runFor(15001);
        await page.locator("[role=alert]").waitFor();
        assert.equal(await page.evaluate(() => window.fixture.calls[0].signal.aborted), true);
        await record("list-timeout");
        await page.evaluate(() => { window.fixture.response = "success"; });
        await page.locator("[role=alert] button").click();
        await page.locator(".admin-news-card").waitFor(); assert.equal(await calls(), 2);
      } finally { await context.close(); }
    }
    await verifySsr(browser, report);
    assert.equal(report.apiNetworkRequests, 0);
    assert.equal(report.externalRequestsBlocked, 0);
    assert.equal(report.websocketAttemptsBlocked, 0);
    assert.deepEqual(report.pageErrors, []);
    assert.equal(report.ssrDeniedNetworkAttempts, 0);
    assert.deepEqual(report.layoutIssues, [], "REAL_CSS_LAYOUT_ISSUES_SEE_REPORT");
    report.passed = true;
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`ADMIN_ACCESS_BROWSER_CASES=${report.cases.length} SCREENSHOTS=${report.screenshots.length} LAYOUT_ISSUE_CASES=${report.layoutIssues.length} API_NETWORK_REQUESTS=${report.apiNetworkRequests} EXTERNAL_REQUESTS=${report.externalRequestsBlocked} SSR_CASES=${report.ssr.length}`);
  }
}

if (process.argv.includes("--ssr-child")) {
  ssrChild().catch(error => { console.error(error); process.exitCode = 1; process.disconnect?.(); });
} else if (process.argv.includes("--preview")) {
  preview().catch(error => { console.error(error.message); process.exitCode = 1; });
} else {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
