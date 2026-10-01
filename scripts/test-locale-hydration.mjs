import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const fixture = path.join(root, "tests/visual/locale-settings-harness");
const output = path.join(root, "artifacts/qa/locale-hydration");
const server = await createServer({ root: fixture, configFile: path.join(fixture, "vite.config.ts"), logLevel: "error", server: { host: "127.0.0.1", port: 0 } });
let browser;
let external = 0;
try {
  await server.listen();
  const origin = new URL(server.resolvedUrls.local[0]).origin;
  browser = await chromium.launch({ headless: true, args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
  await mkdir(output, { recursive: true });
  for (const initial of ["zh-CN", "en"]) {
    for (const storage of ["denied", "opposite"]) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      external++; return route.abort();
    });
    await context.routeWebSocket("**/*", socket => {
      if (new URL(socket.url()).origin === origin.replace("http:", "ws:")) socket.connectToServer();
      else { external++; socket.close(); }
    });
    await context.addInitScript(({ storage, initial }) => {
      if (storage === "denied") Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("NO_LOCAL_STORAGE_FIRST_SOURCE"); } });
      else localStorage.setItem("ogh_locale", initial === "en" ? "zh-CN" : "en");
      window.__preferenceEvents = [];
      window.addEventListener("ogh:locale-preference", event => window.__preferenceEvents.push(event.detail));
    }, { storage, initial });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    let release;
    const delay = new Promise(resolve => { release = resolve; });
    await page.route("**/main.tsx", async route => { await delay; await route.continue(); });
    await page.goto(`${origin}/?initial=${initial}`, { waitUntil: "commit" });
    await page.locator("#first output").waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), initial);
    assert.deepEqual(await page.locator("output").evaluateAll(nodes => nodes.map(node => node.dataset.locale)), [initial, initial]);
    await page.screenshot({ path: path.join(output, `${initial}-${storage}-first-frame.png`) });
    release();
    await page.waitForFunction(() => document.querySelectorAll('[data-hydrated="true"]').length === 2);
    assert.deepEqual(await page.locator("output").evaluateAll(nodes => nodes.map(node => node.dataset.locale)), [initial, initial]);
    assert.deepEqual(errors, [], "no hydration warning or localStorage read");
    await page.evaluate(() => { Object.defineProperty(document, "cookie", { configurable: true, get() { return ""; }, set() { throw new Error("COOKIE_DENIED"); } }); });
    await page.locator("#first").getByRole("button", { name: initial === "en" ? "ZH" : "EN", exact: true }).click();
    const opposite = initial === "en" ? "zh-CN" : "en";
    assert.deepEqual(await page.locator("output").evaluateAll(nodes => nodes.map(node => node.dataset.locale)), [opposite, opposite]);
    assert.equal(await page.locator("#first > div").getAttribute("data-persistent"), "false");
    assert.deepEqual(await page.evaluate(() => window.__preferenceEvents), []);
    await page.evaluate(() => {
      delete document.cookie;
      window.__choiceOrder = [];
      window.addEventListener("ogh:locale-preference", event => {
        const saved = document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith("ogh_preferences_v1="));
        window.__choiceOrder.push({ phase: "published", record: event.detail, cookie: JSON.parse(decodeURIComponent(saved.split("=").slice(1).join("="))) });
        sessionStorage.setItem("choiceOrder", JSON.stringify(window.__choiceOrder));
      });
      window.addEventListener("beforeunload", () => {
        window.__choiceOrder.push({ phase: "navigate" });
        sessionStorage.setItem("choiceOrder", JSON.stringify(window.__choiceOrder));
      });
    });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load" }),
      page.locator("#first").getByRole("button", { name: initial === "en" ? "ZH" : "EN", exact: true }).click(),
    ]);
    await page.waitForFunction(() => document.querySelectorAll('[data-hydrated="true"]').length === 2);
    assert.equal(await page.locator("html").getAttribute("lang"), opposite);
    assert.deepEqual(await page.locator("output").evaluateAll(nodes => nodes.map(node => node.dataset.locale)), [opposite, opposite]);
    const order = await page.evaluate(() => JSON.parse(sessionStorage.getItem("choiceOrder")));
    assert.deepEqual(order.map(entry => entry.phase), ["published", "navigate"]);
    assert.deepEqual(order[0].cookie, order[0].record, "cookie committed before event and navigation");
    assert.deepEqual(Object.keys(order[0].record).sort(), ["generation", "preference", "provenance", "version"]);
    assert.deepEqual(errors, [], "no hydration warnings after persisted navigation");
    await context.close();
    }
  }
  assert.equal(external, 0);
  console.log("LOCALE_HYDRATION=PASS EXTERNAL_HTTP_AND_WEBSOCKET=0");
} finally { await browser?.close(); await server.close(); }
