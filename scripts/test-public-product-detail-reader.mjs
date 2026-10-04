import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

const compiled = await build({ entryPoints: ["src/lib/public-product-detail.ts"], bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent" });
const { getPublicProductDetail } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const fixture = JSON.parse(await readFile("scripts/fixtures/product-detail-public-row.json", "utf8"));
let calls = [], published = true, failure = false, rows = [], missingCount = false;
const client = { from(table) {
  const call = { table, columns: "", filters: [], orders: [] }; calls.push(call);
  const query = {
    select(columns, options) { call.columns = columns; call.options = options; return query; },
    eq(...filter) { call.filters.push(filter); return query; },
    order(key) { call.orders.push(key); return query; },
    maybeSingle() { return Promise.resolve({ data: published ? fixture : null, error: null }); },
    range(start) { return Promise.resolve(failure ? { error: { message: "PRIVATE_BACKEND_SENTINEL" }, data: null } : {
      data: table === "public_device_detail_specs" ? rows.slice(start, start + 1) : [],
      count: missingCount ? null : table === "public_device_detail_specs" ? rows.length : 0, error: null,
    }); },
  }; return query;
} };
published = false;
assert.equal(await getPublicProductDetail(client, fixture.slug), null);
assert.equal(calls.length, 1, "Missing/unpublished identity must not read normalized tables");
published = true; calls = [];
const empty = await getPublicProductDetail(client, fixture.slug);
assert.deepEqual([empty.specs, empty.sources, empty.evidence], [[], [], []]);
assert.equal(empty.product.slug, fixture.slug);
for (const call of calls.slice(1)) {
  assert.ok(call.table.startsWith("public_device_detail_"));
  assert.ok(call.filters.some(([key, value]) => key === "device_slug" && value === fixture.slug));
  assert.equal(call.options.count, "exact");
  assert.doesNotMatch(call.columns, /raw_value|note|updated_by|actor_id|\*/);
}
rows = [{ id: "first" }, { id: "second" }, { id: "third" }];
assert.equal((await getPublicProductDetail(client, fixture.slug)).specs.length, 3, "Server row cap must not truncate detail fields");
failure = true;
await assert.rejects(getPublicProductDetail(client, fixture.slug), { message: "Public product detail read failed." });
failure = false; missingCount = true;
await assert.rejects(getPublicProductDetail(client, fixture.slug), { message: "Public product detail read failed." });
console.log("PUBLIC_PRODUCT_DETAIL_READER=PASS");
