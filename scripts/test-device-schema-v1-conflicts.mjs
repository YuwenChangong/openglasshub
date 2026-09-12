import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadApprovedDeviceYaml } from "./devices/schema-v1/yaml-input.mjs";
import { normalizeCatalogYaml } from "./devices/schema-v1/normalize.mjs";
import { classifyConflicts, loadConflictMappings } from "./devices/schema-v1/conflicts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const yamlPath = path.join(root, "src/data/devices/openglasshub_device_data_v1.yaml");
const mapPath = path.join(root, "scripts/devices/schema-v1/conflict-map.json");
const normalized = normalizeCatalogYaml(await loadApprovedDeviceYaml(yamlPath));
const mappings = await loadConflictMappings(mapPath);
const classified = classifyConflicts({ normalized, mappings });

assert.deepEqual(classified.blockers, [
  {
    code: "BLOCKED_EVIDENCE_MAP",
    deviceKey: "VITURE|VITURE One|One",
    path: "evidence.conflicts",
    detail: "Recent VITURE Academy lists 50,000:1 contrast; older official/brand-hosted material has shown lower figures. Primary value set to the newer Academy value.",
    sourceUrls: [
      "https://academy.viture.com/th-th/xr_glasses/introduction",
      "https://academy.viture.com/xr_glasses/introduction",
      "https://www.viture.com/en-SG/developer/glasses-sdk/glasses",
    ],
  },
  {
    code: "BLOCKED_EVIDENCE_MAP",
    deviceKey: "VITURE|VITURE One Lite|One Lite",
    path: "evidence.conflicts",
    detail: "Recent VITURE Academy lists 76 g; an older official store listing has shown 78 g. Primary value set to 76 g.",
    sourceUrls: [
      "https://academy.viture.com/th-th/xr_glasses/introduction",
      "https://academy.viture.com/xr_glasses/introduction",
      "https://www.viture.com/en-SG/developer/glasses-sdk/glasses",
    ],
  },
  {
    code: "BLOCKED_EVIDENCE_MAP",
    deviceKey: "INMO|INMO Air 2|Air 2",
    path: "evidence.conflicts",
    detail: "Official FCC manual lists approximately 99 g; some third-party sources list 79 g. Primary value set to 99 g because the regulatory manual is authoritative.",
    sourceUrls: [
      "https://www.inmoxr.com/pages/inmo-air2",
      "https://fcc.report/FCC-ID/2A62QIMA02/6647192.pdf",
      "https://www.hkmu.edu.hk/st/computing/fyp/subtitle-glasses/",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC13367897/",
    ],
  },
], "same-field claims without an exact curated field/source association block while retaining device-level sources only");

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
const unclassifiedBlocker = classifyConflicts({ normalized: unclassified, mappings }).blockers.find((blocker) => blocker.detail === "Unreviewed prose must never become guessed evidence.");
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
assert.throws(() => classifyConflicts({ normalized, mappings: [{ ...rokidFixture, primaryClaim: { ...rokidFixture.primaryClaim, source: "https://us.shop.xreal.com/products/xreal-one" } }] }), /primaryClaim source is not a device-level source URL/, "unrelated primary source is rejected");
assert.throws(() => classifyConflicts({ normalized, mappings: [{ ...rokidFixture, conflictingClaims: [{ claim: "480×640", source: "https://us.shop.xreal.com/products/xreal-one" }] }] }), /conflicting claim 0 source is not a device-level source URL/, "unrelated conflicting source is rejected");
assert.throws(() => classifyConflicts({ normalized, mappings: [{ ...rokidFixture, conflictingClaims: [{ claim: "480×400", source: "https://global.rokid.com/pages/faq" }] }] }), /conflicting claim must differ from the primary claim/, "conflicting claims cannot repeat the primary claim");
assert.throws(() => classifyConflicts({ normalized, mappings: [{ ...rokidFixture, conflictingClaims: [
  { claim: "480×640", source: "https://global.rokid.com/pages/faq" },
  { claim: "480×640", source: "https://global.rokid.com/pages/faq" },
] }] }), /duplicate conflicting claim\/source mapping/, "duplicate conflicting claim/source mappings are rejected");

console.log(`DEVICE_SCHEMA_V1_CONFLICTS_OK mappings=${classified.mappings.length} blockers=${classified.blockers.length}`);
