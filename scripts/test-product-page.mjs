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
  const deviceCatalogSource = await read("src/lib/device-catalog.ts");
  const productManifest = await readJson("src/data/product-public-data.json");

  assert(productsIndex.includes("maxCompareCount = 3"), "Products index should cap comparison at 3.");
  assert(productsIndex.includes("data-compare-button"), "Products index should expose add-to-compare controls.");
  assert(productsIndex.includes("products-compare-search"), "Products index should include compare search.");
  assert(productsIndex.includes("完整资料"), "Products index should retain a detail CTA.");
  assert(!productsIndex.includes("brand.positioning"), "Products index should not render long brand positioning copy on the main listing.");
  assert(!productsIndex.includes("brand.shortIntro"), "Products index should not render long brand intro copy on the main listing.");
  assert(brandPage.includes('href="/products/"'), "Brand page should link back to the main products surface.");
  assert(brandPage.includes("product-chip"), "Brand page should use the shared stable chip styling.");
  assert(!visual.includes("product-visual__highlights"), "Product visual should no longer render busy highlight blocks in the placeholder.");
  assert(visual.includes("product-visual__title"), "Product visual should keep the title as the dominant placeholder element.");
  assert(navigation.includes('label: "产品"'), "Main navigation should keep the products entry.");
  assert(docs.includes("primary product discovery surface") || docs.includes("主产品发现页"), "Docs should note the product page as the primary discovery surface.");

  const productCount = Array.isArray(productManifest.products) ? productManifest.products.length : 0;
  const brandCount = (deviceCatalogSource.match(/featuredProducts:/g) ?? []).length;
  const sampleProducts = Array.isArray(productManifest.products)
    ? productManifest.products
        .map((product) => product.slug)
        .filter((slug) => ["xreal-one", "ray-ban-meta", "apple-vision-pro"].includes(slug))
    : [];

  assert(productCount >= 25, `Expected at least 25 products, found ${productCount}.`);
  assert(brandCount >= 8, `Expected at least 8 brands, found ${brandCount}.`);
  assert(sampleProducts.includes("xreal-one"), "Expected xreal-one in the public product manifest.");
  assert(sampleProducts.includes("ray-ban-meta"), "Expected ray-ban-meta in the public product manifest.");
  assert(sampleProducts.includes("apple-vision-pro"), "Expected apple-vision-pro in the public product manifest.");
  assert(deviceCatalogSource.includes("cardSpecs"), "Product catalog should still expose cardSpecs.");
  assert(deviceCatalogSource.includes("specGroups"), "Product catalog should still expose specGroups.");

  const stripTypesCheck = runNodeWithStripTypes(`
    const payload = {
      hasCompareLimit: ${productsIndex.includes("maxCompareCount = 3")},
      hasCompareSearch: ${productsIndex.includes("products-compare-search")},
    };
    process.stdout.write(JSON.stringify(payload));
  `);
  const parsed = JSON.parse(stripTypesCheck);
  assert(parsed.hasCompareLimit, "Strip-types sanity check should confirm compare limit.");
  assert(parsed.hasCompareSearch, "Strip-types sanity check should confirm compare search.");

  console.log(`PRODUCT_PAGE_AUDIT_OK products=${productCount} brands=${brandCount}`);
}

main().catch((error) => {
  console.error(`PRODUCT_PAGE_AUDIT_FAIL ${error.message}`);
  process.exitCode = 1;
});
