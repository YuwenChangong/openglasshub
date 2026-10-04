import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, unlink, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { preparePreferenceRunEnvironment } from "./test-user-preferences-rls-local.mjs";
import { buildRepositoryInventory } from "./lib/product-detail-repository-inventory.mjs";

const root = path.resolve(import.meta.dirname, "..");
const allowed = ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "COMSPEC"];
const environment = preparePreferenceRunEnvironment(Object.fromEntries(allowed.filter(key => process.env[key]).map(key => [key, process.env[key]])));
Object.assign(environment, { ASTRO_TELEMETRY_DISABLED: "1", ASTRO_DISABLE_UPDATE_CHECK: "true", CLOUDFLARE_CF_FETCH_ENABLED: "false", WRANGLER_SEND_METRICS: "false" });
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, environment);
const artifact = path.join(root, "artifacts/qa/product-brand-view-link", randomUUID());
await mkdir(artifact, { recursive: true });
// Match the existing SSR tests' application loader rather than raw Node JSON imports.
const catalogPath = path.join(artifact, "catalog-fixture.mjs");
await build({ entryPoints: [path.join(root, "src/lib/device-catalog.ts")], outfile: catalogPath,
  bundle: true, platform: "node", format: "esm", logLevel: "silent" });
const { getDeviceBySlug } = await import(pathToFileURL(catalogPath).href);
const configPath = path.join(artifact, "local-build.json");
const fixtureOrigin = "http://127.0.0.1:54321";
const anonKey = "local-product-link-fixture-anon";
const product = getDeviceBySlug("xreal-air");
assert.ok(product && product.name === "XREAL Air" && product.brandKey === "xreal", "EXISTING_XREAL_AIR_FIXTURE_REQUIRED");
const row = {
  slug: product.slug, brand_key: product.brandKey, brand_name: product.brandName, name: product.name,
  publication_status: "published", short_description: product.shortDescription, long_description: product.longDescription,
  type_label: product.typeLabel, product_image_url: null, official_product_url: product.officialProductUrl,
  buy_url: product.buyUrl, key_specs: product.previewSpecs,
  full_specs: Object.fromEntries(product.specGroups.map(group => [group.key, Object.fromEntries(group.items.map(item => [item.field, item.value]))])),
};
const sourceSweep = process.argv.includes("--parameter-source-sweep");
const canonicalProof = process.argv.includes("--canonical-proof");
const inventory = sourceSweep || canonicalProof ? await buildRepositoryInventory({ root }) : null;
// These are owned parameter transport fixtures, not publication authority.
const fixtureRows = inventory ? inventory.pipeline.readerCompatibleRows.map(item => ({ ...item,
  product_image_url: null, official_image_url: null })) : [row];
const canonical = `/products/${product.brandKey}/${product.slug}/`;
const oldHref = `/products/${product.brandKey}/#product-${product.slug}`;
const receipt = { PRODUCT_BRAND_VIEW_PRODUCT_LINK_TEST: "FAIL", evidenceClass: "ACTUAL_LOCAL_WORKER_BROWSER_WITH_OFFLINE_DATA_API_FIXTURE_NOT_DB_OR_PRODUCTION",
  observedViewProductHref: null, expectedViewProductHref: canonical, destinationStatus: null, destinationIdentity: null,
  destinationParameterSectionPresent: false,
  anchorPreserved: false, compareTogglePassed: false, compareDestinationPreserved: false, officialLinkPreserved: false,
  deniedWorkerOutbound: 0, deniedBrowserExternal: 0, fixtureReads: 0 };
receipt.parameterSourceDomRetained = 0;
receipt.publicationCohortAcceptance = "NOT_RUN";
const ownedSourcePaths = ["src/lib/public-product-detail.ts", "src/lib/public-device-data.ts", "src/lib/product-route.ts", "src/pages/products/[brand]/[slug].astro",
  "src/pages/products/index.astro", "src/pages/products/[brand].astro", "src/pages/devices/[slug].astro", "src/pages/sitemap.xml.ts",
  "src/lib/forum-search.ts", "src/components/products/ProductDetail.astro", "src/lib/i18n/messages/catalog.ts", "scripts/test-product-brand-view-link.mjs"];
const sourceHashes = async () => Object.fromEntries(await Promise.all(ownedSourcePaths.map(async name => [name,
  createHash("sha256").update(await readFile(path.join(root, name))).digest("hex")])));
receipt.sourceHashes = await sourceHashes();
let worker, browser, stage = "LOCAL_BUILD", readinessTimer;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  assert.ok(url.protocol === "http:" && url.hostname === "127.0.0.1", "NON_LOOPBACK_FETCH_FORBIDDEN");
  return originalFetch(input, init);
};
try {
  const vars = { SITE_ORIGIN: "https://127.0.0.1", SUPABASE_URL: fixtureOrigin, SUPABASE_ANON_KEY: anonKey,
    PUBLIC_SUPABASE_URL: fixtureOrigin, PUBLIC_SUPABASE_ANON_KEY: anonKey, AUTH_CAPTCHA_MODE: "off" };
  await writeFile(configPath, JSON.stringify({ name: "openglasshub", compatibility_date: "2026-05-17", compatibility_flags: ["nodejs_compat"], vars }));
  const built = spawnSync(process.execPath, [path.join(root, "scripts/build-workers.mjs"), "--local-config", configPath],
    { cwd: root, env: environment, encoding: "utf8", windowsHide: true, maxBuffer: 16777216, timeout: 120000 });
  assert.equal(built.status, 0, "FOCUSED_LOCAL_BUILD_FAILED");
  const { unstable_startWorker } = await import("wrangler");
  stage = "LOCAL_WORKER_READY";
  worker = await unstable_startWorker({ config: path.join(root, "dist/server/wrangler.json"), envFiles: [], build: { bundle: false },
    bindings: { SUPABASE_URL: { type: "plain_text", value: fixtureOrigin }, SUPABASE_ANON_KEY: { type: "plain_text", value: anonKey },
      AUTH_CAPTCHA_MODE: { type: "plain_text", value: "off" } },
    dev: { logLevel: "none", remote: false, watch: false, liveReload: false, registry: undefined, persist: false, inspector: false,
      server: { hostname: "127.0.0.1", port: 0, secure: false },
      outboundService(request) {
        const url = new URL(request.url);
        const slug = url.searchParams.get("slug");
        if (canonicalProof && url.origin === fixtureOrigin && request.method === "GET" && ["/rest/v1/circles", "/rest/v1/news_articles"].includes(url.pathname)) {
          assert.equal(request.headers.get("apikey"), anonKey, "FIXTURE_ANON_ONLY");
          receipt.fixtureReads++;
          return new Response("[]", { headers: { "content-type": "application/json" } });
        }
        if (url.origin === fixtureOrigin && request.method === "GET" && /^\/rest\/v1\/public_device_detail_(specs|sources|evidence)$/.test(url.pathname)) {
          assert.equal(request.headers.get("apikey"), anonKey, "FIXTURE_ANON_ONLY");
          receipt.fixtureReads++;
          return new Response("[]", { headers: { "content-type": "application/json", "content-range": "*/0" } });
        }
        if (url.origin !== fixtureOrigin || url.pathname !== "/rest/v1/devices" || request.method !== "GET"
          || url.searchParams.get("publication_status") !== "eq.published") {
          receipt.deniedWorkerOutbound++;
          return new Response("LOCAL_PRODUCT_LINK_OUTBOUND_FORBIDDEN", { status: 599 });
        }
        assert.equal(request.headers.get("apikey"), anonKey, "FIXTURE_ANON_ONLY");
        receipt.fixtureReads++;
        const rows = canonicalProof && slug === "eq.local-mismatched-identity" ? [row]
          : fixtureRows.filter(item => slug === null || slug === `eq.${item.slug}`);
        return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } });
      } } });
  await Promise.race([Promise.all([worker.ready, new Promise((resolve, reject) => {
    worker.raw.once("reloadComplete", resolve);
    worker.raw.once("error", () => reject(new Error("LOCAL_WORKER_STARTUP_ERROR")));
    worker.raw.once("runtimeError", () => reject(new Error("LOCAL_WORKER_RUNTIME_ERROR")));
  })]), new Promise((_, reject) => { readinessTimer = setTimeout(() => reject(new Error("LOCAL_WORKER_READINESS_TIMEOUT")), 30000); })]);
  clearTimeout(readinessTimer);
  const origin = (await worker.url).origin;
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  stage = "LOCAL_BRAND_PAGE";
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    receipt.deniedBrowserExternal++;
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const brandResponse = await page.goto(`${origin}/products/xreal/`, { waitUntil: "load", timeout: 20000 });
  assert.equal(brandResponse.status(), 200);
  const card = page.locator('[data-product-card][data-product-slug="xreal-air"]');
  assert.equal(await card.locator("h2").textContent(), product.name);
  const view = card.locator(".brand-product-card__links a").first();
  receipt.observedViewProductHref = await view.getAttribute("href");
  stage = "VIEW_PRODUCT_CANONICAL_HREF";
  assert.equal(receipt.observedViewProductHref, canonical, "VIEW_PRODUCT_MUST_ENTER_CANONICAL_DETAIL_NOT_BRAND_ANCHOR");
  assert.notEqual(receipt.observedViewProductHref, `#product-${product.slug}`);
  assert.notEqual(receipt.observedViewProductHref, oldHref);
  stage = "UNCHANGED_CARD_CONTROLS";
  assert.equal(await card.getAttribute("id"), `product-${product.slug}`);
  receipt.anchorPreserved = true;
  const official = card.locator(".brand-product-card__links a").nth(1);
  assert.equal(await official.getAttribute("href"), product.officialProductUrl ?? product.buyUrl ?? product.brandWebsiteUrl ?? "/products/");
  assert.equal(await official.getAttribute("target"), "_blank");
  assert.equal(await official.getAttribute("rel"), "noopener noreferrer");
  receipt.officialLinkPreserved = true;
  const data = JSON.parse(await page.locator("#brand-products-data").textContent());
  assert.equal(data.compareProducts.find(item => item.slug === product.slug).detailHref, canonical);
  receipt.compareDestinationPreserved = true;
  const compare = card.locator("[data-compare-button]");
  assert.equal((await compare.textContent()).trim(), "+");
  await compare.click();
  assert.ok((await compare.getAttribute("class")).split(/\s+/).includes("is-selected"));
  await compare.click();
  assert.ok(!(await compare.getAttribute("class")).split(/\s+/).includes("is-selected"));
  receipt.compareTogglePassed = true;
  stage = "FOLLOW_VIEW_PRODUCT";
  const navigation = page.waitForNavigation({ waitUntil: "load", timeout: 20000 });
  await view.click();
  const destination = await navigation;
  receipt.destinationStatus = destination.status();
  assert.equal(receipt.destinationStatus, 200);
  assert.equal(new URL(page.url()).pathname, canonical);
  const detail = page.locator("[data-product-detail]");
  assert.equal(await detail.getAttribute("data-product-slug"), product.slug);
  assert.equal(await detail.getAttribute("data-product-brand"), product.brandKey);
  receipt.destinationIdentity = await detail.locator("h1").textContent();
  assert.equal(receipt.destinationIdentity, "XREAL Air");
  assert.equal(await detail.locator(".product-detail__parameters").count(), 1);
  receipt.destinationParameterSectionPresent = true;
  await page.screenshot({ path: path.join(artifact, "detail-desktop.png"), fullPage: true });
  if (sourceSweep) {
    stage = "TASK4_SOURCE_PARAMETER_DOM_TRANSPORT_NOT_PUBLICATION_ACCEPTANCE";
    for (const fixture of fixtureRows) {
      const response = await page.goto(`${origin}/products/${fixture.brand_key}/${fixture.slug}/`, { waitUntil: "load", timeout: 20000 });
      assert.equal(response.status(), 200);
      const observed = await page.locator("[data-parameter-key]").evaluateAll(elements => elements.map(element => ({
        key: element.getAttribute("data-parameter-key"), value: element.querySelector("dd").getAttribute("data-factual-value"),
        provenance: element.getAttribute("data-parameter-provenance"),
      })));
      for (const source of inventory.parameterLedger.filter(item => item.slug === fixture.slug && item.state === "KNOWN")) {
        assert.ok(observed.some(item => item.key === source.canonicalPath && item.value === String(source.value) && item.provenance === "LEGACY_UNVERIFIED"), `SOURCE_DOM_FIELD_DROPPED:${source.pointer}`);
        receipt.parameterSourceDomRetained++;
      }
    }
    assert.equal(receipt.parameterSourceDomRetained, 829);
  }
  if (canonicalProof) {
    stage = "TASK5_CANONICAL_ENTRY_PROOF";
    const api = await context.request.get(`${origin}/api/forum/search?q=xreal&type=devices`);
    assert.equal(api.status(), 200);
    const payload = await api.json();
    assert.equal(payload.ok, true);
    const search = payload.results;
    assert.ok(search.devices.length > 0, "Published device-scoped search must have matches");
    for (const device of search.devices) {
      const identity = fixtureRows.find(item => item.slug === device.slug);
      assert.equal(device.href, `/products/${identity.brand_key}/${identity.slug}/`);
    }
    receipt.searchDeviceCanonicalLink = "PASS";
    const sitemap = await context.request.get(`${origin}/sitemap.xml`);
    assert.equal(sitemap.status(), 200);
    const xml = await sitemap.text();
    for (const item of fixtureRows) assert.ok(xml.includes(`/products/${item.brand_key}/${item.slug}/</loc>`));
    assert.ok(!xml.includes("#product-") && !xml.includes("/devices/"));
    receipt.sitemapCanonicalLinks = "PASS";
    const alias = await context.request.get(`${origin}/devices/${product.slug}/`, { maxRedirects: 0 });
    assert.equal(alias.status(), 301);
    assert.equal(alias.headers().location, canonical);
    const unknown = await context.request.get(`${origin}/devices/local-missing-slug/`, { maxRedirects: 0 });
    assert.equal(unknown.status(), 404);
    const mismatched = await context.request.get(`${origin}/devices/local-mismatched-identity/`, { maxRedirects: 0 });
    assert.equal(mismatched.status(), 503);
    receipt.legacyCanonicalRedirect = "PASS";
    await page.goto(`${origin}/products/`, { waitUntil: "load" });
    await page.locator("#products-search").fill("XREAL Air");
    const dropdownLink = page.locator(".products-search-result__title").filter({ hasText: /^XREAL Air$/ });
    assert.equal(await dropdownLink.getAttribute("href"), canonical);
    const indexNavigation = page.waitForNavigation({ waitUntil: "load" });
    await dropdownLink.click();
    assert.equal((await indexNavigation).status(), 200);
    assert.equal(new URL(page.url()).pathname, canonical);
    receipt.productIndexCanonicalLink = "PASS";
    const handoff = page.locator("[data-detail-compare]");
    const handoffNavigation = page.waitForNavigation({ waitUntil: "load" });
    await handoff.click();
    assert.equal((await handoffNavigation).status(), 200);
    assert.equal(new URL(page.url()).searchParams.get("compare"), product.slug);
    assert.ok((await page.locator('[data-product-card][data-product-slug="xreal-air"] [data-compare-button]').getAttribute("class")).split(/\s+/).includes("is-selected"));
    const selectedFixtures = fixtureRows.slice(0, 3);
    const selection = new URLSearchParams(selectedFixtures.map(item => ["compare", item.slug]));
    selection.append("compare", selectedFixtures[0].slug);
    selection.append("compare", "private-missing-slug");
    await page.goto(`${origin}/products/xreal/?${selection}`, { waitUntil: "load" });
    const backLinks = page.locator("#brand-compare-table-head a");
    assert.equal(await backLinks.count(), 3);
    for (let index = 0; index < selectedFixtures.length; index++) {
      const item = selectedFixtures[index];
      assert.equal(await backLinks.nth(index).getAttribute("href"), `/products/${item.brand_key}/${item.slug}/`);
    }
    receipt.compareCanonicalLink = "PASS";
    receipt.compareHandoffMax3 = "PASS";
  }
  assert.equal(receipt.deniedWorkerOutbound, 0);
  assert.equal(receipt.deniedBrowserExternal, 0);
  assert.ok(receipt.fixtureReads >= 2);
  assert.deepEqual(await sourceHashes(), receipt.sourceHashes, "Focused proof source must not drift during build/browser execution");
  receipt.PRODUCT_BRAND_VIEW_PRODUCT_LINK_TEST = "PASS";
} catch (error) {
  receipt.firstFail = error.code ?? error.name;
  receipt.failedBoundary = stage;
  throw error;
} finally {
  clearTimeout(readinessTimer);
  await browser?.close();
  await worker?.dispose();
  globalThis.fetch = originalFetch;
  await unlink(configPath).catch(error => { if (error.code !== "ENOENT") throw error; });
  await writeFile(path.join(artifact, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ ...receipt, receiptPath: path.relative(root, path.join(artifact, "receipt.json")) }));
}
