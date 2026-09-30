import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import { cloudflareWorkersTestPlugin, setCloudflareWorkersTestBinding } from "./lib/cloudflare-workers-test-plugin.mjs";

const cooldownKey = "auth-resend-confirmation-cooldown-until";
const fixedNow = Date.parse("2026-09-30T00:00:00.000Z");
const red = [];

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
    await page.goto(origin, { waitUntil: "networkidle" });
    await select(page, "login-abuse-off");
    await page.getByRole("button", { name: "忘记密码？", exact: true }).click();
    await check("FORGOT_PASSWORD_STILL_SHOWS_LOGIN_SIGNUP_TABS", async () => {
      assert.equal(await page.locator(".legal-harness__surface [role='tablist']").count(), 0, "recovery must omit the login/signup tabs");
    });

    await select(page, "register-abuse-required");
    await fillAuthFields(page);
    await submitAndWaitForAuthAttempt(page, "signUp");
    await check("SIGNUP_EMAIL_SEND_WITHOUT_BOT_PROOF", async () => {
      assert.equal((await trace(page)).includes("signUp"), false, "required mode must not call signup SDK without proof");
    });

    await select(page, "login-abuse-required");
    await page.getByRole("button", { name: "忘记密码？", exact: true }).click();
    await page.locator('.legal-harness__surface input[type="email"]').fill("qa@example.invalid");
    await submitAndWaitForAuthAttempt(page, "resetCallbackSafe");
    await check("PASSWORD_RESET_EMAIL_WITHOUT_BOT_PROOF", async () => {
      assert.equal((await trace(page)).includes("resetCallbackSafe:"), false, "required mode must not call reset SDK without proof");
    });

    await select(page, "login-abuse-required");
    await fillAuthFields(page);
    await submitAndWaitForAuthAttempt(page, "signIn");
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
      const text = await surface.innerText();
      assert.doesNotMatch(text, /(?:^|[.!?\n]\s*)(?:check your inbox\b|(?:an?\s+)?(?:verification\s+)?email (?:sent|was sent|has been sent|is sent)\b|(?:we(?:'ve| have)?\s+)?sent (?:you\s+)?(?:an?\s+)?(?:verification\s+)?email\b)/i, "obfuscated signup must not claim email was sent or direct an unconditional inbox check");
      assert.equal(/if.*new.*email/i.test(text), true, "no-session obfuscated signup must use conditional new-email wording");
      assert.equal(await surface.getByRole("button", { name: /forgot password/i }).count(), 1, "pending state must offer direct recovery");
      assert.equal(await surface.getByRole("button", { name: /log in/i }).count() > 0, true, "pending state must offer direct login");
    });
    assert.equal(blocked, 0, "browser fixture made no external request");
    await context.close();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
}

async function main() {
  await checkResendApi();
  await checkBrowser();
  console.log(`AUTH_EMAIL_ABUSE_UX ${8 - red.length}/8 PASS; ${red.length}/8 RED assertion failures`);
  if (red.length) process.exitCode = 1;
}

main().catch((error) => { console.error("AUTH_EMAIL_ABUSE_UX_SETUP_FAIL", error.message); process.exitCode = 2; });
