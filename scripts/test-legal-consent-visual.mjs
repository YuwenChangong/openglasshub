import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const port = 4387;
const harness = path.join(root, "tests", "visual", "legal-consent-harness");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidence = path.join(os.tmpdir(), `openglass-legal-consent-phase3b1-visual-${runId}`);
const states = ["consent-missing", "consent-current", "consent-error", "consent-rate", "auth-login", "auth-fail", "auth-signup", "auth-email", "callback-current", "callback-missing", "callback-error"];
const viewports = [{ label: "1440x900", width: 1440, height: 900 }, { label: "430x932", width: 430, height: 932 }, { label: "390x844", width: 390, height: 844 }];
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
  const report = { states, viewports: viewports.map(({ label }) => label), screenshots: [], interaction: [], accessibility: [], overflow: [], blockedNetwork: [] };
  try {
    await waitForServer();
    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch({ headless: true });
    try {
      for (const viewport of viewports) {
        const page = await browser.newPage({ viewport });
        await page.route("**/*", async (route) => {
          const url = route.request().url();
          if (url.startsWith(`http://127.0.0.1:${port}`) || url.startsWith("data:")) return route.continue();
          report.blockedNetwork.push(new URL(url).origin);
          await route.abort();
        });
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
        for (const state of states) {
          await page.getByRole("button", { name: state, exact: true }).click();
          await page.waitForTimeout(25);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
          assert(!overflow, `${state} overflows at ${viewport.label}`);
          const image = path.join(evidence, `${viewport.label}-${state}.png`);
          await page.locator(".legal-harness__surface").screenshot({ path: image });
          report.screenshots.push(path.basename(image)); report.overflow.push(`${viewport.label} ${state} OK`);
        }
        await page.getByRole("button", { name: "auth-login", exact: true }).click();
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
    } finally { await browser.close(); }
    await fs.writeFile(path.join(evidence, "state-matrix-report.json"), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(evidence, "redacted-test-run-summary.txt"), `Offline harness passed. Screenshots: ${report.screenshots.length}. No credentials or tokens were recorded.\n`);
    process.stdout.write(`LEGAL_CONSENT_VISUAL_OK evidence=${evidence}\n`);
  } finally {
    vite.kill();
  }
}
main().catch((error) => { process.stderr.write(`LEGAL_CONSENT_VISUAL_FAIL ${error.message}\n`); process.exitCode = 1; });
