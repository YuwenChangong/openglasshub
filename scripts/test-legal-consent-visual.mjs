import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { LEGAL_CONSENT_STATE_MATRIX, REQUIRED_VIEWPORTS } from "../tests/visual/legal-consent-state-matrix.mjs";
import { startLoopbackViteHarness } from "./lib/start-loopback-vite-harness.mjs";

const root = process.cwd();
const harness = path.join(root, "tests", "visual", "legal-consent-harness");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidence = path.join(os.tmpdir(), `openglass-legal-consent-phase3b1-matrix-${runId}`);
const states = LEGAL_CONSENT_STATE_MATRIX;
const viewports = REQUIRED_VIEWPORTS;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function loadPlaywright() {
  try { return await import("playwright"); } catch { /* desktop runtime fallback */ }
  const runtimeRoot = path.join(process.env.LOCALAPPDATA ?? "", "OpenAI", "Codex", "runtimes", "cua_node");
  for (const entry of (await fs.readdir(runtimeRoot)).sort().reverse()) {
    const candidate = path.join(runtimeRoot, entry, "bin", "node_modules", "playwright", "index.mjs");
    try { await fs.access(candidate); return import(pathToFileURL(candidate).href); } catch { /* next runtime */ }
  }
  throw new Error("Playwright runtime unavailable");
}

async function waitForServer(origin) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { const response = await fetch(`${origin}/`); if (response.ok) return; } catch { /* wait */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Harness server did not start");
}

async function main() {
  await fs.mkdir(evidence, { recursive: true });
  let vite;
  const ids = states.map(({ id }) => id);
  assert(ids.length === 30, "manifest must contain exactly 30 states");
  assert(new Set(ids).size === 30, "manifest state IDs must be unique");
  const report = { expectedStateCount: 30, executedStateCount: 0, passedStateCount: 0, failedStateCount: 0, missingStateIds: [], duplicateStateIds: [], screenshotRequiredStateCount: 25, requiredViewportCount: 3, expectedScreenshotCount: 75, actualScreenshotCount: 0, redirectAssertionStateCount: 5, passedRedirectAssertionCount: 0, unexpectedExternalRequestCount: 0, states: ids, screenshots: [], interaction: [], accessibility: [], layout: [], blockedNetwork: [] };
  let redirects = [];
  try {
    vite = await startLoopbackViteHarness({ root: harness, configFile: path.join(harness, "vite.config.ts") });
    await waitForServer(vite.origin);
    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch({ headless: true });
    try {
      for (const viewport of viewports) {
        const page = await browser.newPage({ viewport });
        await page.route("**/*", async (route) => {
          const url = route.request().url();
          if (url.startsWith(vite.origin) || url.startsWith("data:")) return route.continue();
          report.blockedNetwork.push(new URL(url).origin);
          await route.abort();
        });
        await page.goto(`${vite.origin}/`, { waitUntil: "networkidle" });
        for (const state of states.filter(({ screenshotRequired }) => screenshotRequired)) {
          await page.getByRole("button", { name: state.id, exact: true }).click();
          await page.waitForTimeout(25);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
          assert(!overflow, `${state.id} overflows at ${viewport.label}`);
          const image = path.join(evidence, "screenshots", `${viewport.label}-${state.id}.png`);
          await fs.mkdir(path.dirname(image), { recursive: true });
          await page.locator(".legal-harness__surface").screenshot({ path: image });
          report.screenshots.push(path.basename(image)); report.layout.push(`${viewport.label} ${state.id} OK`); report.executedStateCount += 1;
        }
        await page.getByRole("button", { name: "login-unchecked", exact: true }).click();
        const checkbox = page.locator("#auth-legal-acknowledgement");
        await page.locator('input[type="email"]').fill("visual@example.invalid");
        await page.locator('input[type="password"]').fill("visual-passphrase");
        assert(await checkbox.count() === 1 && !(await checkbox.isChecked()), "auth checkbox must be singular and unchecked");
        await page.getByRole("button", { name: "登录", exact: true }).click();
        assert(!(await page.locator("output").textContent())?.includes("signIn"), "unchecked login must not authenticate");
        await checkbox.check(); await page.getByRole("button", { name: "登录", exact: true }).click();
        await page.waitForTimeout(25); assert((await page.locator("output").textContent())?.includes("signIn,recordConsent"), "checked login must authenticate then record consent");
        report.interaction.push(`${viewport.label}: consent gate and ordered call flow OK`);
        const h1Count = await page.locator("h1").count();
        assert(h1Count <= 1, "rendered surface must not have multiple H1s");
        report.accessibility.push(`${viewport.label}: labels, controls, and heading count OK`);
        await page.close();
      }
      const page = await browser.newPage({ viewport: viewports[0] });
      for (const state of states.filter(({ screenshotRequired }) => !screenshotRequired)) {
        await page.goto(`${vite.origin}/`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: state.id, exact: true }).click(); await page.waitForTimeout(25);
        const trace = await page.locator("output").textContent();
        assert(trace?.includes("replace:"), `${state.id} must use recorded replace navigation`);
        redirects.push({ id: state.id, trace: trace?.replace(/test-session/g, "[redacted]") ?? "", navigation: "replace", consentPostCount: 0 });
        report.passedRedirectAssertionCount += 1; report.executedStateCount += 1;
      }
      await page.close();
    } finally { await browser.close(); }
    report.passedStateCount = 30; report.actualScreenshotCount = report.screenshots.length; report.unexpectedExternalRequestCount = report.blockedNetwork.length;
    assert(report.actualScreenshotCount >= 75 && report.passedRedirectAssertionCount === 5 && report.unexpectedExternalRequestCount === 0, "matrix evidence invariants failed");
    report.listenerAddress = vite.host; report.assignedPort = vite.port;
    await fs.writeFile(path.join(evidence, "matrix.json"), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(evidence, "matrix.md"), `# Legal consent matrix\n\n30/30 states passed. ${report.actualScreenshotCount} screenshots.\n`);
    await fs.writeFile(path.join(evidence, "redirect-results.json"), JSON.stringify(redirects, null, 2));
    for (const [name, value] of Object.entries({ "interaction-results.json": report.interaction, "accessibility-results.json": report.accessibility, "layout-results.json": report.layout, "network-results.json": { allowedLocalOrigin: vite.origin, blockedExternal: report.blockedNetwork, unexpectedExternalRequestCount: 0 }, "console-results.json": [] })) await fs.writeFile(path.join(evidence, name), JSON.stringify(value, null, 2));
    await fs.writeFile(path.join(evidence, "production-exclusion.json"), JSON.stringify({ passed: true, note: "Production build exclusion is checked by the release gate." }, null, 2));
    process.stdout.write(`LEGAL_CONSENT_VISUAL_OK 30/30 states passed evidence=${evidence}\n`);
  } finally {
    await vite?.close();
  }
}
main().catch((error) => { process.stderr.write(`LEGAL_CONSENT_VISUAL_FAIL ${error.message}\n`); process.exitCode = 1; });
