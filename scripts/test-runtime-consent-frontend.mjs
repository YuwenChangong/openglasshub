import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const evidence = path.resolve(".superpowers/hotfix-runtime-consent");
const origin = "http://127.0.0.1:4395";
const results = [];
async function check(name, run) {
  try { await run(); results.push({ name, status: "PASS" }); }
  catch (error) { results.push({ name, status: "FAIL", detail: error.message }); }
}
await fs.mkdir(evidence, { recursive: true });
const server = await createServer({ configFile: path.resolve("tests/visual/legal-consent-harness/vite.config.ts"), root: path.resolve("tests/visual/legal-consent-harness"), server: { host: "127.0.0.1", port: 4395, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
const context = await browser.newContext({ serviceWorkers: "block" });
const blocked = [];
await context.route("**/*", (route) => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  blocked.push(new URL(route.request().url()).origin); return route.abort();
});
await context.routeWebSocket("**/*", (socket) => {
  if (new URL(socket.url()).origin === origin.replace("http:", "ws:")) socket.connectToServer();
  else { blocked.push(new URL(socket.url()).origin); socket.close(); }
});
async function scenario(id, run) {
  const page = await context.newPage();
  try {
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: id, exact: true }).click();
    await run(page);
  } finally { await page.close(); }
}
const trace = (page) => page.locator("output").textContent();
async function fill(page) {
  await page.locator('input[type="email"]').fill("qa@example.invalid");
  await page.locator('input[type="password"]').fill("fixture-passphrase");
}
try {
  await check("LOGIN_NO_AGE_OR_LEGAL_CONTROLS", () => scenario("login-unchecked", async (page) => {
    assert.equal(await page.getByRole("checkbox").count(), 0, "login must have no age/legal controls");
    assert.equal(await page.locator('button[type="submit"]').isEnabled(), true);
    assert.equal(await page.locator(".auth-signup-notice").count(), 0);
  }));
  await check("LOGIN_NO_CONSENT_WRITE_DIRECT_NEXT", () => scenario("login-ready", async (page) => {
    await fill(page);
    // Unlock the original implementation only to observe its post-auth side effects.
    for (const box of await page.getByRole("checkbox").all()) await box.check();
    await page.locator('button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("navigate:"));
    assert.equal(await trace(page), "signIn,navigate:/feed/");
  }));
  await check("SIGNUP_NO_AGE_OR_LEGAL_GATE", () => scenario("register-unchecked", async (page) => {
    assert.equal(await page.getByRole("checkbox").count(), 0, "signup must not require age/legal acknowledgement");
    assert.equal(await page.locator('button[type="submit"]').isEnabled(), true);
    assert.equal(await page.locator(".auth-signup-notice").textContent(), "注册即表示你同意《服务条款》，并已阅读《隐私政策》和《社区准则》。");
    assert.deepEqual(await page.locator(".auth-signup-notice a").evaluateAll((links) => links.map((link) => link.getAttribute("href"))), ["/terms/", "/privacy/", "/community-guidelines/"]);
  }));
  await check("SIGNUP_VERIFICATION_RETAINED", () => scenario("register-email-confirmation-no-session", async (page) => {
    await fill(page);
    for (const box of await page.getByRole("checkbox").all()) await box.check();
    await page.locator('button[type="submit"]').click();
    await page.getByText("如果这是新邮箱，我们会发送验证邮件。如果你已经注册过，请直接登录或使用“忘记密码”。", { exact: true }).waitFor();
    assert.equal(await trace(page), "signUp");
  }));
  await check("CALLBACK_NO_LOOKUP_DIRECT_SAFE_NEXT", () => scenario("callback-status-failure", async (page) => {
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("replace:"));
    assert.equal(await trace(page), "replace:/feed/");
  }));
  await check("CALLBACK_EXTERNAL_NEXT_REJECTED", () => scenario("callback-external-next-rejected", async (page) => {
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("replace:"));
    assert.equal(await trace(page), "replace:/feed/");
  }));
  await check("LOGIN_SESSION_REQUIRED", () => scenario("login-no-session", async (page) => {
    await fill(page);
    await page.locator('button[type="submit"]').click();
    await page.getByText("暂时无法完成请求，请稍后重试。", { exact: true }).waitFor();
    assert.equal(await trace(page), "signIn");
  }));
  await check("CALLBACK_SESSION_REQUIRED", () => scenario("callback-no-session", async (page) => {
    await page.waitForFunction(() => document.querySelector("output")?.textContent === "sessionMissing");
    assert.equal(await trace(page), "sessionMissing");
  }));
  await check("SIGNUP_SESSION_NO_CONSENT_WRITE", () => scenario("register-session-consent-success", async (page) => {
    await fill(page);
    await page.locator('button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("navigate:"));
    assert.equal(await trace(page), "signUp,navigate:/feed/");
  }));
  const layout = await fs.readFile("src/layouts/CommunityLayout.astro", "utf8");
  await check("GLOBAL_GATE_REMOVED", () => assert.equal(layout.includes("LegalConsentGate"), false, "normal layout must not install LegalConsentGate"));
  await check("NORMAL_CONTENT_VISIBLE", () => assert.doesNotMatch(layout.match(/<main[^>]*>/)?.[0] ?? "", /hidden=|data-consent-gated-main/, "normal main must not be hidden by consent"));
  await check("LEGACY_ROUTE_SAFE_302_NO_WRITE", async () => {
    const route = await fs.readFile("src/pages/legal-consent/index.astro", "utf8");
    assert.doesNotMatch(route, /LegalConsentPage|recordLegalConsent/);
    const { getSafeConsentNext } = await server.ssrLoadModule(path.resolve("src/lib/legal-consent-navigation.ts"));
    const frontmatter = route.split("---")[1].replace(/^import .*;\r?\n/gm, "").replace(/export const prerender = false;/, "");
    const render = new Function("Astro", "getSafeConsentNext", frontmatter);
    for (const [input, expected] of [[null, "/feed/"], ["/circles/?sort=latest#reply", "/circles/?sort=latest#reply"], ["https://example.invalid", "/feed/"], ["//example.invalid", "/feed/"], ["/legal-consent/?next=%2Ffeed%2F", "/feed/"], ["/%256cegal-consent/", "/feed/"]]) {
      const url = new URL("/legal-consent/", origin);
      if (input !== null) url.searchParams.set("next", input);
      assert.deepEqual(render({ url, redirect: (destination, status) => ({ destination, status }) }, getSafeConsentNext), { destination: expected, status: 302 });
    }
  });
  if (process.env.HOTFIX_SCREENSHOTS === "1") {
    for (const width of [390, 430, 1440]) for (const id of ["login-unchecked", "register-unchecked"]) {
      await scenario(id, async (page) => {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        await page.locator(".legal-harness__surface").screenshot({ path: path.join(evidence, `${width}-${id}.png`) });
      });
    }
  }
  await check("LOOPBACK_NETWORK_ONLY", () => assert.deepEqual(blocked, []));
} finally { await context.close(); await browser.close(); await server.close(); }
for (const result of results) console.log(`${result.name}=${result.status}${result.detail ? " " + result.detail : ""}`);
await fs.writeFile(path.join(evidence, process.env.HOTFIX_SCREENSHOTS === "1" ? "frontend-green.json" : "frontend-results.json"), JSON.stringify({ results, blockedExternal: blocked }, null, 2));
process.exitCode = results.some(({ status }) => status === "FAIL") ? 1 : 0;
