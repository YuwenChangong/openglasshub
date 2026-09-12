import assert from "node:assert/strict";

let buildNormalizedModel;
try {
  ({ buildNormalizedModel } = await import("./devices/schema-v1/model.mjs"));
} catch (error) {
  const blocker = new Error("MODEL_BUILDER_MISSING: buildNormalizedModel is not implemented");
  blocker.cause = error;
  throw blocker;
}

const sourceOne = "https://example.com/product";
const sourceTwo = "https://example.com/manual";
const normalized = {
  blockers: [{ code: "BLOCKED_CONFIDENCE_VALUE", deviceKey: "Example|Viewer|One", path: "evidence.overall_confidence", detail: "Uncertain" }],
  devices: [{
    schemaType: "display_ar",
    identity: { brand: "Example", model: "Viewer", generation: "One", deviceType: "Glasses", status: "Available" },
    specs: [
      { path: "basic.weight_g", rawValue: 72, state: "KNOWN", value: 72, valueType: "number" },
      { path: "display.refresh_rate", rawValue: "2D up to 120; 3D up to 90", state: "KNOWN", value: "2D up to 120; 3D up to 90", valueType: "text" },
    ],
    evidence: { region: "Global", confidence: "HIGH", verifiedAt: "2026-09-05", sourceUrls: [sourceOne, sourceTwo], conflicts: [], notes: [] },
  }],
};
const definitions = [
  { key: "basic.weight_g", valueType: "number", canonicalUnit: "g", measurementContext: "mass" },
  { key: "display.refresh_rate", valueType: "text", canonicalUnit: "Hz", measurementContext: "display_mode" },
];
const sourceMetadata = [
  { url: sourceOne, publisher: "Example", title: "Product", sourceType: "current_official_product_page", publishedAt: null, accessedAt: "2026-09-05", region: "Global" },
  { url: sourceTwo, publisher: "Example", title: "Manual", sourceType: "official_manual", publishedAt: null, accessedAt: "2026-09-05", region: "Global" },
];
const identityMappings = [{ yamlBrand: "Example", yamlModel: "Viewer", yamlGeneration: "One", slug: "example-viewer" }];
const conflicts = {
  mappings: [{
    classification: "TRUE_VALUE_CONFLICT",
    deviceKey: "Example|Viewer|One",
    canonicalKey: "basic.weight_g",
    primaryClaim: { claim: 72, source: sourceOne },
    conflictingClaims: [{ claim: 75, source: sourceTwo }],
  }],
  blockers: [{ code: "BLOCKED_EVIDENCE_MAP", deviceKey: "Example|Viewer|One", path: "evidence.conflicts", detail: "Unmapped prose", sourceUrls: [sourceOne, sourceTwo] }],
};

const model = buildNormalizedModel({ normalized, definitions, sourceMetadata, identityMappings, conflicts });

assert.deepEqual(model.definitions, definitions, "definition records preserve the reviewed registry");
assert.deepEqual(model.devices, [{
  slug: "example-viewer", brand: "Example", model: "Viewer", generation: "One", schemaType: "display_ar", deviceType: "Glasses", status: "Available",
}], "devices are resolved only through reviewed identity mappings");
assert.deepEqual(model.sources, sourceMetadata, "sources preserve reviewed source metadata without classification inference");
assert.deepEqual(model.sourceLinks, [
  { deviceSlug: "example-viewer", sourceUrl: sourceOne, isPrimary: false },
  { deviceSlug: "example-viewer", sourceUrl: sourceTwo, isPrimary: false },
], "device-level source links do not invent a primary source");

const weight = model.specs.find((spec) => spec.definitionKey === "basic.weight_g");
assert.deepEqual(weight, {
  deviceSlug: "example-viewer", definitionKey: "basic.weight_g", state: "CONFLICT",
  valueNumber: 72, valueBoolean: null, valueText: null, valueJson: null,
  canonicalUnit: "g", measurementContext: "mass", rawValue: 72,
  region: "Global", variant: "", confidence: "HIGH", verifiedAt: "2026-09-05",
}, "a curated true conflict preserves the safe primary typed value and scoped evidence metadata");

const refresh = model.specs.find((spec) => spec.definitionKey === "display.refresh_rate");
assert.deepEqual(refresh, {
  deviceSlug: "example-viewer", definitionKey: "display.refresh_rate", state: "KNOWN",
  valueNumber: null, valueBoolean: null, valueText: "2D up to 120; 3D up to 90", valueJson: null,
  canonicalUnit: "Hz", measurementContext: "display_mode", rawValue: "2D up to 120; 3D up to 90",
  region: "Global", variant: "", confidence: "HIGH", verifiedAt: "2026-09-05",
}, "multi-mode refresh preserves Task 6 raw/text output without an invented comparison number");
assert.equal(refresh.valueNumber, null, "multi-mode refresh cannot become an invented numeric winner");

assert.deepEqual(model.evidence, [
  { deviceSlug: "example-viewer", definitionKey: "basic.weight_g", sourceUrl: sourceOne, claimedValue: 72, isPrimary: true, isConflicting: false },
  { deviceSlug: "example-viewer", definitionKey: "basic.weight_g", sourceUrl: sourceTwo, claimedValue: 75, isPrimary: false, isConflicting: true },
], "curated true conflicts create only exact field-level evidence claims");
assert.deepEqual(model.blockers, [...normalized.blockers, ...conflicts.blockers], "upstream confidence and evidence-map blockers are propagated without suppression");

const unresolved = buildNormalizedModel({
  normalized,
  definitions,
  sourceMetadata,
  identityMappings: [{ yamlBrand: "Example", yamlModel: "Viewer", yamlGeneration: "One", blocker: { code: "RAY_BAN_IDENTITY_INDETERMINATE", detail: "Needs evidence" } }],
  conflicts,
});
assert.equal(unresolved.devices.length, 0, "an unresolved identity never creates a device record");
assert.deepEqual(unresolved.blockers.at(-1), {
  code: "RAY_BAN_IDENTITY_INDETERMINATE", deviceKey: "Example|Viewer|One", path: "identity", detail: "Needs evidence",
}, "an unresolved identity blocker is propagated without fabricating a mapping");

const missingSource = buildNormalizedModel({
  normalized,
  definitions,
  sourceMetadata: [sourceMetadata[1]],
  identityMappings,
  conflicts,
});
assert.deepEqual(missingSource.sourceLinks, [{ deviceSlug: "example-viewer", sourceUrl: sourceTwo, isPrimary: false }], "unreviewed URLs safely omit their dependent source links");
assert.deepEqual(missingSource.blockers.at(-1), {
  code: "BLOCKED_SOURCE_METADATA", deviceKey: "Example|Viewer|One", path: "evidence.source_urls", detail: sourceOne,
}, "an unreviewed source URL becomes a deterministic blocker instead of throwing");
assert.deepEqual(missingSource.evidence, [], "field-level evidence depending on an unreviewed source is safely omitted");

const rawOnlyConflict = buildNormalizedModel({
  normalized: {
    blockers: [],
    devices: [{
      schemaType: "display_ar",
      identity: normalized.devices[0].identity,
      specs: [{ path: "display.resolution_per_eye", rawValue: "480×400", state: "KNOWN" }],
      evidence: normalized.devices[0].evidence,
    }],
  },
  definitions: [{ key: "display.resolution_per_eye", valueType: "text", canonicalUnit: null, measurementContext: null }],
  sourceMetadata,
  identityMappings,
  conflicts: {
    mappings: [{
      classification: "TRUE_VALUE_CONFLICT", deviceKey: "Example|Viewer|One", canonicalKey: "display.resolution_per_eye",
      primaryClaim: { claim: "480×400", source: sourceOne }, conflictingClaims: [{ claim: "480×640", source: sourceTwo }],
    }],
    blockers: [],
  },
});
assert.deepEqual(rawOnlyConflict.specs, [{
  deviceSlug: "example-viewer", definitionKey: "display.resolution_per_eye", state: "CONFLICT",
  valueNumber: null, valueBoolean: null, valueText: null, valueJson: null,
  canonicalUnit: null, measurementContext: null, rawValue: "480×400",
  region: "Global", variant: "", confidence: "HIGH", verifiedAt: "2026-09-05",
}], "a conflict with no safely typed primary preserves raw display data and null typed fields");

console.log(`DEVICE_SCHEMA_V1_MODEL_OK definitions=${model.definitions.length} devices=${model.devices.length} specs=${model.specs.length} sources=${model.sources.length} sourceLinks=${model.sourceLinks.length} evidence=${model.evidence.length} blockers=${model.blockers.length}`);
