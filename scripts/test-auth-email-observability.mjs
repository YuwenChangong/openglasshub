import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import { cloudflareWorkersTestPlugin, setCloudflareWorkersTestBinding } from "./lib/cloudflare-workers-test-plugin.mjs";

async function loadChromium() {
  try { return (await import("playwright")).chromium; } catch { /* desktop runtime fallback */ }
  const runtimeRoot = path.join(process.env.LOCALAPPDATA ?? "", "OpenAI", "Codex", "runtimes", "cua_node");
  for (const entry of (await fs.readdir(runtimeRoot)).sort().reverse()) {
    const candidate = path.join(runtimeRoot, entry, "bin", "node_modules", "playwright", "index.mjs");
    try { await fs.access(candidate); return (await import(pathToFileURL(candidate).href)).chromium; } catch { /* next runtime */ }
  }
  throw new Error("Playwright runtime unavailable");
}

const apiUrl = "http://127.0.0.1:4388/api/auth/resend-confirmation";
const validContext = (email = "qa@example.invalid", next = "/feed/", captchaToken) => ({
  request: new Request(apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.1" },
    body: JSON.stringify({ email, next, ...(captchaToken === undefined ? {} : { captchaToken }) }),
  }),
  locals: {},
});

async function main() {
  setCloudflareWorkersTestBinding({ RATE_LIMIT_SALT: "fixture-salt" });
  const originalFetch = globalThis.fetch;
  let externalAttempts = 0;
  globalThis.fetch = async () => { externalAttempts += 1; throw new Error("external networking denied"); };
  const vite = await createServer({ root: process.cwd(), logLevel: "error", plugins: [cloudflareWorkersTestPlugin()], server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
  try {
    const { createResendPost } = await vite.ssrLoadModule("/src/pages/api/auth/resend-confirmation.ts");
    async function run(resend, options = {}) {
      setCloudflareWorkersTestBinding({ RATE_LIMIT_SALT: "fixture-salt", AUTH_CAPTCHA_MODE: options.mode ?? "off" });
      const events = [];
      const calls = { limit: 0, resend: 0 };
      const post = createResendPost({
        resend: async (email, redirectTo, captchaToken) => { calls.resend += 1; calls.captchaToken = captchaToken; assert.equal(email, "qa@example.invalid"); assert.equal(redirectTo, "http://127.0.0.1:4388/auth/callback/?next=%2Ffeed%2F"); return resend(); },
        consumeLimit: async (input) => { calls.limit += 1; assert.deepEqual([input.maxAttempts, input.windowHours], [5, 24]); assert.match(input.ipHash, /^[a-f0-9]{64}$/); return options.limit ?? { allowed: true, reason: "ALLOWED" }; },
        observe: (event) => { events.push(event); if (options.observerThrows) throw new Error("fixture observer payload"); },
      });
      const response = await post(validContext(options.email, options.next, options.captchaToken));
      return { response, body: await response.json(), events, calls };
    }

    for (const mode of ["off", "prepare"]) {
      const result = await run(async () => ({ error: null }), { mode });
      assert.deepEqual([result.response.status, result.calls.limit, result.calls.resend, result.calls.captchaToken], [200, 1, 1, undefined]);
    }
    const prepared = await run(async () => ({ error: null }), { mode: "prepare", captchaToken: "fixture-token" });
    assert.deepEqual([prepared.calls.limit, prepared.calls.resend, prepared.calls.captchaToken], [1, 1, "fixture-token"]);
    const missing = await run(async () => ({ error: null }), { mode: "required" });
    assert.deepEqual([missing.response.status, missing.calls.limit, missing.calls.resend], [400, 0, 0]);
    assert.equal(missing.body.error, "BOT_PROOF_REQUIRED");
    for (const captchaToken of ["", "  ", 42, "x".repeat(4097)]) {
      const malformed = await run(async () => ({ error: null }), { mode: "prepare", captchaToken });
      assert.deepEqual([malformed.response.status, malformed.calls.limit, malformed.calls.resend], [400, 0, 0]);
    }
    const required = await run(async () => ({ error: null }), { mode: "required", captchaToken: "fixture-token" });
    assert.deepEqual([required.calls.limit, required.calls.resend, required.calls.captchaToken], [1, 1, "fixture-token"]);
    const deniedProof = await run(async () => ({ error: null }), { mode: "required", captchaToken: "fixture-token", limit: { allowed: false, reason: "RATE_LIMITED" } });
    assert.deepEqual([deniedProof.response.status, deniedProof.calls.limit, deniedProof.calls.resend], [429, 1, 0]);
    const captchaError = { status: 400, code: "captcha_failed", message: "fixture-sensitive-payload" };
    for (const mode of ["prepare", "required"]) {
      const rejected = await run(async () => ({ error: captchaError }), { mode, captchaToken: mode === "required" ? "fixture-token" : undefined });
      assert.deepEqual([rejected.response.status, rejected.body.error, rejected.calls.limit, rejected.calls.resend], [400, "CAPTCHA_RETRY", 1, 1]);
      assert.doesNotMatch(JSON.stringify(rejected.body) + JSON.stringify(rejected.events), /fixture-sensitive-payload|fixture-token/);
    }
    const thrownCaptcha = await run(async () => { throw captchaError; }, { mode: "required", captchaToken: "fixture-token" });
    assert.equal(thrownCaptcha.body.error, "CAPTCHA_RETRY");
    const loginSource = await fs.readFile(path.join(process.cwd(), "src", "pages", "login", "index.astro"), "utf8");
    assert.match(loginSource, /parseAuthCaptchaMode\(runtimeEnv\.AUTH_CAPTCHA_MODE\)/);
    assert.match(loginSource, /Astro\.response\.headers\.set\("Cache-Control", "no-store"\)/);
    console.log("resendCaptchaModeAndLimiterMatrix: PASS");

    const returned = await run(async () => ({ error: { status: 503, message: "fixture-sensitive-payload" } }));
    assert.equal(returned.response.status, 503);
    assert.deepEqual(returned.body, { ok: false, error: "RESEND_CONFIRMATION_FAILED" });
    assert.equal(returned.events[0].outcome, "unavailable", "returnedProviderErrorObserved");
    assert.deepEqual(Object.keys(returned.events[0]).sort(), ["durationMs", "flow", "outcome", "stage"]);
    assert.doesNotMatch(JSON.stringify(returned.events), /fixture-sensitive-payload|qa@example|192\.0\.2\.1/);
    console.log("returnedProviderErrorObserved: PASS");

    const thrown = await run(async () => { throw { status: 429, message: "fixture-sensitive-payload" }; });
    assert.deepEqual(thrown.body, returned.body);
    assert.equal(thrown.events[0].outcome, "rate_limited", "thrownProviderErrorObserved");
    console.log("thrownProviderErrorObserved: PASS");

    const accepted = await run(async () => ({ error: null }));
    const unknown = await run(async () => ({ error: { status: 400, message: "fixture unknown recipient" } }));
    assert.deepEqual(unknown.body, accepted.body, "unknownRecipientIndistinguishable");
    assert.equal(accepted.events[0].outcome, "accepted");
    assert.equal(unknown.events[0].outcome, "rejected");
    console.log("unknownRecipientIndistinguishable: PASS");

    const denied = await run(async () => ({ error: null }), { limit: { allowed: false, reason: "RATE_LIMITED" } });
    assert.equal(denied.response.status, 429);
    assert.equal(denied.calls.resend, 0);
    assert.equal(denied.events[0].outcome, "rate_limited");
    const observerThrow = await run(async () => ({ error: null }), { observerThrows: true });
    assert.deepEqual(observerThrow.body, accepted.body);
    const unavailableLimit = await run(async () => ({ error: null }), { limit: { allowed: false, reason: "RATE_LIMIT_SERVICE_UNAVAILABLE" } });
    assert.equal(unavailableLimit.response.status, 500);
    assert.equal(unavailableLimit.calls.resend, 0);
    assert.equal(unavailableLimit.events[0].outcome, "unavailable");
    const invalid = await createResendPost({
      resend: async () => { throw new Error("unexpected resend"); },
      consumeLimit: async () => { throw new Error("unexpected limiter"); },
      observe: () => { throw new Error("unexpected observation"); },
    })(validContext("invalid"));
    assert.equal(invalid.status, 400);
    console.log("limiterAndObserverIsolation: PASS");

    const { classifyAuthEmailFailure } = await vite.ssrLoadModule("/src/lib/server/auth-email-observability.ts");
    assert.equal(classifyAuthEmailFailure({ status: 400, message: "fixture private" }), "rejected");
    assert.equal(classifyAuthEmailFailure({ status: 429 }), "rate_limited");
    assert.equal(classifyAuthEmailFailure(new Error("fixture private")), "unavailable");
    for (const value of [0, false, ""]) {
      const falsy = await run(async () => ({ error: value }));
      assert.deepEqual(falsy.body, returned.body);
      assert.equal(falsy.events[0]?.outcome, "unavailable", "non-null falsy provider error must not be accepted");
    }
    const hostile = { get status() { throw new Error("fixture private getter detail"); } };
    const hostileThrown = await run(async () => { throw hostile; });
    assert.deepEqual(hostileThrown.body, returned.body, "hostile thrown provider error must keep generic public response");
    assert.equal(hostileThrown.events[0]?.outcome, "unavailable");
    assert.equal(classifyAuthEmailFailure(hostile), "unavailable");
    console.log("hostileAndFalsyProviderErrors: PASS");

    assert.equal(externalAttempts, 0, "external networking denied and zero attempts");
  } finally {
    await vite.close();
    globalThis.fetch = originalFetch;
  }
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
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "networkidle" });
    for (const [scenario, expectedText, failed] of [
      ["login-reset-safe-callback", "如果账号存在", false],
      ["login-reset-returned-error", "暂时无法请求重置邮件", true],
      ["login-reset-thrown-error", "暂时无法请求重置邮件", true],
    ]) {
      await page.getByRole("button", { name: scenario, exact: true }).click();
      await page.getByRole("button", { name: "忘记密码？", exact: true }).click();
      await page.locator('.legal-harness__surface input[type="email"]').fill("qa@example.invalid");
      await page.getByRole("button", { name: "发送重置邮件", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("resetCallbackSafe:true"));
      assert.match(await page.locator(".legal-harness__surface").textContent(), new RegExp(expectedText));
      if (failed) assert.doesNotMatch(await page.locator(".legal-harness__surface").textContent(), /如果账号存在/);
      assert.doesNotMatch(await page.locator(".legal-harness__surface").textContent(), /fixture private provider detail/);
    }
    assert.equal(blocked, 0);
    console.log("resetRequestUsesSafeCallback: PASS");
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
  assert.equal(externalAttempts, 0);
}

main().catch((error) => { console.error("AUTH_EMAIL_OBSERVABILITY_FAIL", error.message); process.exitCode = 1; });
