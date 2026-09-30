import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const harnessRoot = path.join(root, "tests/visual/legal-consent-harness");
const output = path.join(root, "artifacts/qa/auth-email-abuse-visual");
const harness = await createServer({ root: harnessRoot, configFile: path.join(harnessRoot, "vite.config.ts"),
  logLevel: "error", server: { host: "127.0.0.1", port: 0 } });
const states = ["login", "signup", "pending-60", "resend-ready", "forgot", "widget-interaction", "widget-error", "off-unavailable", "prepare-unavailable", "prepare-script-failed", "unconfirmed-login", "captcha-rejected"];
let browser;
let external = 0;
let checked = 0;
try {
  await fs.mkdir(output, { recursive: true });
  await harness.listen();
  const origin = new URL(harness.resolvedUrls.local[0]).origin;
  browser = await chromium.launch({ headless: true, args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external += 1;
    return route.abort();
  });
  await context.routeWebSocket("**/*", socket => {
    if (new URL(socket.url()).origin === origin.replace("http:", "ws:")) socket.connectToServer();
    else { external += 1; socket.close(); }
  });
  for (const locale of ["zh", "en"]) for (const width of [390, 430, 1440]) for (const state of states) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 900 });
    await page.clock.install({ time: new Date("2026-09-30T00:00:00Z") });
    // The fake represents callback interaction only, not Cloudflare rendering or enforcement.
    if (state !== "off-unavailable") await page.addInitScript(() => {
      window.__visualWidget = null;
      window.turnstile = {
        render: (element, options) => {
          window.__visualWidget = options;
          const box = document.createElement("div");
          box.textContent = "Local security-check fixture";
          box.style.cssText = "width:100%;min-height:65px;border:1px solid #697381;padding:12px;box-sizing:border-box";
          element.append(box);
          return "visual-fixture";
        }, reset: () => {}, remove: () => {},
      };
    });
    if (state === "prepare-script-failed") {
      await page.addInitScript(() => { delete window.turnstile; });
      await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", route => route.fulfill({status:200,contentType:"text/javascript",body:""}));
    }
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: locale === "zh" ? "locale-zh" : "locale-en", exact: true }).click();
    const scenario = state === "unconfirmed-login" ? "login-abuse-required-unconfirmed"
      : state === "captcha-rejected" ? "login-abuse-required-structured"
      : state === "signup" || state === "pending-60" || state === "resend-ready" ? "register-abuse-initial"
      : state.startsWith("widget-") ? "login-captcha-required-widget"
      : state === "prepare-unavailable" ? "login-captcha-prepare-missing"
      : state === "prepare-script-failed" ? "login-captcha-prepare-script-failed" : "login-captcha-off";
    await page.getByRole("button", { name: scenario, exact: true }).click();
    const surface = page.locator(".legal-harness__surface");
    if (state === "unconfirmed-login" || state === "captcha-rejected") {
      await surface.locator('input[type="email"]').fill("qa@example.invalid");
      await surface.locator('input[type="password"]').fill("fixture-passphrase");
      await surface.locator('button[type="submit"]').click();
      await surface.locator(".auth-alert--error").waitFor();
      assert.equal(await surface.locator(".auth-alert--success").count(), 0);
      if (state === "unconfirmed-login") {
        assert.equal(await surface.locator(".auth-resend button").isDisabled(), false);
        assert.match(await surface.locator(".auth-resend__hint").textContent(), /qa@example.invalid/);
        assert.equal(await surface.getByRole("button", { name: locale === "zh" ? "忘记密码？" : "Forgot password?", exact: true }).count(), 1);
        assert.equal(await surface.getByRole("button", { name: locale === "zh" ? "登录" : "Log in", exact: true }).count(), 1);
      } else assert.equal(await surface.locator(".auth-resend").count(), 0);
    }
    if (state === "pending-60" || state === "resend-ready") {
      await surface.locator('input[type="email"]').fill("qa@example.invalid");
      await surface.locator('input[type="password"]').fill("fixture-passphrase");
      await surface.locator('button[type="submit"]').click();
      await surface.locator(".auth-resend button").waitFor();
      if (state === "pending-60") {
        assert.equal(await surface.locator(".auth-resend button").isDisabled(), true);
        assert.match(await surface.locator(".auth-resend button").textContent(), /60/);
      } else {
        await page.clock.runFor(60_000);
        await page.waitForFunction(() => !document.querySelector(".auth-resend button")?.disabled);
      }
      assert.equal(await surface.locator(".auth-resend button").count(), 1);
    }
    if (state === "forgot") {
      await surface.locator(".auth-forgot-link").click();
      assert.equal(await surface.getByRole("tablist").count(), 0);
      assert.equal(await surface.locator('input[type="password"]').count(), 0);
      assert.equal(await surface.locator(".auth-signup-notice").count(), 0);
    }
    if (state.startsWith("widget-")) {
      await page.waitForFunction(() => Boolean(window.__visualWidget));
      if (state === "widget-interaction") await page.evaluate(() => window.__visualWidget.callback("fixture-visual-proof"));
      else {
        await page.evaluate(() => window.__visualWidget["error-callback"]("fixture-error"));
        await surface.locator('input[type="email"]').fill("qa@example.invalid");
        await surface.locator('input[type="password"]').fill("fixture-passphrase");
        await surface.locator('button[type="submit"]').click();
        await surface.locator(".auth-alert--error").first().waitFor();
        assert.deepEqual(await page.evaluate(() => window.__authSdkCalls), []);
      }
    }
    if (state.includes("unavailable") || state === "prepare-script-failed") {
      if (state === "off-unavailable") assert.equal(await page.evaluate(() => typeof window.turnstile), "undefined", "off-unavailable must have no Turnstile API");
      await surface.locator('input[type="email"]').fill("qa@example.invalid");
      await surface.locator('input[type="password"]').fill("fixture-passphrase");
      await surface.locator('button[type="submit"]').click();
      await page.waitForFunction(() => window.__authSdkCalls.includes("signInWithPassword"));
      if (state === "off-unavailable") {
        await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("navigate:/feed/"));
        assert.equal(await page.evaluate(() => typeof window.turnstile), "undefined");
        assert.equal(await page.locator('script[src*="turnstile"]').count(), 0);
        assert.equal(await surface.locator(".auth-alert--error").count(), 0);
        assert.deepEqual(await page.evaluate(() => window.__authSdkCalls), ["signInWithPassword"]);
        console.log(`AUTH_OFF_UNAVAILABLE ${locale}/${width}: API_ABSENT; LOGIN_SUCCESS; SCRIPT_REQUESTS=0`);
      }
    }
    assert.equal(await surface.locator('input[type="checkbox"]').count(), 0, "no runtime consent control");
    assert.equal(await surface.locator('button[type="submit"]').count(), 1, "one active form action");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${locale}/${width}/${state} page overflow`);
    assert.equal(await surface.evaluate(element => element.scrollWidth <= element.clientWidth), true, `${locale}/${width}/${state} surface overflow`);
    await surface.screenshot({ path: path.join(output, `${locale}-${width}-${state}.png`) });
    checked += 1;
    console.log(`AUTH_VISUAL ${locale}/${width}/${state}: PASS`);
    await page.close();
  }
  assert.equal(external, 0);
  console.log(`AUTH_VISUAL_MATRIX: ${checked}/${states.length * 6} PASS; EXTERNAL_REQUESTS: ${external}; widget=LOCAL_FAKE`);
  await context.close();
} finally {
  if (browser) await browser.close();
  await harness.close();
}
