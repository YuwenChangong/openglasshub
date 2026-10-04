import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const owners = ["src/pages/products/index.astro", "src/pages/products/[brand].astro", "src/lib/forum-search.ts", "src/pages/devices/[slug].astro"];
for (const owner of owners) {
  const source = await readFile(owner, "utf8");
  assert.doesNotMatch(source, /#product-/, `ANCHOR_IDENTITY_LINK_REMAINS:${owner}`);
  assert.match(source, /getProductDetailHref/, `SHARED_CANONICAL_IDENTITY_HELPER_MISSING:${owner}`);
}
const compiled = await build({ entryPoints: ["src/lib/product-route.ts", "src/lib/forum-search.ts"], bundle: true, write: false,
  outdir: "artifacts/qa/product-canonical-unit", platform: "node", format: "esm", logLevel: "silent" });
const modules = new Map();
for (const file of compiled.outputFiles) modules.set(file.path.split(/[\\/]/).at(-1), await import(`data:text/javascript;base64,${Buffer.from(file.text).toString("base64")}`));
const { getProductDetailHref } = modules.get("product-route.js");
assert.equal(getProductDetailHref({ brandKey: "xreal", slug: "xreal-air" }), "/products/xreal/xreal-air/");
for (const part of ["", "../xreal", "xreal/other", "XREAL", "xreal?x", "a".repeat(129)]) {
  assert.throws(() => getProductDetailHref({ brandKey: part, slug: "xreal-air" }));
  assert.throws(() => getProductDetailHref({ brandKey: "xreal", slug: part }));
}
const fixture = JSON.parse(await readFile("scripts/fixtures/product-detail-public-row.json", "utf8"));
const client = { from(table) {
  assert.equal(table, "devices", "Device-scoped search must not expand its database scope");
  const query = { select() { return query; }, eq(key, value) {
    assert.equal(key, "publication_status"); assert.equal(value, "published"); return query;
  }, order() { return Promise.resolve({ data: [fixture], error: null }); } }; return query;
} };
const search = await modules.get("forum-search.js").runForumSearch(client, { query: "xreal", type: "devices" });
assert.equal(search.ok, true);
assert.equal(search.results.devices[0].href, `/products/${fixture.brand_key}/${fixture.slug}/`);
const sitemap = await readFile("src/pages/sitemap.xml.ts", "utf8");
assert.match(sitemap, /for \(const product of publishedDevices\)/, "Sitemap must include published devices without requiring an editorial article");
assert.match(sitemap, /absoluteUrl\(getProductDetailHref\(product\)\)/);
console.log("PRODUCT_CANONICAL_LINKS=PASS");
console.log("ANCHOR_IDENTITY_LINK_COUNT=0");
