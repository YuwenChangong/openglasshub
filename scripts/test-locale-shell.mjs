import assert from "node:assert/strict";
import { dev } from "astro";
import cloudflare from "@astrojs/cloudflare";
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { serializePreferenceCookie } from "../src/lib/i18n/preference-cookie.ts";
const originalFetch = globalThis.fetch; let external = 0, server, browser;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) { external++; throw new Error("EXTERNAL_FORBIDDEN"); }
  return originalFetch(input, init);
};
try {
  server = await dev({ root: new URL("../", import.meta.url), logLevel: "error", server: { host: "127.0.0.1", port: 0 }, devToolbar: { enabled: false }, adapter: cloudflare({ platformProxy: { enabled: true, remoteBindings: false, envFiles: [], persist: false }, prerenderEnvironment: "node" }) });
  const origin = `http://127.0.0.1:${server.address.port}`;
  browser = await chromium.launch({ headless: true, args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
  for (const locale of ["en", "zh-CN"]) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.addCookies([{ name: "ogh_preferences_v1", value: serializePreferenceCookie({ version: 1, preference: locale, generation: 1, provenance: "device_explicit" }).split("=")[1].split(";")[0], url: origin }]);
    await context.route("**/*", route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external++; return route.abort(); });
    await context.routeWebSocket("**/*", socket => { if (new URL(socket.url()).origin === origin.replace("http:", "ws:")) socket.connectToServer(); else { external++; socket.close(); } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const response = await page.goto(`${origin}/settings/`);
    assert.equal(response.status(), 200, "actual Settings SSR must remain available before shell assertions");
    const setting = page.locator('.og-header__auth a[href="/settings/"]');
    assert.equal(await setting.count(), 1, "shared header must expose Settings");
    assert.equal(await setting.getAttribute("aria-label"), locale === "en" ? "Settings" : "设置");
    assert.equal(await setting.getAttribute("title"), locale === "en" ? "Settings" : "设置");
    const order = await page.locator(".og-header__auth [data-header-action]").evaluateAll(nodes => nodes.map(node => node.dataset.headerAction));
    assert.deepEqual(order, ["notifications", "settings", "account"]);
    assert.match(await page.locator(".community-site-footer").innerText(), locale === "en" ? /Privacy/ : /隐私政策/);
    assert.equal(await page.locator('.og-header__nav a[href="/feed/"]').innerText(), locale === "en" ? "Forum" : "论坛");
    for (const width of [390, 430, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const box = await setting.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44);
      assert.ok(box.x >= 0 && box.x + box.width <= width, "Settings remains reachable");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const overlap = await page.locator(".og-header__brand, .og-header__auth").evaluateAll(nodes => {
        const [brand, actions] = nodes.map(node => node.getBoundingClientRect());
        return brand.right > actions.left && brand.top < actions.bottom && brand.bottom > actions.top;
      });
      assert.equal(overlap, false, `header overlap ${width}`);
      await mkdir(path.join(process.cwd(), "artifacts/qa/locale-shell"), { recursive: true });
      await page.screenshot({ path: path.join(process.cwd(), "artifacts/qa/locale-shell", `${locale}-${width}.png`), fullPage: true });
    }
    await page.evaluate(() => {
      history.replaceState(null, "", "/login/");
      const input = document.createElement("input"); input.type = "password"; input.value = "local-unsent-fixture";
      const form = document.createElement("form"); form.append(input); document.body.append(form);
      window.__navigationConfirmations = 0; window.confirm = () => { window.__navigationConfirmations++; return false; };
    });
    await setting.click(); assert.equal(await page.evaluate(() => window.__navigationConfirmations), 1);
    assert.equal(new URL(page.url()).pathname, "/login/");
    await mkdir(path.join(process.cwd(), "artifacts/qa/locale-shell"), { recursive: true });
    await page.screenshot({ path: path.join(process.cwd(), "artifacts/qa/locale-shell", `${locale}-desktop.png`), fullPage: true });
    assert.deepEqual(errors, []); await context.close();
  }
  for (const component of ["HeaderUserMenu", "HeaderNotifications"]) {
    const source = await readFile(path.join(process.cwd(), `src/components/site/${component}.tsx`), "utf8");
    assert.match(source, /useLocale\(localeContext\)/);
    assert.doesNotMatch(source, /aria-label="(?:通知菜单|账户菜单|打开账户菜单)"/);
  }
  assert.equal(external, 0); console.log("LOCALE_SHELL=PASS EXTERNAL_HTTP_AND_WEBSOCKET=0");
} finally { await browser?.close(); await server?.stop(); globalThis.fetch = originalFetch; }
