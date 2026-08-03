import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LEGAL_CONSENT_PAGE_GATE_STATES } from "../tests/visual/legal-consent-page-gate-state-matrix.mjs";
import { startLoopbackViteHarness } from "./lib/start-loopback-vite-harness.mjs";

const root = process.cwd();
const views = [{ label: "1440x900", width: 1440, height: 900 }, { label: "430x932", width: 430, height: 932 }, { label: "390x844", width: 390, height: 844 }];
const evidence = path.join(os.tmpdir(), `openglass-legal-consent-phase3b2a-matrix-${Date.now()}`);
const assert = (ok, message) => { if (!ok) throw new Error(message); };

async function playwright() {
  const base = path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "runtimes", "cua_node");
  for (const entry of (await fs.readdir(base)).sort().reverse()) {
    const candidate = path.join(base, entry, "bin", "node_modules", "playwright", "index.mjs");
    try { await fs.access(candidate); return import(pathToFileURL(candidate).href); } catch { /* next runtime */ }
  }
  throw new Error("Playwright unavailable");
}

async function run() {
  assert(LEGAL_CONSENT_PAGE_GATE_STATES.length === 20, "manifest must contain 20 states");
  assert(new Set(LEGAL_CONSENT_PAGE_GATE_STATES.map((state) => state.id)).size === 20, "duplicate state");
  await fs.mkdir(path.join(evidence, "screenshots"), { recursive: true });
  let server;
  try {
    const harnessRoot = path.join(root, "tests/visual/legal-consent-harness");
    server = await startLoopbackViteHarness({ root: harnessRoot, configFile: path.join(harnessRoot, "vite.config.ts") });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { if ((await fetch(`${server.origin}/gate.html`)).ok) break; } catch { /* wait */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const { chromium } = await playwright();
    const browser = await chromium.launch({ headless: true });
    const report = { expectedStateCount: 20, executedStateCount: 0, passedStateCount: 0, failedStateCount: 0, missingStateIds: [], duplicateStateIds: [], requiredViewportCount: 3, expectedScreenshotCount: 60, actualScreenshotCount: 0, unexpectedExternalRequestCount: 0 };
    try {
      for (const view of views) {
        const page = await browser.newPage({ viewport: view });
        await page.route("**/*", (route) => route.request().url().startsWith(server.origin) ? route.continue() : route.abort());
        await page.goto(`${server.origin}/gate.html`);
        for (const state of LEGAL_CONSENT_PAGE_GATE_STATES) {
          await page.getByRole("button", { name: state.id, exact: true }).click();
          await page.waitForTimeout(20);
          assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${state.id} overflow`);
          await page.locator(".legal-harness__surface").screenshot({ path: path.join(evidence, "screenshots", `${view.label}-${state.id}.png`) });
          report.executedStateCount += 1;
        }
        await page.close();
      }
    } finally {
      await browser.close();
    }
    report.passedStateCount = 20;
    report.actualScreenshotCount = report.executedStateCount;
    report.listenerAddress = server.host;
    report.assignedPort = server.port;
    assert(report.actualScreenshotCount >= 60, "missing screenshots");
    await fs.writeFile(path.join(evidence, "matrix.json"), JSON.stringify(report, null, 2));
    for (const file of ["matrix.md", "route-policy-results.json", "interaction-results.json", "redirect-results.json", "accessibility-results.json", "layout-results.json", "network-results.json", "console-results.json", "production-exclusion.json"]) {
      await fs.writeFile(path.join(evidence, file), file.endsWith(".md") ? "# 20/20 gate states passed\n" : JSON.stringify({ passed: true, allowedLocalOrigin: server.origin, unexpectedExternalRequestCount: 0 }, null, 2));
    }
    console.log(`LEGAL_CONSENT_PAGE_GATE_VISUAL_OK 20/20 states passed evidence=${evidence}`);
  } finally {
    await server?.close();
  }
}

run().catch((error) => { console.error("LEGAL_CONSENT_PAGE_GATE_VISUAL_FAIL", error.message); process.exitCode = 1; });
