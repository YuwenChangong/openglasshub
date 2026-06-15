import fs from "node:fs/promises";
import path from "node:path";

const REQUIRED_SLUGS = [
  "xreal-one",
  "xreal-one-pro",
  "xreal-air-2-pro",
  "xreal-air-2-ultra",
  "rayneo-x2",
  "rokid-max",
  "rokid-glasses",
  "viture-pro",
  "inmo-air-2",
  "ray-ban-meta",
  "brilliant-labs-frame",
  "even-realities-g1",
  "apple-vision-pro",
];

const DIRTY_PATTERNS = [/^000$/i, /^5g$/i, /^8g$/i, /^wifi 6g$/i, /^wifi 8g$/i, /^wifi 6g \| wifi 8g$/i];
const FORBIDDEN_UI_STRINGS = [
  "参数待确认",
  "资料状态",
  "部分待确认",
  "已确认参数",
  "最后核对",
  "needs review",
  "missing fields",
  "confirmed fields",
  "data status",
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
  const sourceLedger = await loadJson("docs/product-data-sources.json");
  const deviceCatalogSource = await loadText("src/lib/device-catalog.ts");
  const productVisualSource = await loadText("src/components/products/ProductVisual.astro");
  const productBrandPageSource = await loadText("src/pages/products/[brand].astro");
  const productDetailPageSource = await loadText("src/pages/devices/[slug].astro");

  const errors = [];
  const warnings = [];
  const products = Array.isArray(sourceLedger.products) ? sourceLedger.products : [];
  const slugSet = new Set(products.map((entry) => entry.slug));

  for (const slug of REQUIRED_SLUGS) {
    if (!slugSet.has(slug)) fail(errors, `missing source ledger entry: ${slug}`);
    if (!deviceCatalogSource.includes(`"${slug}"`)) fail(errors, `missing device-catalog entry: ${slug}`);
  }

  for (const forbidden of FORBIDDEN_UI_STRINGS) {
    if (productVisualSource.toLowerCase().includes(forbidden.toLowerCase())) fail(errors, `ProductVisual contains forbidden UI copy: ${forbidden}`);
    if (productBrandPageSource.toLowerCase().includes(forbidden.toLowerCase())) fail(errors, `products/[brand] contains forbidden UI copy: ${forbidden}`);
    if (productDetailPageSource.toLowerCase().includes(forbidden.toLowerCase())) fail(errors, `devices/[slug] contains forbidden UI copy: ${forbidden}`);
  }

  for (const product of products) {
    const label = product.slug ?? product.name ?? "unknown";
    if (!product.coverage?.category) fail(errors, `${label}: coverage.category missing`);
    if (!product.coverage?.status) fail(errors, `${label}: coverage.status missing`);
    if (!product.coverage?.positioning) fail(errors, `${label}: coverage.positioning missing`);
    if (!product.coverage?.shortSummary) fail(errors, `${label}: coverage.shortSummary missing`);
    if (!product.coverage?.bestFor) fail(errors, `${label}: coverage.bestFor missing`);
    if (!product.coverage?.notIdealFor) fail(errors, `${label}: coverage.notIdealFor missing`);
    if (!product.coverage?.sourceUrl) fail(errors, `${label}: coverage.sourceUrl missing`);
    if (!Array.isArray(product.sources) || product.sources.length === 0) fail(errors, `${label}: no sources listed`);
    if (!Array.isArray(product.missingFields)) fail(errors, `${label}: missingFields missing`);
    if (!product.publicData?.shortSummary) fail(errors, `${label}: publicData.shortSummary missing`);
    if (!product.publicData?.sourceUrl && !product.sources?.[0]?.url) fail(errors, `${label}: publicData.sourceUrl missing`);

    const officialSource = (product.sources ?? []).find((source) => String(source.review) === "official");
    if (!officialSource) fail(errors, `${label}: no official source recorded`);

    const visibleStrings = collectStrings(product.publicData ?? {});
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

    for (const text of visibleStrings) {
      const trimmed = text.trim();
      if (FORBIDDEN_UI_STRINGS.some((item) => trimmed.toLowerCase().includes(item.toLowerCase()))) {
        fail(errors, `${label}: forbidden UI string leaked into publicData -> ${trimmed}`);
      }
      if (/待确认/.test(trimmed) && !/不适合|限制/.test(trimmed)) {
        fail(errors, `${label}: publicData contains 待确认 copy -> ${trimmed}`);
      }
      if (/wi-?fi\s*6\s*b/i.test(trimmed)) {
        fail(errors, `${label}: publicData contains dirty Wi-Fi 6 B -> ${trimmed}`);
      }
    }

    const keySpecs = product.publicData?.keySpecs ? Object.values(product.publicData.keySpecs) : [];
    if (keySpecs.some((value) => String(value).includes("待确认"))) {
      fail(errors, `${label}: keySpecs contains 待确认`);
    }
    const batteryLifeValues = collectStrings(product.publicData?.fullSpecs?.batteryBody ?? {});
    for (const value of batteryLifeValues) {
      if (/^\d+$/.test(value.trim())) {
        fail(errors, `${label}: battery/body spec contains isolated number -> ${value.trim()}`);
      }
    }
  }

  console.log(`source ledger entries: ${products.length}`);
  console.log(`required products: ${REQUIRED_SLUGS.length}`);
  console.log(`errors: ${errors.length}`);
  console.log(`warnings: ${warnings.length}`);

  if (args.verbose) {
    for (const product of products) {
      console.log(`- ${product.slug}: sources=${product.sources.length} missing=${(product.missingFields ?? []).join(", ") || "none"} review=${(product.needsReviewFields ?? []).join(", ") || "none"}`);
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
