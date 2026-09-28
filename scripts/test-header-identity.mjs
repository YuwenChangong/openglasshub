import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = process.cwd();
const evidence = path.join(root, "output/playwright/header-identity");
await mkdir(evidence, { recursive: true });
const server = await createServer({ configFile: path.join(root, "tests/visual/header-identity-harness/vite.config.ts") });
let browser;
const external = [];
try {
  await server.listen();
  const { buildHeaderIdentity } = await server.ssrLoadModule(path.join(root, "src/lib/header-identity.ts"));
  const user = (email, id = "00000000-0000-4000-8000-000000000001", display_name = undefined) => ({ id, email, user_metadata: { display_name } });
  const profile = (display_name, username = null, avatar_resolved_url = null) => ({ id: user().id, display_name, username, avatar_resolved_url, profile_href: "/users/test/" });
  const identity = (account, loaded = null, locale = "en") => buildHeaderIdentity({ user: account, profile: loaded, locale });
  assert.equal(identity(user("qa@example.test")).label, "qa");
  assert.equal(identity(user("qa@example.test", undefined, " Metadata ")).label, "Metadata");
  assert.equal(identity(user("qa@example.test", undefined, " Metadata "), profile(" Display ", "handle")).label, "Display");
  assert.equal(identity(user("qa@example.test"), profile("   ", " handle ")).label, "handle");
  assert.equal(identity(user("https://bad@example.test")).label.includes("https"), false);
  assert.equal(identity(user("token123456789012345678901234@example.test")).label.includes("token"), false);
  assert.equal(identity(user("qa\u0001bad@example.test")).label.includes("qa"), false);
  assert.equal(identity(user(null, "")).label, "Account");
  assert.equal(identity(user(null, ""), null, "zh-CN").label, "用户");
  assert.equal([...identity(user("qa@example.test"), profile("A".repeat(60))).label].length, 48);
  console.log("fallbackLevels: 10/10");
  const unsafeFallbacks = [
    "docs.example.com",
    `${"a".repeat(24)}.${"b".repeat(23)}`,
    `${"a".repeat(24)}+${"b".repeat(23)}`,
    "docs.example.com+tag",
    "abcd1234.1234abcd",
    "abc123def",
  ].map((local) => identity(user(`${local}@example.test`)).label);
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue();
    external.push("http"); return route.abort();
  });
  await context.routeWebSocket("**/*", (socket) => {
    const url = new URL(socket.url());
    if (url.host === new URL(origin).host) socket.connectToServer();
    else { external.push("ws"); socket.close(); }
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.goto(origin);
  await page.getByRole("button", { name: "Sign in with pending summary" }).click();
  const label = await page.getByTestId("header-identity-label").textContent();
  const initial = await page.getByTestId("header-identity-initial").textContent();
  await page.screenshot({ path: path.join(evidence, "round2-baseline.png") });
  console.log(`immediateFallback: labelNonblank=${/\S/.test(label ?? "")} initialNonblank=${/\S/.test(initial ?? "")}`);
  assert.match(label ?? "", /\S/, "signed-in label must be immediate while summary is pending");
  assert.match(initial ?? "", /\S/, "signed-in initial must be immediate while summary is pending");
  const closedLabelVisibility = [];
  for (const [width, height] of [[390, 844], [430, 932], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    closedLabelVisibility.push(await page.getByTestId("header-identity-label").isVisible());
    await page.screenshot({ path: path.join(evidence, `round2-closed-${width}.png`) });
    await page.getByRole("button", { name: "打开账户菜单" }).click();
    assert.equal(await page.getByRole("menu").isVisible(), true);
    assert.match(await page.getByRole("menu").textContent() ?? "", /qa/);
    await page.screenshot({ path: path.join(evidence, `round2-identity-${width}.png`) });
    const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth, elements: [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((el) => ({ tag: el.tagName, className: el.className, right: el.getBoundingClientRect().right })) }));
    assert.equal(overflow.page > overflow.viewport, false, `overflow at ${width}: ${JSON.stringify(overflow)}`);
    await page.keyboard.press("Escape");
  }
  console.log(`unsafeEmailFallbacks=${JSON.stringify(unsafeFallbacks)} closedLabelVisibility=${JSON.stringify(closedLabelVisibility)}`);
  assert.deepEqual(
    { unsafeFallbacks, closedLabelVisibility },
    { unsafeFallbacks: ["000000…0001", "000000…0001", "000000…0001", "000000…0001", "000000…0001", "000000…0001"], closedLabelVisibility: [true, true, true] },
    "unsafe local parts must use ID fallback and the closed-menu label must be visible",
  );
  console.log("immediateFallback: 3/3 viewports");
  await page.clock.fastForward(3001);
  assert.ok(await page.evaluate(() => window.__headerAbortCount > 0), "deadline aborts summary request");
  assert.match(await page.getByTestId("header-identity-initial").textContent() ?? "", /\S/);
  await page.getByRole("button", { name: "Resolve previous summary" }).click();
  assert.equal(await page.getByTestId("header-identity-label").textContent(), "qa");
  console.log("enrichmentDeadline: late summary ignored");

  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByRole("button", { name: "Switch actor" }).click();
  assert.equal(await page.getByTestId("header-identity-label").textContent(), "next");
  await page.getByRole("button", { name: "Resolve previous summary" }).click();
  assert.equal(await page.getByTestId("header-identity-label").textContent(), "next");
  await page.getByRole("button", { name: "Resolve current summary" }).click();
  assert.equal(await page.getByTestId("header-identity-label").textContent(), "Current actor");
  console.log("staleActorIgnored: old response ignored");

  await page.getByRole("button", { name: "Sign in with pending summary" }).click();
  await page.getByRole("button", { name: "Resolve previous summary" }).click();
  assert.equal(await page.getByTestId("header-identity-label").textContent(), "Previous actor");
  await page.getByRole("button", { name: "Switch actor" }).click();
  assert.equal(await page.getByTestId("header-identity-label").textContent(), "next");
  console.log("loadedActorSwitch: old profile cleared in first render");

  await page.getByRole("button", { name: "Sign in with slow token" }).click();
  await page.clock.fastForward(3001);
  await page.getByRole("button", { name: "Resolve slow token" }).click();
  assert.equal(await page.getByTestId("header-identity-label").textContent(), "qa");
  console.log("slowTokenDeadline: late token ignored");

  await page.getByRole("button", { name: "Sign in with broken avatar" }).click();
  assert.equal(await page.getByTestId("header-identity-label").textContent(), "Current actor");
  await page.getByTestId("header-identity-initial").waitFor();
  await page.getByRole("button", { name: "打开账户菜单" }).click();
  assert.match(await page.getByRole("menu").textContent() ?? "", /Current actor/);
  assert.equal(await page.getByRole("menu").locator("img").count(), 0);
  assert.match(await page.getByRole("menu").textContent() ?? "", /不可用/);
  console.log("brokenAvatarRestoresInitial: header and popover");
  await page.keyboard.press("Escape");

  for (const failure of ["401", "404", "500", "reject"]) {
    await page.getByRole("button", { name: "Log out" }).click();
    await page.getByRole("button", { name: `Sign in with ${failure}` }).click();
    assert.equal(await page.getByTestId("header-identity-label").textContent(), "qa");
    await page.getByRole("button", { name: "打开账户菜单" }).click();
    await page.getByRole("button", { name: "重试" }).click();
    assert.equal(await page.getByRole("button", { name: "重试" }).count(), 0);
    await page.keyboard.press("Escape");
  }
  console.log("summaryFailures: 401/404/500/rejection fallback and one retry");
  await page.getByRole("button", { name: "Sign in with summary" }).click();
  assert.equal(await page.getByTestId("header-identity-label").textContent(), "Current actor");
  await page.getByRole("button", { name: "打开账户菜单" }).click();
  assert.deepEqual(await page.getByRole("menu").locator(".header-user-menu__stat strong").allTextContents(), ["0", "0"]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Log out" }).click();
  assert.equal(await page.getByTestId("header-identity-label").count(), 0);
  await page.getByRole("button", { name: "Sign in with pending summary" }).click();
  assert.equal(await page.getByTestId("header-identity-label").textContent(), "qa");
  console.log("logoutRefresh: previous summary cleared");
  assert.equal(external.length, 0);
  console.log("HEADER_IDENTITY_OK 10/10");
} finally {
  await browser?.close();
  await server.close();
}
