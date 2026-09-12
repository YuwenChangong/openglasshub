import assert from "node:assert/strict";
import { buildDefinitionRegistry } from "./devices/schema-v1/definitions.mjs";

const normalized = {
  devices: [
    {
      schemaType: "display_ar",
      specs: [
        { path: "basic.brand", value: "Example" },
        { path: "basic.model", value: "One" },
        { path: "basic.release_date", value: "2026-01-01" },
        { path: "basic.weight_g", value: 72, valueType: "number", canonicalUnit: "g", comparisonMode: "lower" },
        { path: "display.eye_brightness", value: 700, valueType: "number", canonicalUnit: "nits", measurementContext: "eye_brightness", comparisonMode: "higher" },
        { path: "display.panel_or_projector_brightness", value: 4000, valueType: "number", canonicalUnit: "nits", measurementContext: "panel_or_projector_brightness", comparisonMode: "higher" },
        { path: "display.brightness", value: 999, valueType: "number", canonicalUnit: "nits" },
        { path: "tracking.native_3dof", value: true, valueType: "boolean", comparisonMode: "equal_only" },
        { path: "tracking.native_6dof", value: false, valueType: "boolean", comparisonMode: "equal_only" },
      ],
      evidence: {
        verified_at: "2026-09-05",
        region: "Global",
        overall_confidence: "HIGH",
        source_urls: ["https://example.com/one"],
        conflicts: ["not a definition"],
        notes: ["not a definition"],
      },
    },
    {
      schemaType: "ai_hud",
      specs: [
        { path: "tracking.accessory_3dof", value: true, valueType: "boolean", comparisonMode: "equal_only" },
        { path: "tracking.accessory_6dof", value: true, valueType: "boolean", comparisonMode: "equal_only" },
        { path: "display.eye_brightness", value: 600, valueType: "number", canonicalUnit: "nits", measurementContext: "eye_brightness", comparisonMode: "higher" },
      ],
      evidence: { source_urls: ["https://example.com/two"] },
    },
  ],
};

const before = structuredClone(normalized);
const definitions = buildDefinitionRegistry(normalized);
const keys = definitions.map((definition) => definition.key);

assert.deepEqual(normalized, before, "definition derivation must not mutate normalized input");
assert.deepEqual(keys, [...keys].sort(), "definition keys must have a stable lexical sort");
assert.deepEqual(
  keys,
  [
    "basic.weight_g",
    "display.eye_brightness",
    "display.panel_or_projector_brightness",
    "tracking.accessory_3dof",
    "tracking.accessory_6dof",
    "tracking.native_3dof",
    "tracking.native_6dof",
  ],
  "only YAML specification paths become definitions",
);
assert.ok(!keys.includes("display.brightness"), "generic brightness must never become a definition");
assert.ok(!keys.some((key) => key.startsWith("evidence.")), "evidence metadata must not become definitions");
assert.ok(!keys.includes("basic.brand") && !keys.includes("basic.model") && !keys.includes("basic.release_date"), "identity fields must not become definitions");

const eyeBrightness = definitions.find((definition) => definition.key === "display.eye_brightness");
const projectorBrightness = definitions.find((definition) => definition.key === "display.panel_or_projector_brightness");
assert.equal(eyeBrightness.measurementContext, "eye_brightness");
assert.equal(projectorBrightness.measurementContext, "panel_or_projector_brightness");
assert.notEqual(eyeBrightness.measurementContext, projectorBrightness.measurementContext);
assert.deepEqual(eyeBrightness.applicableSchemaTypes, ["ai_hud", "display_ar"]);

for (const key of ["tracking.native_3dof", "tracking.native_6dof", "tracking.accessory_3dof", "tracking.accessory_6dof"]) {
  assert.ok(keys.includes(key), `missing distinct tracking definition: ${key}`);
}

console.log(`DEVICE_SCHEMA_V1_DEFINITIONS_OK count=${definitions.length}`);
