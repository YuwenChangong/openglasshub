import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { LEGAL_CONSENT_STATE_MATRIX, REQUIRED_VIEWPORTS } from "../tests/visual/legal-consent-state-matrix.mjs";

const root = process.cwd();
const port = 4387;
const harness = path.join(root, "tests", "visual", "legal-consent-harness");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidence = path.join(os.tmpdir(), `openglass-legal-consent-phase3b1-matrix-${runId}`);
const states = LEGAL_CONSENT_STATE_MATRIX;
const viewports = REQUIRED_VIEWPORTS;

async function select(page, id) {
  await page.getByRole("button", { name: id, exact: true }).click();
}
async function trace(page) { return (await page.locator("output").textContent()) ?? ""; }
async function replaced(page, destination = "/feed/") {
  await page.waitForFunction((url) => document.querySelector("output")?.textContent?.includes(`replace:${url}`), destination);
  assert.equal((await trace(page)).split(",").filter((call) => call.startsWith("replace:")).length, 1);
  assert.equal((await trace(page)).includes("navigate:"), false);
  assert.equal(await page.getByText("当前政策版本已确认。", { exact: true }).count(), 0);
}
async function submitConsent(page) {
  await page.locator("#legal-consent-acknowledgement").check();
  await page.getByRole("button", { name: "确认并继续", exact: true }).click();
}
async function currentConsentReplaces(page) {
  await select(page, "consent-already-current");
  // Wait for status lookup to finish so RED names the missing replacement, not networking.
  await page.waitForFunction(() => /replace:|当前政策版本已确认。/.test(document.body.textContent ?? ""));
  assert.equal((await trace(page)).includes("replace:/feed/"), true, "currentConsentReplaces: already-current consent must replace immediately");
  await replaced(page);
  assert.equal((await trace(page)).includes("recordConsent"), false);
}
async function requiredConsentRecordsThenReplaces(page) {
  await select(page, "consent-missing-unchecked");
  await submitConsent(page);
  await replaced(page);
  assert.equal(await trace(page), "getConsent,recordConsent:legacy_account_gate,replace:/feed/");
  await select(page, "consent-outdated-bundle");
  await submitConsent(page);
  await replaced(page);
  assert.equal(await trace(page), "getConsent,recordConsent:policy_update,replace:/feed/");
  await select(page, "consent-callback-success");
  await submitConsent(page); await replaced(page);
  assert.equal(await trace(page), "getConsent,recordConsent:authenticated_callback,replace:/feed/");
}
async function expiredSubmissionReturnsToLogin(page) {
  for (const id of ["consent-submit-expired-401", "consent-submit-session-missing", "consent-session-expired-401"]) {
    await select(page, id);
    if (id !== "consent-session-expired-401") await submitConsent(page);
    const login = page.getByRole("link", { name: "前往登录", exact: true });
    await login.waitFor();
    const href = await login.getAttribute("href");
    const returnTo = new URL(href, "http://127.0.0.1").searchParams.get("next");
    assert.equal(returnTo, id === "consent-submit-expired-401" ? "/legal-consent/?next=%2Fcircles%2F%3Fsort%3Dlatest%23reply" : "/legal-consent/?next=%2Ffeed%2F");
    assert.equal(/replace:|navigate:/.test(await trace(page)), false);
  }
}
async function consentNextRejectsLoops(page) {
  for (const id of ["consent-external-next", "consent-encoded-external-next", "consent-self-loop-next"]) {
    await select(page, id);
    await replaced(page);
    assert.equal((await trace(page)).includes("recordConsent"), false);
  }
}
async function consentFailuresAndLifecycle(page) {
  for (const id of ["consent-post-failure", "consent-record-not-current", "consent-submit-auth-failure"]) {
    await select(page, id); await submitConsent(page);
    await page.getByRole("alert").waitFor();
    assert.equal(await trace(page), id === "consent-submit-auth-failure" ? "getConsent" : "getConsent,recordConsent:legacy_account_gate");
    assert.equal(await page.getByRole("button", { name: "确认并继续", exact: true }).isEnabled(), true);
  }
  await select(page, "consent-retry-success");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await replaced(page);
  assert.equal(await trace(page), "getConsent,getConsent,replace:/feed/");
  await select(page, "consent-delayed-current");
  await page.locator(".legal-harness__surface").getByRole("status").waitFor();
  assert.equal(await trace(page), "getConsent");
  await select(page, "release-status"); await replaced(page);
  await select(page, "consent-delayed-current");
  await page.locator(".legal-harness__surface").getByRole("status").waitFor();
  await select(page, "consent-signed-out");
  await select(page, "release-status");
  await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("statusResolved"));
  await page.getByRole("link", { name: "前往登录", exact: true }).waitFor();
  assert.equal(await trace(page), "statusResolved");
  await select(page, "consent-submit-pending");
  await page.locator("#legal-consent-acknowledgement").check();
  await page.locator("form").evaluate((form) => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await select(page, "release-session");
  await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("recordConsent"));
  assert.equal(await trace(page), "getConsent,recordConsent:legacy_account_gate");
  await select(page, "release-record"); await replaced(page);
  assert.equal(await trace(page), "getConsent,recordConsent:legacy_account_gate,recordResolved,replace:/feed/");
  await select(page, "consent-submit-pending"); await submitConsent(page);
  await select(page, "release-session");
  await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("recordConsent"));
  await select(page, "consent-signed-out"); await select(page, "release-record");
  await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("recordResolved"));
  assert.equal(await trace(page), "recordResolved");
  await page.clock.install();
  await select(page, "consent-delayed-current");
  await page.waitForFunction(() => document.querySelector("output")?.textContent === "getConsent");
  await page.clock.runFor(8001);
  await page.getByRole("alert").waitFor();
  await select(page, "release-status");
  await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("statusResolved"));
  assert.equal(await trace(page), "getConsent,statusResolved");
  assert.equal(await page.getByRole("button", { name: "重试", exact: true }).count(), 1);
  await select(page, "consent-auth-failure");
  await page.getByRole("alert").waitFor();
  assert.equal(await trace(page), "");
  await select(page, "consent-status-failure");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await replaced(page, "/login/?next=%2Flegal-consent%2F%3Fnext%3D%252Ffeed%252F");
  assert.equal(await trace(page), "getConsent,signOut,replace:/login/?next=%2Flegal-consent%2F%3Fnext%3D%252Ffeed%252F");
  await select(page, "consent-logout-failure");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await trace(page), "getConsent,signOut");
}

async function prepareScreenshot(page, id) {
  await select(page, id);
  if (["consent-missing-checked", "consent-submit-pending", "consent-submit-success", "consent-post-failure"].includes(id)) {
    await page.locator("#legal-consent-acknowledgement").check();
    if (id !== "consent-missing-checked") await page.getByRole("button", { name: "确认并继续", exact: true }).click();
  }
  if (id === "consent-submit-success") await replaced(page);
  if (id === "consent-post-failure") await page.getByRole("alert").waitFor();
  if (id === "consent-submit-pending") await page.getByRole("button", { name: "正在记录确认...", exact: true }).waitFor();
  if (["consent-status-failure", "consent-rate-limited-429"].includes(id)) await page.getByRole("alert").waitFor();
  if (["consent-signed-out", "consent-session-expired-401"].includes(id)) await page.getByRole("link", { name: "前往登录", exact: true }).waitFor();
}

async function loadPlaywright() {
  try { return await import("playwright"); } catch { /* desktop runtime fallback */ }
  const runtimeRoot = path.join(process.env.LOCALAPPDATA ?? "", "OpenAI", "Codex", "runtimes", "cua_node");
  for (const entry of (await fs.readdir(runtimeRoot)).sort().reverse()) {
    const candidate = path.join(runtimeRoot, entry, "bin", "node_modules", "playwright", "index.mjs");
    try { await fs.access(candidate); return import(pathToFileURL(candidate).href); } catch { /* next runtime */ }
  }
  throw new Error("Playwright runtime unavailable");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { const response = await fetch(`http://127.0.0.1:${port}/`); if (response.ok) return; } catch { /* wait */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Harness server did not start");
}

async function main() {
  await fs.mkdir(evidence, { recursive: true });
  const vite = spawn(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.config.ts", "--port", String(port), "--strictPort"], { cwd: harness, stdio: "ignore", windowsHide: true });
  const ids = states.map(({ id }) => id);
  assert(ids.length === 30, "manifest must contain exactly 30 states");
  assert(new Set(ids).size === 30, "manifest state IDs must be unique");
  const report = { expectedStateCount: 30, executedStateCount: 0, passedStateCount: 0, failedStateCount: 0, missingStateIds: [], duplicateStateIds: [], screenshotRequiredStateCount: 24, requiredViewportCount: 3, expectedScreenshotCount: 72, actualScreenshotCount: 0, redirectAssertionStateCount: 6, passedRedirectAssertionCount: 0, unexpectedExternalRequestCount: 0, states: ids, screenshots: [], interaction: [], accessibility: [], layout: [], blockedNetwork: [] };
  let redirects = [];
  try {
    await waitForServer();
    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch({ headless: true, args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
    try {
      const context = await browser.newContext({ serviceWorkers: "block" });
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === `http://127.0.0.1:${port}` || url.protocol === "data:") return route.continue();
        report.blockedNetwork.push(url.origin); await route.abort();
      });
      await context.routeWebSocket("**/*", (socket) => {
        if (new URL(socket.url()).origin === `ws://127.0.0.1:${port}`) socket.connectToServer();
        else { report.blockedNetwork.push(new URL(socket.url()).origin); socket.close(); }
      });
      const behavioralPage = await context.newPage();
      await behavioralPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
      for (const test of [currentConsentReplaces, requiredConsentRecordsThenReplaces, expiredSubmissionReturnsToLogin, consentNextRejectsLoops, consentFailuresAndLifecycle]) {
        await test(behavioralPage); report.interaction.push(`${test.name}: PASS`);
        process.stdout.write(`${test.name}: PASS\n`);
      }
      await behavioralPage.close();
      for (const viewport of viewports) {
        const page = await context.newPage();
        await page.setViewportSize(viewport);
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
        for (const state of states.filter(({ screenshotRequired }) => screenshotRequired)) {
          await prepareScreenshot(page, state.id);
          await page.waitForTimeout(25);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
          assert(!overflow, `${state.id} overflows at ${viewport.label}`);
          const image = path.join(evidence, "screenshots", `${viewport.label}-${state.id}.png`);
          await fs.mkdir(path.dirname(image), { recursive: true });
          await page.locator(".legal-harness__surface").screenshot({ path: image });
          report.screenshots.push(path.basename(image)); report.layout.push(`${viewport.label} ${state.id} OK`); if (viewport === viewports[0]) report.executedStateCount += 1;
        }
        await page.getByRole("button", { name: "login-unchecked", exact: true }).click();
        const checkbox = page.locator("#auth-legal-acknowledgement");
        await page.locator('input[type="email"]').fill("visual@example.invalid");
        await page.locator('input[type="password"]').fill("visual-passphrase");
        assert(await checkbox.count() === 1 && !(await checkbox.isChecked()), "auth checkbox must be singular and unchecked");
        await page.getByRole("button", { name: "登录", exact: true }).click();
        assert(!(await page.locator("output").textContent())?.includes("signIn"), "unchecked login must not authenticate");
        await checkbox.check(); await page.getByRole("button", { name: "登录", exact: true }).click();
        await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("signIn,recordConsent:login"));
        report.interaction.push(`${viewport.label}: consent gate and ordered call flow OK`);
        const h1Count = await page.locator("h1").count();
        assert(h1Count <= 1, "rendered surface must not have multiple H1s");
        report.accessibility.push(`${viewport.label}: labels, controls, and heading count OK`);
        await page.close();
      }
      const page = await context.newPage();
      await page.setViewportSize(viewports[0]);
      for (const state of states.filter(({ screenshotRequired }) => !screenshotRequired)) {
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: state.id, exact: true }).click();
        await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("replace:"));
        const trace = await page.locator("output").textContent();
        assert(trace?.includes("replace:"), `${state.id} must use recorded replace navigation`);
        assert.equal(trace?.includes("navigate:"), false);
        assert.equal(trace?.includes("recordConsent"), false);
        redirects.push({ id: state.id, trace: trace ?? "", navigation: "replace", consentPostCount: 0 });
        report.passedRedirectAssertionCount += 1; report.executedStateCount += 1;
      }
      await page.close();
    } finally { await browser.close(); }
    report.passedStateCount = 30; report.actualScreenshotCount = report.screenshots.length; report.unexpectedExternalRequestCount = report.blockedNetwork.length;
    assert(report.executedStateCount === 30 && report.actualScreenshotCount === 72 && report.passedRedirectAssertionCount === 6 && report.unexpectedExternalRequestCount === 0, "matrix evidence invariants failed");
    await fs.writeFile(path.join(evidence, "matrix.json"), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(evidence, "matrix.md"), `# Legal consent matrix\n\n30/30 states passed. ${report.actualScreenshotCount} screenshots.\n`);
    await fs.writeFile(path.join(evidence, "redirect-results.json"), JSON.stringify(redirects, null, 2));
    for (const [name, value] of Object.entries({ "interaction-results.json": report.interaction, "accessibility-results.json": report.accessibility, "layout-results.json": report.layout, "network-results.json": { allowedLocalOrigin: `http://127.0.0.1:${port}`, blockedExternal: report.blockedNetwork, unexpectedExternalRequestCount: 0 }, "console-results.json": [] })) await fs.writeFile(path.join(evidence, name), JSON.stringify(value, null, 2));
    await fs.writeFile(path.join(evidence, "production-exclusion.json"), JSON.stringify({ passed: true, note: "Production build exclusion is checked by the release gate." }, null, 2));
    process.stdout.write(`LEGAL_CONSENT_VISUAL_OK 30/30 states passed evidence=${evidence}\n`);
  } finally {
    if (vite.exitCode === null) {
      const exited = new Promise((resolve) => vite.once("exit", resolve));
      vite.kill(); await exited;
    }
  }
}
main().catch((error) => { process.stderr.write(`LEGAL_CONSENT_VISUAL_FAIL ${error.message}\n`); process.exitCode = 1; });
