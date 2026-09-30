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
  setCloudflareWorkersTestBinding({ RATE_LIMIT_SALT: "fixture-salt" });
  const originalFetch = globalThis.fetch;
  let externalAttempts = 0;
  globalThis.fetch = async () => { externalAttempts += 1; throw new Error("external networking denied"); };
  const vite = await createServer({ root: process.cwd(), logLevel: "error", plugins: [cloudflareWorkersTestPlugin()], server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
  try {
    const { createResendPost } = await vite.ssrLoadModule("/src/pages/api/auth/resend-confirmation.ts");
    let resendCalls = 0;
    let limitCalls = 0;
    const post = createResendPost({
      captchaMode: "required",
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

async function select(page, scenario) {
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
    await clockPage.goto(origin, { waitUntil: "networkidle" });
    await select(clockPage, "register-abuse-initial");
    await fillAuth(clockPage);
    await clockPage.waitForFunction(() => document.querySelector("output")?.textContent?.includes("signUp"));
    await check("FIRST_SIGNUP_RESEND_COOLDOWN_MISSING", async () => {
      assert.equal(await clockPage.evaluate((key) => localStorage.getItem(key), cooldownKey), String(fixedNow + 60_000), "accepted first signup must persist a 60-second expiry");
    });
    await check("RESEND_AVAILABLE_IMMEDIATELY_AFTER_INITIAL_EMAIL", async () => {
      const resend = clockPage.locator(".legal-harness__surface .auth-resend button");
      assert.equal(await resend.isDisabled(), true, "resend must be disabled immediately after accepted signup");
      assert.match((await resend.textContent()) ?? "", /60/, "initial resend countdown must start at 60 seconds");
    });
    await clockPage.close();

    const page = await context.newPage();
    await page.clock.install({ time: new Date(fixedNow) });
    await page.goto(origin, { waitUntil: "networkidle" });
    await select(page, "login-abuse-off");
    await page.getByRole("button", { name: "忘记密码？", exact: true }).click();
    await check("FORGOT_PASSWORD_STILL_SHOWS_LOGIN_SIGNUP_TABS", async () => {
      assert.equal(await page.locator(".legal-harness__surface [role='tablist']").count(), 0, "recovery must omit the login/signup tabs");
    });

    await select(page, "register-abuse-required");
    await fillAuthFields(page);
    await submitAndWaitForAuthAttempt(page, "signUp");
    await crossDelayedCallBarrier(page);
    await check("SIGNUP_EMAIL_SEND_WITHOUT_BOT_PROOF", async () => {
      assert.equal((await trace(page)).includes("signUp"), false, "required mode must not call signup SDK without proof");
    });

    await select(page, "login-abuse-required");
    await page.getByRole("button", { name: "忘记密码？", exact: true }).click();
    await page.locator('.legal-harness__surface input[type="email"]').fill("qa@example.invalid");
    await submitAndWaitForAuthAttempt(page, "resetCallbackSafe");
    await crossDelayedCallBarrier(page);
    await check("PASSWORD_RESET_EMAIL_WITHOUT_BOT_PROOF", async () => {
      assert.equal((await trace(page)).includes("resetCallbackSafe:"), false, "required mode must not call reset SDK without proof");
    });

    await select(page, "login-abuse-required");
    await fillAuthFields(page);
    await submitAndWaitForAuthAttempt(page, "signIn");
    await crossDelayedCallBarrier(page);
    await check("PASSWORD_LOGIN_WITHOUT_BOT_PROOF", async () => {
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
    assert.equal(blocked, 0, "browser fixture made no external request");
    console.log(`BROWSER_EXTERNAL_REQUESTS: ${blocked}`);
    await context.close();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
}

async function main() {
  await checkResendApi();
  await checkBrowser();
  console.log(`AUTH_EMAIL_ABUSE_UX ${8 - red.length}/8 original PASS; ${red.length}/8 original RED; ${widgetRed.length} widget RED`);
  if (red.length || widgetRed.length) process.exitCode = 1;
}

main().catch((error) => { console.error("AUTH_EMAIL_ABUSE_UX_SETUP_FAIL", error.message); process.exitCode = 2; });
