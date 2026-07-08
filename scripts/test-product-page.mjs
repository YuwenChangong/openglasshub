import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runNodeWithStripTypes(code) {
  return execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", code], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

async function readJson(relativePath) {
  return JSON.parse(await read(relativePath));
}

async function main() {
  const productsIndex = await read("src/pages/products/index.astro");
  const brandPage = await read("src/pages/products/[brand].astro");
  const visual = await read("src/components/products/ProductVisual.astro");
  const docs = await read("docs/README.md");
  const navigation = await read("src/lib/site-navigation.ts");
  const homepage = await read("src/pages/index.astro");
  const deviceCatalogSource = await read("src/lib/device-catalog.ts");
  const productManifest = await readJson("src/data/product-public-data.json");
  const sitemap = await read("src/pages/sitemap.xml.ts");

  assert(productsIndex.includes("data-brand-module"), "Products index should render brand modules.");
  assert(productsIndex.includes('id="products-search"'), "Products index should keep a single search input.");
  assert(!productsIndex.includes("data-product-card"), "Products index should not render full product cards.");
  assert(!productsIndex.includes("data-compare-button"), "Products index should not render compare buttons.");
  assert(!productsIndex.includes("products-compare"), "Products index should not render a compare tray.");
  assert(!productsIndex.includes("/guides/"), "Products index should not surface a guides CTA.");
  assert(productsIndex.includes("brand-module__pill"), "Products index should surface product preview pills inside brand modules.");
  assert(productsIndex.includes("brand-module__count"), "Products index should keep a stable product count badge.");

  assert(brandPage.includes("maxCompareCount = 3"), "Brand page should cap comparison at 3.");
  assert(brandPage.includes('id="brand-products-search"'), "Brand page should keep a single search input.");
  assert(!brandPage.includes("compare-search"), "Brand page should not include a compare-specific search input.");
  assert(brandPage.includes("data-compare-button"), "Brand page should expose compare buttons on product cards.");
  assert(brandPage.includes("brand-product-card__footer"), "Brand page should place actions in the product card footer.");
  assert(brandPage.includes("brand-product-card__compare-button"), "Brand page should keep compare buttons at the bottom-right action area.");
  assert(brandPage.includes('href="/products/"'), "Brand page should link back to /products/.");
  assert(!brandPage.includes("/devices/"), "Brand page should not link into /devices/.");

  assert(visual.includes("product-visual__title"), "Product visual should keep the title dominant.");
  assert(!visual.includes("product-visual__pill"), "Product visual should not render top-right pills.");

  assert(navigation.includes('label: "产品"'), "Main navigation should keep the products entry.");
  assert(!navigation.includes('label: "设备库"'), "Main navigation should not include the device library entry.");
  assert(!navigation.includes('label: "选购指南"'), "Product sub-navigation should not include guides.");

  assert(homepage.includes("AR / AI 眼镜社区"), "Homepage copy should stay focused on AR / AI glasses.");
  assert(!homepage.includes("空间计算。"), "Homepage intro should not frame the site around spatial computing.");

  assert(docs.includes("brand-module") || docs.includes("品牌模块"), "Docs should describe the brand-module products surface.");
  assert(docs.includes("Legacy `/devices/` routes"), "Docs should note /devices/ as a downlined legacy surface.");

  assert(!sitemap.includes('absoluteUrl("/devices/') && !sitemap.includes('absoluteUrl("/devices/"'), "Sitemap should not emphasize /devices/ routes.");

  const productCount = Array.isArray(productManifest.products) ? productManifest.products.length : 0;
  const productSlugs = new Set(Array.isArray(productManifest.products) ? productManifest.products.map((product) => product.slug) : []);

  assert(productCount >= 24, `Expected at least 24 products, found ${productCount}.`);
  assert(productSlugs.has("xreal-one"), "Expected xreal-one in the public product manifest.");
  assert(productSlugs.has("ray-ban-meta"), "Expected ray-ban-meta in the public product manifest.");
  assert(productSlugs.has("rayneo-x2"), "Expected rayneo-x2 in the public product manifest.");
  assert(!productSlugs.has("apple-vision-pro"), "Public product manifest should not include apple-vision-pro.");

  assert(!deviceCatalogSource.includes('"standalone_xr"'), "Device catalog should not expose standalone_xr as a public category.");
  assert(!deviceCatalogSource.includes('"apple-vision-pro"'), "Device catalog should not expose apple-vision-pro.");
  assert(deviceCatalogSource.includes('label: "AR 眼镜"'), "Device catalog should expose AR glasses as a public category.");
  assert(deviceCatalogSource.includes('label: "AI 眼镜"'), "Device catalog should expose AI glasses as a public category.");

  const stripTypesCheck = runNodeWithStripTypes(`
    const payload = {
      indexHasSingleSearch: ${productsIndex.includes('id="products-search"')},
      indexHasNoCompare: ${!productsIndex.includes("data-compare-button") && !productsIndex.includes("products-compare")},
      brandHasCompare: ${brandPage.includes("data-compare-button") && brandPage.includes("maxCompareCount = 3")},
    };
    process.stdout.write(JSON.stringify(payload));
  `);
  const parsed = JSON.parse(stripTypesCheck);
  assert(parsed.indexHasSingleSearch, "Strip-types sanity check should confirm the single-search products index.");
  assert(parsed.indexHasNoCompare, "Strip-types sanity check should confirm no compare UI on the products index.");
  assert(parsed.brandHasCompare, "Strip-types sanity check should confirm compare on the brand page.");

  console.log(`PRODUCT_PAGE_AUDIT_OK products=${productCount}`);
}

main().catch((error) => {
  console.error(`PRODUCT_PAGE_AUDIT_FAIL ${error.message}`);
  process.exitCode = 1;
});
