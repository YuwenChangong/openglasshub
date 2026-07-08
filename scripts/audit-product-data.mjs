import fs from "node:fs/promises";
import path from "node:path";

const REQUIRED_SLUGS = [
  "xreal-one",
  "xreal-one-pro",
  "xreal-air",
  "xreal-air-2",
  "xreal-air-2-pro",
  "xreal-air-2-ultra",
  "rayneo-air-2",
  "rayneo-air-2s",
  "rayneo-air-3s",
  "rayneo-air-4-pro",
  "rayneo-x2",
  "rayneo-x3-pro",
  "rokid-air",
  "rokid-ar-lite",
  "rokid-max",
  "rokid-glasses",
  "viture-one",
  "viture-one-lite",
  "viture-pro",
  "inmo-air-2",
  "inmo-go3",
  "ray-ban-meta",
  "brilliant-labs-frame",
  "even-realities-g1",
];
const FORBIDDEN_SLUGS = ["apple-vision-pro"];
const MIN_PRODUCT_COUNT = 24;
const DIRTY_PATTERNS = [/^000$/i, /^5g$/i, /^8g$/i, /^wifi 6g$/i, /^wifi 8g$/i, /^wifi 6g \| wifi 8g$/i, /^wi-?fi\s*6\s*b$/i];
const FORBIDDEN_UI_STRINGS = [
  "参数待确认",
  "资料状态",
  "部分待确认",
  "已确认参数",
  "最后核对",
  "参数来源",
  "资料来源",
  "needs review",
  "missing fields",
  "confirmed fields",
  "data status",
  "sourceurl",
  "sourcenotes",
  "lastchecked",
  "needsreviewfields",
  "missingfields",
  "confirmedfields",
];
const FORBIDDEN_PUBLIC_FIELDS = [
  "sourceUrl",
  "sourceNotes",
  "lastChecked",
  "missingFields",
  "needsReviewFields",
  "confirmedFields",
  "supportUrl",
  "sourceLedger",
];

function parseArgs(argv) {
  return {
    strict: argv.includes("--strict"),
    verbose: argv.includes("--verbose"),
  };
}

function collectStrings(value, bucket = []) {
  if (typeof value === "string") bucket.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, bucket));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, bucket));
  return bucket;
}

async function loadJson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  const raw = await fs.readFile(absolute, "utf8");
  return JSON.parse(raw);
}

async function loadText(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  return fs.readFile(absolute, "utf8");
}

function fail(list, message) {
  list.push(message);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceLedger = await loadJson("internal/product-data-sources.json");
  const publicManifest = await loadJson("src/data/product-public-data.json");
  const deviceCatalogSource = await loadText("src/lib/device-catalog.ts");
  const productVisualSource = await loadText("src/components/products/ProductVisual.astro");
  const productIndexPageSource = await loadText("src/pages/products/index.astro");
  const productBrandPageSource = await loadText("src/pages/products/[brand].astro");
  const productDetailPageSource = await loadText("src/pages/devices/[slug].astro");

  const errors = [];
  const warnings = [];
  const ledgerProducts = Array.isArray(sourceLedger.products) ? sourceLedger.products : [];
  const publicProducts = Array.isArray(publicManifest.products) ? publicManifest.products : [];
  const slugSet = new Set(ledgerProducts.map((entry) => entry.slug));
  const publicSlugSet = new Set(publicProducts.map((entry) => entry.slug));

  if (ledgerProducts.length < MIN_PRODUCT_COUNT) fail(errors, `product count below minimum: ${ledgerProducts.length} < ${MIN_PRODUCT_COUNT}`);
  if (slugSet.size !== ledgerProducts.length) fail(errors, "duplicate slugs found in source ledger");
  if (publicProducts.length < MIN_PRODUCT_COUNT) fail(errors, `public product count below minimum: ${publicProducts.length} < ${MIN_PRODUCT_COUNT}`);

  for (const slug of REQUIRED_SLUGS) {
    if (!slugSet.has(slug)) fail(errors, `missing source ledger entry: ${slug}`);
    if (!publicSlugSet.has(slug)) fail(errors, `missing public data entry: ${slug}`);
    if (!deviceCatalogSource.includes(`"${slug}"`)) fail(errors, `missing device-catalog entry: ${slug}`);
    const mdxPath = path.resolve(process.cwd(), "src/content/docs/devices", `${slug}.mdx`);
    try {
      await fs.access(mdxPath);
    } catch {
      fail(errors, `missing device content doc: ${slug}.mdx`);
    }
  }

  for (const slug of FORBIDDEN_SLUGS) {
    if (publicSlugSet.has(slug)) fail(errors, `forbidden public data entry still present: ${slug}`);
    if (deviceCatalogSource.includes(`"${slug}"`)) fail(errors, `forbidden device-catalog entry still present: ${slug}`);
  }

  if (deviceCatalogSource.includes('"standalone_xr"')) {
    fail(errors, 'device-catalog still exposes forbidden category key: "standalone_xr"');
  }

  for (const forbidden of FORBIDDEN_UI_STRINGS) {
    if (productVisualSource.toLowerCase().includes(forbidden.toLowerCase())) fail(errors, `ProductVisual contains forbidden UI copy: ${forbidden}`);
    if (productIndexPageSource.toLowerCase().includes(forbidden.toLowerCase())) fail(errors, `products/index contains forbidden UI copy: ${forbidden}`);
    if (productBrandPageSource.toLowerCase().includes(forbidden.toLowerCase())) fail(errors, `products/[brand] contains forbidden UI copy: ${forbidden}`);
    if (productDetailPageSource.toLowerCase().includes(forbidden.toLowerCase())) fail(errors, `devices/[slug] contains forbidden UI copy: ${forbidden}`);
  }

  for (const field of FORBIDDEN_PUBLIC_FIELDS) {
    const lower = field.toLowerCase();
    if (deviceCatalogSource.toLowerCase().includes(lower)) fail(errors, `device-catalog exposes forbidden field name: ${field}`);
    const publicText = JSON.stringify(publicManifest).toLowerCase();
    if (publicText.includes(lower)) fail(errors, `public manifest leaks forbidden field: ${field}`);
  }

  if (!productIndexPageSource.includes("data-brand-module")) {
    fail(errors, "products/index should render brand modules");
  }
  if (productIndexPageSource.includes("data-product-card")) {
    fail(errors, "products/index should not render full product cards");
  }
  if (productIndexPageSource.includes("products-compare") || productIndexPageSource.includes("data-compare-button")) {
    fail(errors, "products/index should not render compare UI");
  }
  if (productIndexPageSource.includes("/guides/")) {
    fail(errors, "products/index should not link to guides");
  }
  if (!productBrandPageSource.includes("maxCompareCount = 3")) {
    fail(errors, "products/[brand] should keep compare max 3");
  }
  if (productBrandPageSource.includes("compare-search")) {
    fail(errors, "products/[brand] should not render a compare-specific search input");
  }

  for (const product of ledgerProducts) {
    const label = product.slug ?? product.name ?? "unknown";
    if (!product.slug) fail(errors, `${label}: slug missing`);
    if (!product.name) fail(errors, `${label}: name missing`);
    if (!product.coverage?.category) fail(errors, `${label}: coverage.category missing`);
    if (!product.coverage?.status) fail(errors, `${label}: coverage.status missing`);
    if (!product.coverage?.positioning) fail(errors, `${label}: coverage.positioning missing`);
    if (!product.coverage?.shortSummary) fail(errors, `${label}: coverage.shortSummary missing`);
    if (!product.coverage?.bestFor) fail(errors, `${label}: coverage.bestFor missing`);
    if (!product.coverage?.notIdealFor) fail(errors, `${label}: coverage.notIdealFor missing`);
    if (!Array.isArray(product.sources) || product.sources.length === 0) fail(errors, `${label}: no sources listed`);
    const officialSource = (product.sources ?? []).find((source) => String(source.review) === "official");
    if (!officialSource) fail(errors, `${label}: no official source recorded`);

    const strings = collectStrings(product);
    for (const text of strings) {
      const trimmed = text.trim();
      if (DIRTY_PATTERNS.some((pattern) => pattern.test(trimmed))) {
        fail(errors, `${label}: dirty value found in ledger -> ${trimmed}`);
      }
      if (/^\d+$/.test(trimmed) && trimmed.length <= 3) {
        warnings.push(`${label}: isolated number in source ledger -> ${trimmed}`);
      }
    }
  }

  for (const product of publicProducts) {
    const label = product.slug ?? product.name ?? "unknown";
    if (!product.publicData?.shortSummary) fail(errors, `${label}: publicData.shortSummary missing`);
    if (!product.publicData?.positioning) fail(errors, `${label}: publicData.positioning missing`);
    if (!product.publicData?.bestFor?.length) fail(errors, `${label}: publicData.bestFor missing`);
    if (!product.publicData?.notIdealFor?.length) fail(errors, `${label}: publicData.notIdealFor missing`);

    const visibleStrings = collectStrings(product.publicData ?? {});
    for (const text of visibleStrings) {
      const trimmed = text.trim();
      if (FORBIDDEN_UI_STRINGS.some((item) => trimmed.toLowerCase().includes(item.toLowerCase()))) {
        fail(errors, `${label}: forbidden UI string leaked into publicData -> ${trimmed}`);
      }
      if (/待确认/.test(trimmed) && !/不适合|限制/.test(trimmed)) {
        fail(errors, `${label}: publicData contains 待确认 copy -> ${trimmed}`);
      }
      if (DIRTY_PATTERNS.some((pattern) => pattern.test(trimmed))) {
        fail(errors, `${label}: dirty public value -> ${trimmed}`);
      }
    }

    const batteryLifeValues = collectStrings(product.publicData?.fullSpecs?.batteryBody ?? {});
    for (const value of batteryLifeValues) {
      if (/^\d+$/.test(value.trim())) {
        fail(errors, `${label}: battery/body spec contains isolated number -> ${value.trim()}`);
      }
    }
  }

  console.log(`internal source ledger entries: ${ledgerProducts.length}`);
  console.log(`public product entries: ${publicProducts.length}`);
  console.log(`required products: ${REQUIRED_SLUGS.length}`);
  console.log(`errors: ${errors.length}`);
  console.log(`warnings: ${warnings.length}`);

  if (args.verbose) {
    for (const product of ledgerProducts) {
      console.log(`- ${product.slug}: sources=${product.sources.length} official=${product.sources.some((source) => String(source.review) === "official") ? "yes" : "no"}`);
    }
    if (warnings.length > 0) {
      console.log("\nwarnings:");
      warnings.forEach((warning) => console.log(`- ${warning}`));
    }
  }

  if (args.strict && (errors.length > 0 || warnings.length > 0)) {
    if (errors.length > 0) {
      console.error("\nSTRICT AUDIT FAILED");
      errors.forEach((error) => console.error(`- ${error}`));
    }
    if (warnings.length > 0) {
      console.error("\nSTRICT AUDIT WARNINGS");
      warnings.forEach((warning) => console.error(`- ${warning}`));
    }
    process.exitCode = 1;
    return;
  }

  if (errors.length > 0) {
    console.error("\naudit failed");
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  console.log("\nPRODUCT DATA AUDIT PASSED");
}

main().catch((error) => {
  console.error("product data audit failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
