import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import { cloudflareWorkersTestPlugin, setCloudflareWorkersTestBinding } from "./lib/cloudflare-workers-test-plugin.mjs";

const cooldownKey = "auth-resend-confirmation-cooldown-until";
const fixedNow = Date.parse("2026-09-30T00:00:00.000Z");
const red = [];
const widgetRed = [];

async function loadChromium() {
  try { return (await import("playwright")).chromium; } catch { /* desktop runtime fallback */ }
  const runtimeRoot = path.join(process.env.LOCALAPPDATA ?? "", "OpenAI", "Codex", "runtimes", "cua_node");
  for (const entry of (await fs.readdir(runtimeRoot)).sort().reverse()) {
    const candidate = path.join(runtimeRoot, entry, "bin", "node_modules", "playwright", "index.mjs");
    try { await fs.access(candidate); return (await import(pathToFileURL(candidate).href)).chromium; } catch { /* next runtime */ }
  }
  throw new Error("Playwright runtime unavailable");
}

async function check(name, run) {
  try {
    await run();
    console.log(`${name}: PASS`);
  } catch (error) {
    if (error?.code !== "ERR_ASSERTION") throw error;
    red.push(name);
    console.log(`${name}: RED assertion ${error.message.replace(/\s+/g, " ")}`);
  }
}

async function checkWidget(name, run) {
  try {
    await run();
    console.log(`${name}: PASS`);
  } catch (error) {
    if (error?.code !== "ERR_ASSERTION") throw error;
    widgetRed.push(name);
    console.log(`${name}: RED assertion ${error.message.replace(/\s+/g, " ")}`);
  }
}

async function checkResendApi() {
  setCloudflareWorkersTestBinding({ RATE_LIMIT_SALT: "fixture-salt", AUTH_CAPTCHA_MODE: "required" });
  const originalFetch = globalThis.fetch;
  let externalAttempts = 0;
  globalThis.fetch = async () => { externalAttempts += 1; throw new Error("external networking denied"); };
  const vite = await createServer({ root: process.cwd(), logLevel: "error", plugins: [cloudflareWorkersTestPlugin()], server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
  try {
    const { createResendPost } = await vite.ssrLoadModule("/src/pages/api/auth/resend-confirmation.ts");
    let resendCalls = 0;
    let limitCalls = 0;
    const post = createResendPost({
      resend: async () => { resendCalls += 1; return { error: null }; },
      consumeLimit: async ({ maxAttempts, windowHours, ipHash }) => {
        limitCalls += 1;
        assert.deepEqual([maxAttempts, windowHours], [5, 24]);
        assert.match(ipHash, /^[a-f0-9]{64}$/);
        return { allowed: true, reason: "ALLOWED" };
      },
      observe: () => {},
    });
    const response = await post({
      request: new Request("http://127.0.0.1:4388/api/auth/resend-confirmation", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.1" },
        body: JSON.stringify({ email: "qa@example.invalid", next: "/feed/" }),
      }),
      locals: {},
    });
    await check("RESEND_EMAIL_WITHOUT_BOT_PROOF", () => {
      assert.equal(resendCalls, 0, "missing proof must prevent the resend SDK call");
      assert.equal(limitCalls, 0, "missing proof must fail before consuming the limiter");
      assert.equal(response.status, 400, "missing proof must be rejected locally");
    });
    assert.equal(externalAttempts, 0, "API fixture made no external request");
    console.log(`API_EXTERNAL_REQUESTS: ${externalAttempts}`);
  } finally {
    await vite.close();
    globalThis.fetch = originalFetch;
  }
}

async function select(page, scenario, preservePending = false) {
  if (!preservePending) await page.evaluate(() => sessionStorage.removeItem("auth-pending-verification-email"));
  await page.getByRole("button", { name: scenario, exact: true }).click();
}

async function fillAuthFields(page) {
  const surface = page.locator(".legal-harness__surface");
  await surface.locator('input[type="email"]').fill("qa@example.invalid");
  await surface.locator('input[type="password"]').fill("fixture-passphrase");
}

async function fillAuth(page) {
  await fillAuthFields(page);
  const surface = page.locator(".legal-harness__surface");
  await surface.locator('button[type="submit"]').click();
}

async function trace(page) {
  return (await page.locator("output").textContent()) ?? "";
}

async function authSdkCalls(page) {
  return page.evaluate(() => window.__authSdkCalls);
}

async function waitForWidgetBlockedAttempt(page, previousResets) {
  await page.waitForFunction((previous) => {
    const surface = document.querySelector(".legal-harness__surface");
    const submit = surface?.querySelector('button[type="submit"]');
    return Boolean(surface?.querySelector(".auth-alert--error") && submit && !submit.disabled)
      && (previous === null || window.__widgetResets > previous);
  }, previousResets);
  await crossDelayedCallBarrier(page);
}

async function submitAndWaitForAuthAttempt(page, call) {
  const surface = page.locator(".legal-harness__surface");
  const submit = surface.locator('button[type="submit"]');
  if (await submit.isDisabled()) return;
  const previousError = (await surface.locator(".auth-alert--error").allTextContents()).join(" ");
  await submit.click();
  await page.waitForFunction(({ expectedCall, previousError }) => {
    const surface = document.querySelector(".legal-harness__surface");
    const calls = document.querySelector("output")?.textContent?.split(",") ?? [];
    const submit = surface?.querySelector('button[type="submit"]');
    const error = surface?.querySelector(".auth-alert--error")?.textContent ?? "";
    return calls.some((entry) => entry === expectedCall || entry.startsWith(`${expectedCall}:`))
      || Boolean(error && error !== previousError && submit && !submit.disabled);
  }, { expectedCall: call, previousError });
}

async function crossDelayedCallBarrier(page) {
  await page.evaluate(() => {
    const output = document.querySelector("output");
    output.dataset.abuseBarrier = "pending";
    window.setTimeout(() => { output.dataset.abuseBarrier = "complete"; }, 750);
  });
  await page.clock.runFor(750);
  await page.waitForFunction(() => document.querySelector("output")?.dataset.abuseBarrier === "complete");
}

async function checkBrowser() {
  const routeVite = await createServer({ root: process.cwd(), logLevel: "error", plugins: [cloudflareWorkersTestPlugin()], server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
  const { createResendPost } = await routeVite.ssrLoadModule("/src/pages/api/auth/resend-confirmation.ts");
  const harnessRoot = path.join(process.cwd(), "tests", "visual", "legal-consent-harness");
  const harness = await createServer({ root: harnessRoot, configFile: path.join(harnessRoot, "vite.config.ts"), logLevel: "error", server: { host: "127.0.0.1", port: 0 } });
  let browser;
  try {
    await harness.listen();
    const origin = new URL(harness.resolvedUrls.local[0]).origin;
    const chromium = await loadChromium();
    browser = await chromium.launch({ headless: true, args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
    const context = await browser.newContext({ serviceWorkers: "block" });
    let blocked = 0;
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      blocked += 1;
      return route.abort();
    });
    await context.routeWebSocket("**/*", (socket) => {
      if (new URL(socket.url()).origin === origin.replace("http:", "ws:")) socket.connectToServer();
      else { blocked += 1; socket.close(); }
    });

    const widgetPage = await context.newPage();
    await widgetPage.clock.install({ time: new Date(fixedNow) });
    const widgetDiagnostics = [];
    widgetPage.on("console", (message) => widgetDiagnostics.push(message.text()));
    widgetPage.on("pageerror", (error) => widgetDiagnostics.push(error.message));
    await widgetPage.addInitScript(() => {
      window.__widgetRenders = [];
      window.turnstile = {
        render: (_element, options) => { window.__widgetRenders.push(options); return `widget-${window.__widgetRenders.length}`; },
        reset: () => { window.__widgetResets = (window.__widgetResets ?? 0) + 1; },
        remove: () => {},
      };
    });
    await widgetPage.goto(origin, { waitUntil: "networkidle" });
    await select(widgetPage, "login-captcha-off");
    await checkWidget("WIDGET_OFF_NEVER_LOADS", async () => {
      assert.equal(await widgetPage.evaluate(() => window.__widgetRenders.length), 0);
      assert.equal(await widgetPage.locator('script[src*="turnstile"]').count(), 0);
    });
    await select(widgetPage, "login-captcha-prepare-missing");
    await fillAuth(widgetPage);
    await widgetPage.waitForFunction(() => document.querySelector("output")?.textContent?.includes("signIn"));
    await checkWidget("WIDGET_PREPARE_MISSING_KEY_PERMISSIVE", async () => {
      assert.match(await trace(widgetPage), /tokenPresent:false,signIn/);
    });
    await select(widgetPage, "login-captcha-prepare-token");
    await fillAuth(widgetPage);
    await widgetPage.waitForFunction(() => document.querySelector("output")?.textContent?.includes("resetToken"));
    await checkWidget("WIDGET_PREPARE_FRESH_TOKEN_RESET", async () => {
      assert.match(await trace(widgetPage), /acquireToken,tokenPresent:true,signIn,navigate:\/feed\/,resetToken/);
    });
    for (const scenario of ["login-captcha-required-missing", "login-captcha-required-error", "login-captcha-required-expired"]) {
      await select(widgetPage, scenario);
      await fillAuthFields(widgetPage);
      await widgetPage.locator('.legal-harness__surface button[type="submit"]').click();
      await waitForWidgetBlockedAttempt(widgetPage, null);
      await checkWidget(`WIDGET_${scenario.toUpperCase().replaceAll("-", "_")}_BLOCKS`, async () => {
        assert.deepEqual(await authSdkCalls(widgetPage), [], "blocked attempt must make no auth SDK call");
        assert.equal((await trace(widgetPage)).includes("signIn"), false);
        assert.equal(await widgetPage.locator(".legal-harness__surface .auth-alert--error").count() > 0, true);
      });
    }
    await select(widgetPage, "login-captcha-required-widget");
    await checkWidget("WIDGET_MANAGED_CALLBACK_AND_MOBILE_WIDTH", async () => {
      const options = await widgetPage.evaluate(() => window.__widgetRenders.at(-1) && ({
        sitekey: window.__widgetRenders.at(-1).sitekey,
        theme: window.__widgetRenders.at(-1).theme,
        appearance: window.__widgetRenders.at(-1).appearance,
        size: window.__widgetRenders.at(-1).size,
        responseField: window.__widgetRenders.at(-1)["response-field"],
      }));
      assert.deepEqual(options, { sitekey: "fixture-sitekey", theme: "dark", appearance: "interaction-only", size: "flexible", responseField: false });
      for (const width of [390, 430]) {
        await widgetPage.setViewportSize({ width, height: 850 });
        assert.equal(await widgetPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${width}px must not overflow`);
      }
      await fillAuthFields(widgetPage);
      await widgetPage.evaluate(() => window.__widgetRenders.at(-1).callback("fixture-token"));
      await widgetPage.evaluate(() => window.__widgetRenders.at(-1)["error-callback"]("fixture-private-error"));
      const errorResets = await widgetPage.evaluate(() => window.__widgetResets ?? 0);
      await widgetPage.locator('.legal-harness__surface button[type="submit"]').click();
      await waitForWidgetBlockedAttempt(widgetPage, errorResets);
      assert.deepEqual(await authSdkCalls(widgetPage), [], "error widget callback must block the auth SDK");
      assert.equal((await trace(widgetPage)).includes("signIn"), false, "error widget callback must invalidate its token");
      await widgetPage.evaluate(() => window.__widgetRenders.at(-1).callback("fixture-token"));
      await widgetPage.evaluate(() => window.__widgetRenders.at(-1)["expired-callback"]());
      const expiryResets = await widgetPage.evaluate(() => window.__widgetResets ?? 0);
      await widgetPage.locator('.legal-harness__surface button[type="submit"]').click();
      await waitForWidgetBlockedAttempt(widgetPage, expiryResets);
      assert.deepEqual(await authSdkCalls(widgetPage), [], "expired widget callback must block the auth SDK");
      assert.equal((await trace(widgetPage)).includes("signIn"), false, "expired widget callback must invalidate its token");
      await widgetPage.evaluate(() => window.__widgetRenders.at(-1).callback("fixture-token"));
      await widgetPage.locator('.legal-harness__surface button[type="submit"]').click();
      await widgetPage.waitForFunction(() => document.querySelector("output")?.textContent?.includes("signIn"));
      assert.match(await trace(widgetPage), /tokenPresent:true,signIn/);
      assert.equal(await widgetPage.evaluate(() => window.__widgetResets > 0), true);
      const replayResets = await widgetPage.evaluate(() => window.__widgetResets ?? 0);
      await widgetPage.locator('.legal-harness__surface button[type="submit"]').click();
      await waitForWidgetBlockedAttempt(widgetPage, replayResets);
      assert.deepEqual(await authSdkCalls(widgetPage), ["signInWithPassword"], "one callback token permits one auth SDK attempt");
      assert.equal((await trace(widgetPage)).split(",").filter((entry) => entry === "signIn").length, 1, "one callback token permits one auth attempt");
      assert.equal(await widgetPage.evaluate(() => Object.values(localStorage).concat(Object.values(sessionStorage)).some((value) => String(value).includes("fixture-token"))), false);
      assert.equal(widgetDiagnostics.some((value) => value.includes("fixture-token") || value.includes("fixture-private-error")), false, "token and provider errors stay out of browser diagnostics");
    });
    await widgetPage.close();

    const failedScriptPage = await context.newPage();
    await failedScriptPage.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
    await failedScriptPage.goto(origin, { waitUntil: "networkidle" });
    await select(failedScriptPage, "login-captcha-prepare-script-failed");
    await failedScriptPage.locator(".legal-harness__surface .auth-turnstile").waitFor();
    await fillAuth(failedScriptPage);
    await failedScriptPage.waitForFunction(() => document.querySelector("output")?.textContent?.includes("signIn"));
    await checkWidget("WIDGET_PREPARE_SCRIPT_FAILURE_PERMISSIVE", async () => {
      assert.match(await trace(failedScriptPage), /tokenPresent:false,signIn/);
    });
    await failedScriptPage.close();

    const clockPage = await context.newPage();
    await clockPage.clock.install({ time: new Date(fixedNow) });
    await clockPage.addInitScript(() => {
      const setIntervalOriginal = window.setInterval.bind(window);
      const clearIntervalOriginal = window.clearInterval.bind(window);
      window.__cooldownTimerIds = new Set();
      window.setInterval = (callback, delay, ...args) => {
        const id = setIntervalOriginal(callback, delay, ...args);
        if (delay === 1000) window.__cooldownTimerIds.add(id);
        return id;
      };
      window.clearInterval = (id) => { window.__cooldownTimerIds.delete(id); return clearIntervalOriginal(id); };
    });
    await clockPage.goto(origin, { waitUntil: "networkidle" });
    await select(clockPage, "register-abuse-initial");
    await fillAuth(clockPage);
    await clockPage.waitForFunction(() => document.querySelector("output")?.textContent?.includes("signUp"));
    await check("FIRST_SIGNUP_RESEND_COOLDOWN_MISSING", async () => {
      const remaining = await clockPage.evaluate((key) => Number(localStorage.getItem(key)) - Date.now(), cooldownKey);
      assert.equal(remaining > 0 && remaining <= 60_000, true, "accepted first signup must persist a 60-second expiry");
    });
    await check("RESEND_AVAILABLE_IMMEDIATELY_AFTER_INITIAL_EMAIL", async () => {
      const resend = clockPage.locator(".legal-harness__surface .auth-resend button");
      assert.equal(await resend.isDisabled(), true, "resend must be disabled immediately after accepted signup");
      assert.match((await resend.textContent()) ?? "", /60/, "initial resend countdown must start at 60 seconds");
      assert.equal(await clockPage.evaluate(() => window.__cooldownTimerIds.size), 1, "one active countdown timer");
    });
    await check("INITIAL_COOLDOWN_TICKS_AND_RESTORES", async () => {
      await clockPage.clock.runFor(1000);
      assert.match((await clockPage.locator(".legal-harness__surface .auth-resend button").textContent()) ?? "", /59/);
      assert.equal(await clockPage.evaluate(() => window.__cooldownTimerIds.size), 1, "refresh restores one countdown timer");
      assert.equal(await clockPage.evaluate(() => sessionStorage.getItem("auth-pending-verification-email")), "qa@example.invalid");
      await clockPage.reload({ waitUntil: "networkidle" });
      await select(clockPage, "register-abuse-initial", true);
      await clockPage.locator(".legal-harness__surface .auth-resend button").waitFor();
      assert.equal(await clockPage.locator(".legal-harness__surface .auth-resend button").count(), 1, "refresh restores pending request");
      assert.match((await clockPage.locator(".legal-harness__surface .auth-alert--success").allTextContents()).join(" "), /如果这是新邮箱/);
      assert.match((await clockPage.locator(".legal-harness__surface .auth-resend button").textContent()) ?? "", /59/);
      assert.equal(await clockPage.evaluate(() => sessionStorage.getItem("auth-pending-verification-email")), "qa@example.invalid", "pending email has no invented 24h validity record");
    });
    await check("COOLDOWN_EXPIRES_ONCE_AND_RESEND_RESTARTS", async () => {
      assert.equal(await clockPage.evaluate((key) => localStorage.getItem(key) !== null, cooldownKey), true, "initial cooldown must exist before expiry test");
      await clockPage.clock.runFor(60_000);
      const resend = clockPage.locator(".legal-harness__surface .auth-resend button");
      await clockPage.waitForFunction((key) => localStorage.getItem(key) === null, cooldownKey);
      assert.equal(await resend.isDisabled(), false);
      assert.equal(await clockPage.evaluate((key) => localStorage.getItem(key), cooldownKey), null);
      assert.equal(await clockPage.evaluate(() => window.__cooldownTimerIds.size), 0, "expiry cleans up the timer");
      let posts = 0;
      await clockPage.route("**/api/auth/resend-confirmation", (route) => { posts++; return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); });
      await resend.click();
      await clockPage.waitForFunction((key) => Number(localStorage.getItem(key)) > Date.now(), cooldownKey);
      assert.equal(posts, 1);
      assert.equal(await resend.isDisabled(), true);
      assert.match((await resend.textContent()) ?? "", /60/);
    });
    await check("REFRESH_CLEARS_EXPIRED_OR_INVALID_COOLDOWN", async () => {
      for (const storedValue of ["expired", "not-an-expiry"]) {
        await clockPage.evaluate(([key, value]) => localStorage.setItem(key, value === "expired" ? String(Date.now() - 1000) : value), [cooldownKey, storedValue]);
        await clockPage.reload({ waitUntil: "networkidle" });
        await select(clockPage, "register-abuse-initial", true);
        const resend = clockPage.locator(".legal-harness__surface .auth-resend button");
        await resend.waitFor();
        assert.equal(await resend.isDisabled(), false, "stale cooldown must leave resend available");
        assert.equal(await clockPage.evaluate((key) => localStorage.getItem(key), cooldownKey), null, "mount must remove stale cooldown storage");
        assert.equal(await clockPage.evaluate(() => sessionStorage.getItem("auth-pending-verification-email")), "qa@example.invalid");
      }
    });
    await clockPage.close();

    const retryPage = await context.newPage();
    await retryPage.clock.install({ time: new Date(fixedNow) });
    await retryPage.goto(origin, { waitUntil: "networkidle" });
    await retryPage.evaluate((key) => localStorage.removeItem(key), cooldownKey);
    await select(retryPage, "register-abuse-retry-fails");
    await fillAuth(retryPage);
    await retryPage.waitForFunction((key) => Number(localStorage.getItem(key)) > Date.now(), cooldownKey);
    await check("FAILED_SIGNUP_RETRY_PRESERVES_ACCEPTED_PENDING", async () => {
      const surface = retryPage.locator(".legal-harness__surface");
      const initialExpiry = await retryPage.evaluate((key) => localStorage.getItem(key), cooldownKey);
      assert.equal(await retryPage.evaluate((key) => Number(localStorage.getItem(key)) > Date.now(), cooldownKey), true);
      await surface.locator('button[type="submit"]').click();
      await surface.locator(".auth-alert--error").waitFor();
      assert.match((await surface.locator(".auth-alert--error").textContent()) ?? "", /refresh.*try again|刷新页面后重试/i);
      assert.equal(await surface.locator(".auth-alert--success").count(), 0, "failed retry must not claim a new email was sent");
      assert.equal(await retryPage.evaluate(() => sessionStorage.getItem("auth-pending-verification-email")), "qa@example.invalid");
      assert.equal(await retryPage.evaluate((key) => localStorage.getItem(key), cooldownKey), initialExpiry);
      assert.equal(await surface.locator(".auth-resend button").isDisabled(), true);
      await retryPage.reload({ waitUntil: "networkidle" });
      await select(retryPage, "register-abuse-retry-fails", true);
      const restoredResend = retryPage.locator(".legal-harness__surface .auth-resend button");
      await restoredResend.waitFor();
      assert.equal(await restoredResend.isDisabled(), true);
      assert.equal(await retryPage.evaluate(() => sessionStorage.getItem("auth-pending-verification-email")), "qa@example.invalid");
      assert.equal(await retryPage.evaluate((key) => localStorage.getItem(key), cooldownKey), initialExpiry);
    });
    await retryPage.close();

    const changedEmailPage = await context.newPage();
    await changedEmailPage.clock.install({ time: new Date(fixedNow) });
    await changedEmailPage.goto(origin, { waitUntil: "networkidle" });
    await select(changedEmailPage, "register-abuse-retry-fails");
    await fillAuth(changedEmailPage);
    await changedEmailPage.waitForFunction(() => document.querySelector(".legal-harness__surface .auth-resend button"));
    await check("CHANGED_EMAIL_FAILED_RETRY_EXPLAINS_PRIOR_PENDING_REQUEST", async () => {
      const surface = changedEmailPage.locator(".legal-harness__surface");
      const initialExpiry = await changedEmailPage.evaluate((key) => localStorage.getItem(key), cooldownKey);
      await surface.locator('input[type="email"]').fill("different@example.invalid");
      await surface.locator('button[type="submit"]').click();
      await surface.locator(".auth-alert--error").waitFor();
      assert.match((await surface.locator(".auth-alert--error").textContent()) ?? "", /refresh.*try again|刷新页面后重试/i);
      assert.match((await surface.locator(".auth-feedback").textContent()) ?? "", /如果这是新邮箱，我们会发送验证邮件/, "the prior accepted request retains conditional pending guidance");
      assert.match((await surface.locator(".auth-resend").textContent()) ?? "", /qa@example\.invalid/, "resend is linked to the earlier accepted email");
      assert.equal((await surface.locator(".auth-resend").textContent())?.includes("different@example.invalid"), false, "resend does not refer to the failed retry email");
      assert.equal(await surface.locator(".auth-alert--success").count(), 0, "failed retry must not claim a new request or email succeeded");
      assert.equal(await changedEmailPage.evaluate(() => sessionStorage.getItem("auth-pending-verification-email")), "qa@example.invalid");
      assert.equal(await changedEmailPage.evaluate((key) => localStorage.getItem(key), cooldownKey), initialExpiry);
      assert.equal(await surface.locator(".auth-resend button").isDisabled(), true);
    });
    await changedEmailPage.close();

    const longPendingEmail = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(49)}.invalid`;
    const longEmailPage = await context.newPage();
    await longEmailPage.addInitScript((email) => sessionStorage.setItem("auth-pending-verification-email", email), longPendingEmail);
    await longEmailPage.goto(origin, { waitUntil: "networkidle" });
    await select(longEmailPage, "register-abuse-initial", true);
    await longEmailPage.locator(".legal-harness__surface .auth-resend__hint").waitFor();
    await check("LONG_PENDING_EMAIL_HINT_MOBILE_CONTAINMENT", async () => {
      const hint = longEmailPage.locator(".legal-harness__surface .auth-resend__hint");
      assert.equal((await hint.textContent())?.includes(longPendingEmail), true, "the full pending email must remain visible");
      for (const width of [390, 430]) {
        await longEmailPage.setViewportSize({ width, height: 850 });
        const bounds = await longEmailPage.evaluate(() => {
          const hint = document.querySelector(".legal-harness__surface .auth-resend__hint");
          const box = hint.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(hint);
          const textRight = Math.max(...Array.from(range.getClientRects(), (rect) => rect.right));
          return { left: box.left, right: box.right, textRight, scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };
        });
        assert.equal(bounds.left >= 0 && bounds.right <= bounds.viewportWidth, true, `${width}px hint bounds: ${JSON.stringify(bounds)}`);
        assert.equal(bounds.textRight <= bounds.right, true, `${width}px hint text bounds: ${JSON.stringify(bounds)}`);
        assert.equal(bounds.scrollWidth <= bounds.viewportWidth, true, `${width}px document width: ${JSON.stringify(bounds)}`);
        console.log(`LONG_PENDING_EMAIL_${width}PX_DOM: ${JSON.stringify(bounds)}`);
      }
    });
    await longEmailPage.close();

    for (const [scenario, expectedToken] of [["register-abuse-required", null], ["register-captcha-prepare-token", "fixture-token"], ["register-abuse-initial", undefined]]) {
      const resendPage = await context.newPage();
      await resendPage.addInitScript(() => sessionStorage.setItem("auth-pending-verification-email", "qa@example.invalid"));
      const requests = [];
      await resendPage.route("**/api/auth/resend-confirmation", (route) => {
        requests.push(route.request().postDataJSON());
        return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      });
      await resendPage.goto(origin, { waitUntil: "networkidle" });
      await resendPage.evaluate((key) => localStorage.removeItem(key), cooldownKey);
      await select(resendPage, scenario, true);
      const resend = resendPage.locator(".legal-harness__surface .auth-resend button");
      await resend.waitFor();
      await resend.click();
      if (expectedToken === null) {
        await resendPage.waitForFunction(() => document.querySelector(".legal-harness__surface .auth-alert--error") || document.querySelector(".legal-harness__surface .auth-resend button:disabled"));
        await check("REQUIRED_RESEND_WITHOUT_PROOF_BLOCKS_FETCH", async () => {
          assert.deepEqual(requests, []);
        });
      } else {
        await resendPage.waitForFunction(() => document.querySelector("output")?.textContent?.includes("resetToken") || document.querySelector(".auth-resend button:disabled"));
        await check(expectedToken ? "PREPARE_RESEND_FORWARDS_FRESH_TOKEN" : "OFF_RESEND_PRESERVES_NO_TOKEN_REQUEST", async () => {
          assert.equal(requests.length, 1);
          assert.equal(requests[0].captchaToken, expectedToken);
        });
      }
      await resendPage.close();
    }

    for (const [scenario, label] of [["register-abuse-initial", "STALE_OFF_RESEND_AFTER_ENFORCEMENT"], ["register-captcha-prepare-token", "STALE_PREPARE_RESEND_AFTER_ENFORCEMENT"]]) {
      const stalePage = await context.newPage();
      await stalePage.addInitScript(() => sessionStorage.setItem("auth-pending-verification-email", "qa@example.invalid"));
      await stalePage.route("**/api/auth/resend-confirmation", (route) => route.fulfill({ status: 400, contentType: "application/json", body: '{"ok":false,"error":"CAPTCHA_RETRY"}' }));
      await stalePage.goto(origin, { waitUntil: "networkidle" });
      await stalePage.evaluate((key) => localStorage.removeItem(key), cooldownKey);
      await select(stalePage, scenario, true);
      await stalePage.locator(".legal-harness__surface .auth-resend button").click();
      await stalePage.locator(".legal-harness__surface .auth-alert--error").waitFor();
      await check(label, async () => {
        const surface = stalePage.locator(".legal-harness__surface");
        assert.match((await surface.locator(".auth-alert--error").textContent()) ?? "", /刷新页面后重试/);
        assert.equal(await surface.locator(".auth-alert--success").count(), 0);
        assert.equal(await surface.locator(".auth-resend button").isDisabled(), false);
        assert.equal(await stalePage.evaluate((key) => localStorage.getItem(key), cooldownKey), null);
      });
      await stalePage.close();
    }

    const wiredPage = await context.newPage();
    await wiredPage.addInitScript(() => sessionStorage.setItem("auth-pending-verification-email", "qa@example.invalid"));
    let wiredRequest;
    let wiredResponse;
    const wiredCalls = { limit: 0, provider: 0 };
    const wiredPost = createResendPost({
      resend: async () => { wiredCalls.provider++; return { error: null }; },
      consumeLimit: async () => { wiredCalls.limit++; return { allowed: true, reason: "ALLOWED" }; },
      observe: () => {},
    });
    await wiredPage.route("**/api/auth/resend-confirmation", async (route) => {
      wiredRequest = route.request().postDataJSON();
      setCloudflareWorkersTestBinding({ RATE_LIMIT_SALT: "fixture-salt", AUTH_CAPTCHA_MODE: "required" });
      const response = await wiredPost({ request: new Request(route.request().url(), {
        method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.1" }, body: route.request().postData(),
      }), locals: {} });
      wiredResponse = { status: response.status, body: await response.json() };
      await route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(wiredResponse.body) });
    });
    await wiredPage.goto(origin, { waitUntil: "networkidle" });
    await wiredPage.evaluate((key) => localStorage.removeItem(key), cooldownKey);
    await select(wiredPage, "register-abuse-initial", true);
    await wiredPage.locator(".legal-harness__surface .auth-resend button").click();
    await wiredPage.locator(".legal-harness__surface .auth-alert--error").waitFor();
    await check("STALE_OFF_WIRED_REQUIRED_ROUTE", async () => {
      assert.equal(wiredRequest.captchaToken, undefined);
      assert.deepEqual(wiredResponse, { status: 400, body: { ok: false, error: "BOT_PROOF_REQUIRED" } });
      assert.deepEqual(wiredCalls, { limit: 0, provider: 0 });
      const surface = wiredPage.locator(".legal-harness__surface");
      assert.match((await surface.locator(".auth-alert--error").textContent()) ?? "", /刷新页面后重试/);
      assert.equal(await surface.locator(".auth-alert--success").count(), 0);
      assert.equal(await surface.locator(".auth-resend button").isDisabled(), false);
    });
    await wiredPage.close();

    const page = await context.newPage();
    await page.clock.install({ time: new Date(fixedNow) });
    await page.goto(origin, { waitUntil: "networkidle" });
    await select(page, "login-abuse-off");
    await page.getByRole("button", { name: "忘记密码？", exact: true }).click();
    await check("FORGOT_PASSWORD_STILL_SHOWS_LOGIN_SIGNUP_TABS", async () => {
      assert.equal(await page.locator(".legal-harness__surface [role='tablist']").count(), 0, "recovery must omit the login/signup tabs");
    });
    await check("FORGOT_MODE_CONTROLS_AND_BACK", async () => {
      const surface = page.locator(".legal-harness__surface");
      assert.equal(await surface.locator('input[type="password"]').count(), 0);
      assert.equal(await surface.locator(".auth-signup-notice").count(), 0);
      assert.equal(await surface.locator('input[type="email"]').count(), 1);
      await surface.locator('input[type="email"]').fill("qa@example.invalid");
      await surface.getByRole("button", { name: "返回登录" }).click();
      assert.equal(await surface.locator('input[type="email"]').inputValue(), "qa@example.invalid");
      assert.equal(await surface.locator("[role='tablist']").count(), 1);
    });

    await select(page, "register-abuse-required");
    await fillAuthFields(page);
    await submitAndWaitForAuthAttempt(page, "signUp");
    await crossDelayedCallBarrier(page);
    await check("SIGNUP_EMAIL_SEND_WITHOUT_BOT_PROOF", async () => {
      assert.deepEqual(await authSdkCalls(page), [], "required mode must not enter signup SDK without proof");
      assert.equal((await trace(page)).includes("signUp"), false, "required mode must not call signup SDK without proof");
    });

    await select(page, "login-abuse-required");
    await page.getByRole("button", { name: "忘记密码？", exact: true }).click();
    await page.locator('.legal-harness__surface input[type="email"]').fill("qa@example.invalid");
    await submitAndWaitForAuthAttempt(page, "resetCallbackSafe");
    await crossDelayedCallBarrier(page);
    await check("PASSWORD_RESET_EMAIL_WITHOUT_BOT_PROOF", async () => {
      assert.deepEqual(await authSdkCalls(page), [], "required mode must not enter reset SDK without proof");
      assert.equal((await trace(page)).includes("resetCallbackSafe:"), false, "required mode must not call reset SDK without proof");
    });

    await select(page, "login-abuse-required");
    await fillAuthFields(page);
    await submitAndWaitForAuthAttempt(page, "signIn");
    await crossDelayedCallBarrier(page);
    await check("PASSWORD_LOGIN_WITHOUT_BOT_PROOF", async () => {
      assert.deepEqual(await authSdkCalls(page), [], "required mode must not enter sign-in SDK without proof");
      assert.equal((await trace(page)).split(",").filter((call) => call === "signIn").length, 0, "required mode must make zero sign-in SDK calls without a fresh token");
    });

    for (const mode of ["off", "prepare"]) {
      await select(page, `login-abuse-${mode}`);
      await fillAuth(page);
      await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("signIn,navigate:/feed/"));
      assert.equal(await trace(page), "signIn,navigate:/feed/", `${mode} login remains permissive without a widget`);
    }
    console.log("OFF_AND_PREPARE_LOGIN_WITHOUT_WIDGET: PASS");

    await select(page, "locale-en");
    await select(page, "register-abuse-obfuscated");
    await fillAuth(page);
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("signUp"));
    await check("EXISTING_ACCOUNT_FALSE_CHECK_INBOX_STATE", async () => {
      const surface = page.locator(".legal-harness__surface");
      const successCopy = (await surface.locator(".auth-feedback .auth-alert--success").allTextContents()).map((value) => value.replace(/\s+/g, " ").trim());
      assert.deepEqual(successCopy, ["If this is a new email, we will send a verification email. If you already have an account, log in or use Forgot password."], "obfuscated signup must show only the approved conditional pending copy");
      assert.equal(await surface.getByRole("button", { name: /forgot password/i }).count(), 1, "pending state must offer direct recovery");
      assert.equal(await surface.getByRole("button", { name: /log in/i }).count() > 0, true, "pending state must offer direct login");
    });
    for (const scenario of ["register-abuse-initial", "register-abuse-duplicate", "register-abuse-obfuscated", "register-abuse-unconfirmed"]) {
      if (scenario === "register-abuse-duplicate") await select(page, "login-abuse-off");
      await select(page, scenario);
      await fillAuth(page);
      await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("signUp"));
      await check(`GENERIC_SIGNUP_${scenario.toUpperCase().replaceAll("-", "_")}`, async () => {
        const surface = page.locator(".legal-harness__surface");
        const feedback = (await surface.locator(".auth-feedback").textContent()) ?? "";
        assert.match(feedback, /If this is a new email, we will send a verification email/);
        assert.equal(await surface.getByRole("button", { name: "Forgot password?" }).count(), 1);
        assert.equal(await surface.getByRole("button", { name: "Log in", exact: true }).count(), 1);
        if (scenario === "register-abuse-duplicate") assert.equal(await surface.locator(".auth-resend button").count(), 0, "explicit duplicate does not expose resend");
      });
    }
    for (const mode of ["off", "prepare"]) {
      for (const flow of ["login", "register", "reset"]) {
        await select(page, `${flow === "register" ? "register" : "login"}-${flow === "reset" ? "reset-" : "abuse-"}${mode}-stale`);
        if (flow === "reset") {
          await page.getByRole("button", { name: "Forgot password?" }).click();
          await page.locator('.legal-harness__surface input[type="email"]').fill("qa@example.invalid");
          await page.locator('.legal-harness__surface button[type="submit"]').click();
        } else await fillAuth(page);
        await page.waitForFunction((sdk) => window.__authSdkCalls.length === 1 && window.__authSdkCalls[0] === sdk, flow === "login" ? "signInWithPassword" : flow === "register" ? "signUp" : "requestPasswordReset");
        await page.locator(".legal-harness__surface .auth-alert--error").waitFor();
        await check(`STALE_${mode.toUpperCase()}_${flow.toUpperCase()}_AFTER_ENFORCEMENT`, async () => {
          const surface = page.locator(".legal-harness__surface");
          const error = (await surface.locator(".auth-alert--error").textContent()) ?? "";
          assert.match(error, /refresh.*try again/i);
          assert.equal(await surface.locator(".auth-alert--success").count(), 0);
          assert.equal((await trace(page)).includes("navigate:"), false);
        });
      }
    }
    await select(page, "register-captcha-prepare-token");
    await fillAuth(page);
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("signUp"));
    await check("SIGNUP_SDK_FRESH_TOKEN_ARGUMENT", async () => {
      assert.match(await trace(page), /acquireToken,tokenPresent:true,signUp,resetToken/);
    });
    await select(page, "login-reset-prepare-token");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await page.locator('.legal-harness__surface input[type="email"]').fill("qa@example.invalid");
    await page.locator('.legal-harness__surface button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("resetCallbackSafe"));
    await check("RECOVERY_SDK_FRESH_TOKEN_AND_CONDITIONAL_RESULT", async () => {
      assert.match(await trace(page), /acquireToken,tokenPresent:true,resetCallbackSafe:true,resetToken/);
      assert.match((await page.locator(".legal-harness__surface .auth-alert--success").textContent()) ?? "", /If an account exists.*reset email/i);
    });
    assert.equal(blocked, 0, "browser fixture made no external request");
    console.log(`BROWSER_EXTERNAL_REQUESTS: ${blocked}`);
    await context.close();
  } finally {
    if (browser) await browser.close();
    await harness.close();
    await routeVite.close();
  }
}

async function main() {
  await checkResendApi();
  await checkBrowser();
  console.log(`AUTH_EMAIL_ABUSE_UX ${8 - red.length}/8 original PASS; ${red.length}/8 original RED; ${widgetRed.length} widget RED`);
  if (red.length || widgetRed.length) process.exitCode = 1;
}

main().catch((error) => { console.error("AUTH_EMAIL_ABUSE_UX_SETUP_FAIL", error.message); process.exitCode = 2; });
