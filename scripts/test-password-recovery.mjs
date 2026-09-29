import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 4471;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--config", "vite.config.ts", "--port", String(port), "--strictPort"], {
  cwd: path.join(root, "tests/visual/legal-consent-harness"), stdio: "ignore", windowsHide: true,
});

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(origin)).ok) return; } catch { /* local boot */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("local harness unavailable");
}

async function select(page, name) {
  await page.getByRole("button", { name, exact: true }).click();
}

async function main() {
  let browser;
  let externalRequests = 0;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true, args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin || url.protocol === "data:") return route.continue();
      externalRequests += 1;
      return route.abort();
    });
    await context.routeWebSocket("**/*", (socket) => {
      if (new URL(socket.url()).origin === origin.replace("http:", "ws:")) socket.connectToServer();
      else { externalRequests += 1; socket.close(); }
    });
    let page = await context.newPage();
    await page.goto(origin, { waitUntil: "networkidle" });

    await select(page, "Recovery without code");
    assert.equal(await page.getByLabel("新密码", { exact: true }).count(), 0, "ordinarySessionCannotUnlock");
    await select(page, "Emit recovery session");
    await page.getByLabel("新密码", { exact: true }).waitFor();
    assert.equal((await page.locator("output").textContent())?.includes("exchange-count:"), false, "event requires no exchange");
    process.stdout.write("ordinarySessionCannotUnlock: PASS\n");

    await select(page, "Recovery with code");
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("exchange-count:1"));
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("listener-removed"));
    assert.equal(new URL(page.url()).searchParams.has("code"), false, "successful exchange clears callback code");
    await select(page, "Emit recovery session");
    assert.equal((await page.locator("output").textContent())?.includes("exchange-count:2"), false, "recoveryExchangeOnce");
    const password = ` ${randomBytes(12).toString("hex")} `;
    await page.evaluate((value) => { window.__expectedPassword = value; }, password);
    await page.getByLabel("新密码", { exact: true }).fill(password);
    await page.getByLabel("确认新密码", { exact: true }).fill(password + "x");
    await page.getByRole("button", { name: "更新密码", exact: true }).click();
    assert.equal((await page.locator("output").textContent())?.includes("update-count:"), false, "mismatch blocks update");
    await page.getByLabel("确认新密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "更新密码", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("password-preserved:"));
    assert.equal((await page.locator("output").textContent())?.includes("password-preserved:true"), true, "passwordNotTrimmed");
    process.stdout.write("recoveryExchangeOnce: PASS\npasswordNotTrimmed: PASS\n");

    await select(page, "Recovery failed code");
    await page.getByText("重置链接无效或已过期，请重新发起忘记密码流程。", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("新密码", { exact: true }).count(), 0, "failed exchange stays locked");
    assert.equal(await page.getByRole("link", { name: "返回登录", exact: true }).count(), 1, "expiredRecoveryActionable");
    assert.equal((await page.locator("output").textContent())?.includes("listener-removed"), true, "failed listener cleanup");
    await select(page, "Emit recovery session");
    assert.equal(await page.getByLabel("新密码", { exact: true }).count(), 0, "failed link replay stays locked");
    process.stdout.write("expiredRecoveryActionable: PASS\n");

    await page.clock.install();
    await select(page, "Recovery pending code");
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("exchange-count:1"));
    await page.clock.runFor(2801);
    await page.getByText("重置链接无效或已过期，请重新发起忘记密码流程。", { exact: true }).waitFor();
    assert.equal((await page.locator("output").textContent())?.includes("listener-removed"), true, "timeout listener cleanup");
    await select(page, "Emit recovery session");
    assert.equal(await page.getByLabel("新密码", { exact: true }).count(), 0, "late event cannot unlock");
    await select(page, "Recovery pending code");
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("exchange-count:1"));
    await select(page, "login-unchecked");
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("listener-removed"));
    assert.equal((await page.locator("output").textContent())?.includes("listener-removed"), true, "unmount listener cleanup");
    process.stdout.write("recoveryTimeout: PASS\n");

    await page.close();
    page = await context.newPage();
    await page.goto(origin, { waitUntil: "networkidle" });
    await select(page, "callback-current-consent");
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("replace:/feed/"), null, { timeout: 3000 });
    process.stdout.write("callback-current: PASS\n");
    await select(page, "callback-outdated-consent");
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("replace:/legal-consent/"));
    process.stdout.write("callback-outdated: PASS\n");
    await select(page, "callback-self-next");
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("replace:/feed/"));
    await select(page, "callback-external-next-rejected");
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("replace:/legal-consent/?next=%2Ffeed%2F"));
    await page.evaluate(() => window.history.replaceState(null, "", "/?error=private-provider-detail"));
    await select(page, "callback-current-consent");
    await page.getByText("登录确认失败。", { exact: true }).waitFor();
    assert.equal((await page.locator("output").textContent())?.includes("replace:"), false, "error callback must not use stale session");
    assert.equal((await page.locator(".legal-harness__surface").textContent())?.includes("private-provider-detail"), false, "callbackErrorRedacted");
    assert.equal(new URL(page.url()).searchParams.has("error"), false, "callback error removed from address bar");
    await page.evaluate(() => window.history.replaceState(null, "", "/"));
    await select(page, "callback-delayed-session");
    await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("sessionPending"));
    await select(page, "login-unchecked");
    await select(page, "release-session");
    assert.equal((await page.locator("output").textContent())?.includes("replace:"), false, "unmounted callback cannot navigate");
    process.stdout.write("callbackRoutingAndError: PASS\n");
    assert.equal(externalRequests, 0, "external requests");
    process.stdout.write("PASSWORD_RECOVERY_LOCAL_OK externalRequests=0\n");
    await context.close();
  } finally {
    await browser?.close();
    if (server.exitCode === null) {
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill(); await exited;
    }
  }
}
main().catch((error) => { process.stderr.write(`PASSWORD_RECOVERY_LOCAL_FAIL ${error.message}\n`); process.exitCode = 1; });
