import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadApprovedDeviceYaml } from "./devices/schema-v1/yaml-input.mjs";
import { normalizeCatalogYaml } from "./devices/schema-v1/normalize.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const yamlPath = path.join(root, "src/data/devices/openglasshub_device_data_v1.yaml");
const catalog = await loadApprovedDeviceYaml(yamlPath);

assert.equal(catalog.device_count, 24);
assert.equal(catalog.brand_count, 8);
assert.equal(catalog.devices.length, 24);
assert.equal(new Set(catalog.devices.map((device) => device.basic.brand)).size, 8);

const allowedRootKeys = new Set([
  "dataset", "verified_at", "device_count", "brand_count", "normalization_rules",
  "display_ar_schema_keys", "ai_hud_schema_keys", "devices",
]);
assert.deepEqual(new Set(Object.keys(catalog)), allowedRootKeys, "approved catalog has only declared root keys");

for (const device of catalog.devices) {
  assert.ok(["display_ar", "ai_hud"].includes(device.schema_type), "schema_type must be declared");
  const schema = catalog[`${device.schema_type}_schema_keys`];
  assert.deepEqual(new Set(Object.keys(device)), new Set(["schema_type", ...Object.keys(schema)]), "device has only allowed sections");
  for (const [section, fields] of Object.entries(schema)) {
    assert.deepEqual(new Set(Object.keys(device[section])), new Set(Object.keys(fields)), `${device.basic.model} ${section} keys match its schema`);
  }
  assert.equal(typeof device.basic.brand, "string");
  assert.equal(typeof device.basic.model, "string");
  assert.equal(typeof device.basic.generation, "string");
  assert.equal(typeof device.evidence.verified_at, "string");
  assert.equal(typeof device.evidence.region, "string");
  assert.equal(typeof device.evidence.overall_confidence, "string");
  assert.ok(Array.isArray(device.evidence.source_urls));
  assert.ok(Array.isArray(device.evidence.conflicts));
  assert.ok(Array.isArray(device.evidence.notes));
}

const normalized = normalizeCatalogYaml(catalog);
assert.equal(normalized.devices.length, 24);
assert.deepEqual(normalized.blockers, []);
assert.ok(
  normalized.devices.every((device) => ["HIGH", "MEDIUM_HIGH", "MEDIUM", "LOW"].includes(device.evidence.confidence)),
  "all approved confidence values use the exact enum mapping",
);

const normalizedSpecs = normalized.devices.flatMap((device) => device.specs);
assert.ok(normalizedSpecs.some((spec) => spec.rawValue === "No" && spec.state === "KNOWN" && spec.value === false), "explicit No is known false");
assert.ok(normalizedSpecs.some((spec) => spec.rawValue === "Not disclosed" && spec.state === "NOT_DISCLOSED" && !Object.hasOwn(spec, "value")), "Not disclosed has no typed value");
assert.ok(normalizedSpecs.some((spec) => spec.rawValue === "Not applicable" && spec.state === "NOT_APPLICABLE" && !Object.hasOwn(spec, "value")), "Not applicable has no typed value");

const rayBan = normalized.devices.find((device) => device.identity.brand === "Ray-Ban / Meta");
assert.deepEqual(rayBan?.identity, {
  brand: "Ray-Ban / Meta",
  model: "Ray-Ban Meta",
  generation: "Gen 2",
  deviceType: "AI/HUD smart glasses",
  status: "Current",
}, "normalization preserves the guarded Ray-Ban Gen 2 identity without assigning a target slug");
assert.equal(Object.hasOwn(rayBan ?? {}, "slug"), false);

for (const [source, target] of [["High", "HIGH"], ["Medium-High", "MEDIUM_HIGH"], ["Medium", "MEDIUM"], ["Low", "LOW"]]) {
  const fixture = structuredClone(catalog);
  fixture.devices[0].evidence.overall_confidence = source;
  assert.equal(normalizeCatalogYaml(fixture).devices[0].evidence.confidence, target, `${source} maps exactly to ${target}`);
}

const unknownConfidence = structuredClone(catalog);
unknownConfidence.devices[0].evidence.overall_confidence = "Uncertain";
const blocked = normalizeCatalogYaml(unknownConfidence);
assert.equal(blocked.devices[0].evidence.confidence, null);
assert.deepEqual(blocked.blockers, [{
  code: "BLOCKED_CONFIDENCE_VALUE",
  deviceKey: "XREAL|XREAL One|One series",
  path: "evidence.overall_confidence",
  detail: "Uncertain",
}]);

console.log(`DEVICE_SCHEMA_V1_NORMALIZE_OK devices=${normalized.devices.length} brands=${catalog.brand_count} specs=${normalizedSpecs.length}`);
