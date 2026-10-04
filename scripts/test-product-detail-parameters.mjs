import assert from "node:assert/strict";
import { build } from "esbuild";
import { buildRepositoryInventory } from "./lib/product-detail-repository-inventory.mjs";

const compiled = await build({ entryPoints: ["src/lib/public-product-detail.ts"], bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent" });
const module = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
assert.equal(typeof module.buildDetailParameterGroups, "function", "TRUTHFUL_DETAIL_PARAMETER_MODEL_MISSING");
const { buildDetailParameterGroups } = module;
const inventory = await buildRepositoryInventory();
let retained = 0;
for (const row of inventory.pipeline.readerCompatibleRows) {
  const product = { specGroups: Object.entries(row.full_specs).map(([key, fields]) => ({ key, label: key,
    items: Object.entries(fields).map(([field, value]) => ({ field, label: field, value })) })) };
  const groups = buildDetailParameterGroups(product, []);
  for (const source of inventory.parameterLedger.filter(entry => entry.slug === row.slug && entry.state === "KNOWN")) {
    const item = groups.flatMap(group => group.items).find(item => item.key === source.canonicalPath);
    assert.ok(item, `SOURCE_FIELD_DROPPED:${source.pointer}`);
    assert.equal(item.value, String(source.value), `SOURCE_VALUE_CHANGED:${source.pointer}`);
    assert.equal(item.provenance, "LEGACY_UNVERIFIED");
    retained++;
  }
}
assert.equal(retained, 829, "Frozen source authority must not be shrunk");
const legacy = { specGroups: [{ key: "basic", label: "Basic", items: [{ field: "weight_g", label: "Weight", value: "82" }] }] };
const structured = { id: "spec", key: "basic.weight_g", group_key: "basic", label: "Weight", value_type: "number", admin_order: 0,
  state: "KNOWN", value_number: 82, value_boolean: null, value_text: null, value_json: null,
  canonical_unit: "g", measurement_context: null, region: "Global", variant: "", confidence: "HIGH", verified_at: null };
let items = buildDetailParameterGroups(legacy, [structured]).flatMap(group => group.items);
assert.equal(items.length, 2, "Legacy context is unspecified; equal text is not proof of equivalent applicability");
assert.equal(items[0].provenance, "STRUCTURED_VERIFIED");
assert.equal(items[0].value, "82");
assert.equal(items[1].provenance, "LEGACY_UNVERIFIED");
items = buildDetailParameterGroups(legacy, [{ ...structured, value_number: 83 }]).flatMap(group => group.items);
assert.deepEqual(items.map(item => item.value), ["83", "82"], "Structured primary value must not erase differing legacy facts");
assert.deepEqual(items.map(item => item.provenance), ["STRUCTURED_VERIFIED", "LEGACY_UNVERIFIED"]);
for (const variant of [{ measurement_context: "different" }, { region: "US" }, { variant: "different" }]) {
  assert.equal(buildDetailParameterGroups(legacy, [{ ...structured, ...variant }])[0].items.length, 2, "Different contexts must not deduplicate");
}
for (const [value_type, values, expected] of [["number", { value_number: 0 }, "0"], ["boolean", { value_boolean: false, value_number: null }, "No"], ["json", { value_json: { zero: 0 }, value_number: null }, '{"zero":0}']]) {
  const model = buildDetailParameterGroups({ specGroups: [] }, [{ ...structured, value_type, ...values }]);
  assert.equal(model[0].items[0].value, expected);
}
items = buildDetailParameterGroups(legacy, [{ ...structured, state: "NOT_DISCLOSED", value_number: null }])[0].items;
assert.ok(items.some(item => item.value === "82" && item.provenance === "LEGACY_UNVERIFIED"));
assert.ok(items.some(item => item.state === "NOT_DISCLOSED" && item.provenance === "UNKNOWN"));
assert.deepEqual(buildDetailParameterGroups({ specGroups: [] }, []), []);
console.log("PRODUCT_DETAIL_PARAMETER_MODEL=PASS");
console.log(`KNOWN_SOURCE_PARAMETERS=${retained}`);
console.log("KNOWN_PARAMETER_VALUE_DROPPED_COUNT=0");
console.log("FABRICATED_PARAMETER_VALUE_COUNT=0");
