import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const baseURL = process.env.OPENGLASS_BASE_URL || "http://127.0.0.1:4323";
const requiredRoutes = ["/"];
const bestEffortRoutes = ["/products/", "/feed/", "/circles/"];
const viewports = [
  { label: "390x844", width: 390, height: 844 },
  { label: "430x932", width: 430, height: 932 },
  { label: "desktop-1440x900", width: 1440, height: 900 },
];
const screenshotDir = process.env.OPENGLASS_SCREENSHOT_DIR;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function importPlaywrightFromCodexRuntime() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    throw new Error("LOCALAPPDATA is unavailable and playwright is not installed locally.");
  }

  const runtimesRoot = path.join(localAppData, "OpenAI", "Codex", "runtimes", "cua_node");
  const runtimeDirs = (await fs.readdir(runtimesRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  runtimeDirs.sort((a, b) => b.name.localeCompare(a.name));

  for (const entry of runtimeDirs) {
    const candidate = path.join(runtimesRoot, entry.name, "bin", "node_modules", "playwright", "index.mjs");
    try {
      await fs.access(candidate);
      return import(pathToFileURL(candidate).href);
    } catch {
      // Try the next runtime.
    }
  }

  throw new Error("Unable to locate a Playwright runtime for the mobile auth regression check.");
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    return importPlaywrightFromCodexRuntime();
  }
}

function summarizeBox(box, viewport) {
  return (
    box &&
    box.width > 0 &&
    box.height > 0 &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= viewport.width &&
    box.y + box.height <= viewport.height + 200
  );
}

async function assertClickableInViewport(page, locator, viewport, label) {
  assert(await locator.isVisible(), `${label} should be visible.`);
  const box = await locator.boundingBox();
  assert(box !== null, `${label} should have a bounding box.`);
  assert(summarizeBox(box, viewport), `${label} should stay inside the viewport.`);
  await locator.click({ trial: true });

  const covered = await locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const topNode = document.elementFromPoint(x, y);
    return topNode ? !node.contains(topNode) && !topNode.contains(node) : true;
  });
  assert(!covered, `${label} should not be covered by another header element.`);
}

async function run() {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const warnings = [];

  try {
    const layoutProbe = await browser.newPage();
    const deepLink = await layoutProbe.request.get(new URL("/me/?tab=saved", baseURL).toString());
    assert(deepLink.status() === 200, "community profile layout should render locally.");
    assert((await deepLink.text()).includes('href="/login/?next=%2Fme%2F%3Ftab%3Dsaved"'),
      "community layout preserves the safe query continuation in the anonymous header.");
    await layoutProbe.close();
    if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true });
    for (const viewport of viewports) {
      for (const route of requiredRoutes) {
        const page = await browser.newPage({ viewport });
        const url = new URL(route, baseURL).toString();
        const response = await page.goto(url, { waitUntil: "networkidle" });
        assert(response, `${route} should respond.`);
        assert(response.status() === 200, `${route} should return 200, got ${response?.status()}.`);

        const identity = page.locator(".og-header__auth .ogh-login-button--identity");
        await assertClickableInViewport(page, identity, viewport, `${route} 未登录`);
        assert((await identity.getAttribute("href"))?.startsWith("/login/?next="), `${route} has an internal login continuation.`);
        assert(await page.locator(".og-header__auth .ogh-login-button--identity").count() === 1, "anonymous header has one identity link.");

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        assert(!overflow, `${route} should not overflow horizontally at ${viewport.label}.`);

        if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `home-${viewport.label}.png`) });

        results.push(`${route} ${viewport.label} OK`);
        await page.close();
      }

      for (const route of bestEffortRoutes) {
        const page = await browser.newPage({ viewport });
        const url = new URL(route, baseURL).toString();
        const response = await page.goto(url, { waitUntil: "networkidle" });

        if (!response || response.status() !== 200) {
          warnings.push(`${route} ${viewport.label} local status=${response?.status() ?? "no-response"}`);
          await page.close();
          continue;
        }

        const identity = page.locator(".og-header__auth .ogh-login-button--identity");
        await assertClickableInViewport(page, identity, viewport, `${route} 未登录`);

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        assert(!overflow, `${route} should not overflow horizontally at ${viewport.label}.`);

        results.push(`${route} ${viewport.label} OK`);
        await page.close();
      }

      const loginPage = await browser.newPage({ viewport });
      const loginResponse = await loginPage.goto(new URL("/login/", baseURL).toString(), { waitUntil: "networkidle" });
      assert(loginResponse?.status() === 200, `/login/ should return 200 at ${viewport.label}.`);
      const loginOverflow = await loginPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert(!loginOverflow, `/login/ should not overflow horizontally at ${viewport.label}.`);
      if (screenshotDir) await loginPage.screenshot({ path: path.join(screenshotDir, `login-${viewport.label}.png`) });
      results.push(`/login/ ${viewport.label} OK`);
      await loginPage.close();
    }
  } finally {
    await browser.close();
  }

  const warningSuffix = warnings.length > 0 ? ` WARN ${warnings.join(" | ")}` : "";
  process.stdout.write(`MOBILE_HEADER_AUTH_OK ${results.join(" | ")}${warningSuffix}\n`);
}

run().catch((error) => {
  process.stderr.write(`MOBILE_HEADER_AUTH_FAIL ${error.message}\n`);
  process.exitCode = 1;
});
