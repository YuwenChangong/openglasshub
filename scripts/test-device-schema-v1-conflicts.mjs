import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadApprovedDeviceYaml } from "./devices/schema-v1/yaml-input.mjs";
import { normalizeCatalogYaml } from "./devices/schema-v1/normalize.mjs";
import { classifyConflicts, loadConflictMappings } from "./devices/schema-v1/conflicts.mjs";
import { loadSourceMetadata } from "./devices/schema-v1/sources.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const yamlPath = path.join(root, "src/data/devices/openglasshub_device_data_v1.yaml");
const mapPath = path.join(root, "scripts/devices/schema-v1/conflict-map.json");
const sourceMetadataPath = path.join(root, "scripts/devices/schema-v1/source-metadata.json");
const normalized = normalizeCatalogYaml(await loadApprovedDeviceYaml(yamlPath));
const mappings = await loadConflictMappings(mapPath);
const sourceMetadata = await loadSourceMetadata(sourceMetadataPath);
const classified = classifyConflicts({ normalized, mappings, reviewedEvidenceSourceUrls: sourceMetadata.map((source) => source.url) });

assert.deepEqual(classified.blockers, [], "every reviewed same-field claim has an exact curated field/source association");

const requiredEvidenceMaps = [
  {
    deviceKey: "VITURE|VITURE One|One",
    canonicalKey: "display.contrast_ratio",
    primaryClaim: { claim: "50,000:1", source: "https://academy.viture.com/xr_glasses/introduction" },
    conflictingClaims: [{ claim: "5,000:1", source: "https://shop.viture.com/ja-sg/blogs/news/mmorpgs-viture-one-dock-pack-review" }],
  },
  {
    deviceKey: "VITURE|VITURE One Lite|One Lite",
    canonicalKey: "basic.weight_g",
    primaryClaim: { claim: 76, source: "https://academy.viture.com/xr_glasses/introduction" },
    conflictingClaims: [{ claim: 78, source: "https://store.viture.com/products/lite-xr-glasses" }],
  },
  {
    deviceKey: "INMO|INMO Air 2|Air 2",
    canonicalKey: "basic.weight_g",
    primaryClaim: { claim: 99, rawClaim: "~99 g", source: "https://fcc.report/FCC-ID/2A62QIMA02/6647192.pdf" },
    conflictingClaims: [{ claim: 79, source: "https://www.paoka.com/product/INMO-Air2" }],
  },
];
for (const expected of requiredEvidenceMaps) {
  const mapping = classified.mappings.find((candidate) => candidate.deviceKey === expected.deviceKey && candidate.canonicalKey === expected.canonicalKey);
  assert.deepEqual(mapping, { classification: "TRUE_VALUE_CONFLICT", ...expected }, `${expected.deviceKey} has reviewed primary and conflicting field evidence`);
}

const rokid = classified.mappings.find((mapping) => mapping.deviceKey === "Rokid|Rokid Glasses|Rokid Glasses");
assert.deepEqual(rokid, {
  classification: "TRUE_VALUE_CONFLICT",
  deviceKey: "Rokid|Rokid Glasses|Rokid Glasses",
  canonicalKey: "display.resolution_per_eye",
  primaryClaim: {
    claim: "480×400",
    source: "https://global.rokid.com/products/rokid-glasses",
  },
  conflictingClaims: [
    {
      claim: "480×640",
      source: "https://global.rokid.com/blogs/academy-glasses/glasses-1-1-overview",
    },
    {
      claim: "480×640",
      source: "https://global.rokid.com/pages/faq",
    },
  ],
}, "Rokid competing resolution claims preserve canonical key and exact curated field-level sources");

const brightness = classified.mappings.find((mapping) => mapping.deviceKey === "RayNeo|RayNeo Air 2|Air 2");
assert.deepEqual(brightness, {
  classification: "NORMALIZATION_OR_CONTEXT_NOTE",
  deviceKey: "RayNeo|RayNeo Air 2|Air 2",
}, "eye brightness and panel brightness remain separate context notes, not conflicting field evidence");

const unclassified = structuredClone(normalized);
unclassified.devices.find((device) => device.identity.model === "Rokid Glasses").evidence.conflicts.push("Unreviewed prose must never become guessed evidence.");
const unclassifiedBlocker = classifyConflicts({ normalized: unclassified, mappings, reviewedEvidenceSourceUrls: sourceMetadata.map((source) => source.url) }).blockers.find((blocker) => blocker.detail === "Unreviewed prose must never become guessed evidence.");
assert.deepEqual(unclassifiedBlocker, {
  code: "BLOCKED_EVIDENCE_MAP",
  deviceKey: "Rokid|Rokid Glasses|Rokid Glasses",
  path: "evidence.conflicts",
  detail: "Unreviewed prose must never become guessed evidence.",
  sourceUrls: [
    "https://global.rokid.com/products/rokid-glasses",
    "https://global.rokid.com/blogs/academy-glasses/glasses-1-1-overview",
    "https://global.rokid.com/pages/faq",
  ],
}, "unclassified prose blocks rather than guessing a field-level mapping");

assert.throws(() => classifyConflicts({
  normalized,
  mappings: [{
    classification: "TRUE_VALUE_CONFLICT",
    deviceKey: "Rokid|Rokid Glasses|Rokid Glasses",
    conflict: "Curated fixture conflict.",
    canonicalKey: "display.resolution_per_eye",
    primaryClaim: { claim: "480×400", source: "https://global.rokid.com/products/rokid-glasses" },
    conflictingClaims: [],
  }],
}), /TRUE_VALUE_CONFLICT requires exact conflicting claim\/source data/, "true conflicts cannot omit exact conflicting claim/source data");

assert.throws(() => classifyConflicts({
  normalized,
  mappings: [{
    classification: "NORMALIZATION_OR_CONTEXT_NOTE",
    deviceKey: "RayNeo|RayNeo Air 2|Air 2",
    conflict: "Curated fixture note.",
    canonicalKey: "display.eye_brightness",
  }],
}), /NORMALIZATION_OR_CONTEXT_NOTE cannot carry field-level claim data/, "normalization notes cannot fabricate field-level evidence");

const rokidFixture = {
  classification: "TRUE_VALUE_CONFLICT",
  deviceKey: "Rokid|Rokid Glasses|Rokid Glasses",
  conflict: "Curated fixture conflict.",
  canonicalKey: "display.resolution_per_eye",
  primaryClaim: { claim: "480×400", source: "https://global.rokid.com/products/rokid-glasses" },
  conflictingClaims: [{ claim: "480×640", source: "https://global.rokid.com/pages/faq" }],
};
assert.throws(() => classifyConflicts({ normalized, mappings: [{ ...rokidFixture, canonicalKey: "display.not_a_key" }] }), /canonicalKey is not a normalized device spec/, "invalid canonical keys are rejected");
assert.throws(() => classifyConflicts({ normalized, mappings: [{ ...rokidFixture, primaryClaim: { ...rokidFixture.primaryClaim, claim: "480×640" } }] }), /primaryClaim must exactly match the normalized primary raw value/, "primary claim must match the canonical primary raw value");
assert.throws(() => classifyConflicts({ normalized, mappings: [{ ...rokidFixture, primaryClaim: { ...rokidFixture.primaryClaim, source: "https://us.shop.xreal.com/products/xreal-one" } }] }), /primaryClaim source is not a reviewed device or evidence-only source URL/, "unrelated primary source is rejected");
assert.throws(() => classifyConflicts({ normalized, mappings: [{ ...rokidFixture, conflictingClaims: [{ claim: "480×640", source: "https://us.shop.xreal.com/products/xreal-one" }] }] }), /conflicting claim 0 source is not a reviewed device or evidence-only source URL/, "unrelated conflicting source is rejected");
assert.throws(() => classifyConflicts({ normalized, mappings: [{ ...rokidFixture, conflictingClaims: [{ claim: "480×400", source: "https://global.rokid.com/pages/faq" }] }] }), /conflicting claim must differ from the primary claim/, "conflicting claims cannot repeat the primary claim");
assert.throws(() => classifyConflicts({ normalized, mappings: [{ ...rokidFixture, conflictingClaims: [
  { claim: "480×640", source: "https://global.rokid.com/pages/faq" },
  { claim: "480×640", source: "https://global.rokid.com/pages/faq" },
] }] }), /duplicate conflicting claim\/source mapping/, "duplicate conflicting claim/source mappings are rejected");

console.log(`DEVICE_SCHEMA_V1_CONFLICTS_OK mappings=${classified.mappings.length} blockers=${classified.blockers.length}`);
