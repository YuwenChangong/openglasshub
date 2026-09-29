import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { LEGAL_CONSENT_PAGE_GATE_STATES } from "../tests/visual/legal-consent-page-gate-state-matrix.mjs";

const root = process.cwd();
const origin = "http://127.0.0.1:4390";
const views = [{ label: "1440x900", width: 1440, height: 900 }, { label: "430x932", width: 430, height: 932 }, { label: "390x844", width: 390, height: 844 }];
const evidence = path.join(root, ".superpowers", "hotfix-runtime-consent", `ungated-layout-${Date.now()}`);
async function run() {
  const layout = await fs.readFile(path.join(root, "src/layouts/CommunityLayout.astro"), "utf8");
  assert(!layout.includes("LegalConsentGate"), "CommunityLayout must not install consent gate");
  assert(!/hidden=|data-consent-gated-main/.test(layout.match(/<main[^>]*>/)?.[0] ?? ""), "normal main must not be consent-hidden");
  assert.equal(LEGAL_CONSENT_PAGE_GATE_STATES.length, 20);
  assert.equal(new Set(LEGAL_CONSENT_PAGE_GATE_STATES.map(({ id }) => id)).size, 20);
  await fs.mkdir(path.join(evidence, "screenshots"), { recursive: true });
  const server = spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--config", "vite.config.ts", "--port", "4390", "--strictPort"], { cwd: path.join(root, "tests/visual/legal-consent-harness"), stdio: "ignore", windowsHide: true });
  const report = { sourceLayoutChecked: true, fixtureOnly: true, expectedStateCount: 20, requiredViewportCount: 3, screenshots: [], checks: [], blockedExternal: [], pageErrors: [] };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { if ((await fetch(`${origin}/gate.html`)).ok) { ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, "loopback harness did not start");
    const browser = await chromium.launch({ headless: true, args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      report.blockedExternal.push(url.origin); return route.abort();
    });
    await context.routeWebSocket("**/*", (socket) => {
      const url = new URL(socket.url());
      if (url.origin === origin.replace("http:", "ws:")) socket.connectToServer();
      else { report.blockedExternal.push(url.origin); socket.close(); }
    });
    try {
      for (const view of views) {
        const page = await context.newPage();
        page.on("pageerror", (error) => report.pageErrors.push(error.name));
        await page.setViewportSize(view);
        await page.goto(`${origin}/gate.html`);
        for (const state of LEGAL_CONSENT_PAGE_GATE_STATES) {
          await page.getByRole("button", { name: state.id, exact: true }).click();
          await page.locator(`[data-scenario="${state.id}"]`).waitFor();
          assert(await page.locator(".community-shell").isVisible(), "normal content must stay visible");
          assert.equal(await page.locator("input[type=checkbox]").count(), 0, "no consent controls");
          assert.equal(await page.locator("output").textContent(), "", "no consent lookup or redirect");
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${state.id} overflow`);
          const file = `${view.label}-${state.id}.png`;
          await page.locator(".legal-harness__surface").screenshot({ path: path.join(evidence, "screenshots", file) });
          report.screenshots.push(file);
          report.checks.push({ viewport: view.label, state: state.id, visible: true, consentControlCount: 0, consentTrace: "", horizontalOverflow: false });
        }
        await page.close();
      }
    } finally { await context.close(); await browser.close(); }
    assert.equal(report.screenshots.length, 60);
    assert.deepEqual(report.blockedExternal, []);
    assert.deepEqual(report.pageErrors, []);
    await fs.writeFile(path.join(evidence, "matrix.json"), JSON.stringify(report, null, 2));
    console.log(`LEGAL_CONSENT_PAGE_GATE_VISUAL_OK 20/20 former gate fixtures, 60 screenshots, externalRequests=0 evidence=${evidence}`);
  } finally {
    if (server.exitCode === null) {
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill(); await exited;
    }
  }
}
run().catch((error) => { console.error("LEGAL_CONSENT_PAGE_GATE_VISUAL_FAIL", error.message); process.exitCode = 1; });
