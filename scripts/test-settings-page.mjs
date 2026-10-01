import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
const root = process.cwd(), fixture = path.join(root, "tests/visual/locale-settings-harness");
const server = await createServer({ root: fixture, configFile: path.join(fixture, "vite.config.ts"), logLevel: "error", server: { host: "127.0.0.1", port: 0 } });
let browser, external = 0;
try {
  await server.listen(); const origin = new URL(server.resolvedUrls.local[0]).origin;
  browser = await chromium.launch({ headless: true, args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
  for (const language of ["en", "zh-CN"]) {
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    await context.route("**/*", route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external++; return route.abort(); });
    await context.routeWebSocket("**/*", socket => { if (new URL(socket.url()).origin === origin.replace("http:", "ws:")) socket.connectToServer(); else { external++; socket.close(); } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?fixture=settings&initial=${language}`);
    await page.locator("#settings-fixture").waitFor();
    assert.equal(await page.locator("#settings-fixture select").count(), 1, "General has a real language selector");
    assert.deepEqual(await page.locator("#settings-fixture option").evaluateAll(nodes => nodes.map(node => node.value)), ["auto", "zh-CN", "en"]);
    assert.equal(await page.locator('#settings-fixture a[href="/login/?next=%2Fsettings%2F"]').count(), 1);
    assert.equal(await page.locator('#settings-fixture a[href="/me/"]').count(), 0);
    await Promise.all([page.waitForNavigation(), page.locator("#settings-fixture select").selectOption(language === "en" ? "zh-CN" : "en")]);
    const opposite = language === "en" ? "zh-CN" : "en";
    assert.equal(await page.locator("html").getAttribute("lang"), opposite);
    await page.locator("#settings-fixture select").waitFor();
    assert.equal(await page.locator("#settings-fixture select").inputValue(), opposite);
    await page.locator("#settings-fixture select").focus();
    await Promise.all([page.waitForNavigation(), page.locator("#settings-fixture select").press("Home")]);
    await page.locator("#settings-fixture select").waitFor();
    assert.equal(await page.locator("#settings-fixture select").inputValue(), "auto");
    await page.goto(`${origin}/?fixture=settings&actor=ready&initial=${language}`);
    await page.locator('#settings-fixture a[href="/me/"]').waitFor();
    await mkdir(path.join(root, "artifacts/qa/settings"), { recursive: true });
    await page.screenshot({ path: path.join(root, "artifacts/qa/settings", `${language}-initial-390.png`), fullPage: true });
    for (const href of ["/me/edit/", "/login/?mode=forgot&next=%2Fsettings%2F", "/account-deletion/", "/notifications/", "/privacy/", "/terms/", "/community-guidelines/"]) assert.ok(await page.locator(`#settings-fixture a[href="${href}"]`).count() > 0, href);
    assert.equal(await page.getByRole("button", { name: /Logout|退出登录/ }).count(), 1);
    await page.locator("#settings-fixture select").selectOption("zh-CN");
    await page.waitForFunction(() => window.__settingsFixture.saves.length === 1 && window.__settingsFixture.reloads === 1);
    assert.deepEqual(await page.evaluate(() => window.__settingsFixture.saves), [{ preference: "zh-CN", revision: 3 }]);
    assert.match(await page.locator('#settings-fixture [role="status"]').innerText(), /Saved to your account|已保存到账户/);
    for (const width of [390, 430, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow ${width}`);
    }
    const content = await page.locator("#settings-fixture").innerText();
    assert.equal(/Appearance|Light mode|外观|浅色模式/.test(content), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await mkdir(path.join(root, "artifacts/qa/settings"), { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(root, "artifacts/qa/settings", `${language}-390.png`), fullPage: true });
    await page.getByRole("button", { name: /Logout|退出登录/ }).click();
    assert.equal(await page.evaluate(() => window.__settingsFixture.signOuts), 1);
    for (const failure of ["unavailable", "conflict"]) {
      await page.goto(`${origin}/?fixture=settings&actor=ready&failure=${failure}&initial=${language}`);
      await page.locator('#settings-fixture select').waitFor();
      await page.locator('#settings-fixture select').selectOption("en");
      await page.waitForFunction(() => window.__settingsFixture.saves.length === 1);
      assert.equal(await page.locator('#settings-fixture select').inputValue(), "en");
      assert.match(await page.locator('#settings-fixture [role="status"]').innerText(), failure === "conflict" ? /Account preference changed|账户偏好已变更/ : /Account sync failed|账户同步失败/);
      assert.equal(await page.evaluate(() => window.__settingsFixture.reloads), 0);
      assert.equal(await page.getByRole("button", { name: /Retry account save|重试账户保存/ }).count(), 1);
    }
    assert.deepEqual(await page.evaluate(() => {
      let confirmations = 0;
      const answer = window.__confirmSettingsNavigation("/login/", true, () => { confirmations++; return false; }, "safe-localized-message");
      const clean = window.__confirmSettingsNavigation("/login/", false, () => { confirmations++; return false; }, "safe-localized-message");
      return { answer, clean, confirmations };
    }), { answer: false, clean: true, confirmations: 1 });
    assert.deepEqual(errors, []);
    await context.close();
  }
  const route = await readFile(path.join(root, "src/pages/settings/index.astro"), "utf8");
  assert.match(route, /CommunityLayout/); assert.match(route, /localeContext/);
  assert.equal(external, 0); console.log("SETTINGS_PAGE=PASS EXTERNAL_HTTP_AND_WEBSOCKET=0");
} finally { await browser?.close(); await server.close(); }
