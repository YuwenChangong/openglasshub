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

assert.deepEqual(classified.blockers, [], "every YAML conflict prose item has an explicit curated classification");

const rokid = classified.mappings.find((mapping) => mapping.deviceKey === "Rokid|Rokid Glasses|Rokid Glasses");
assert.deepEqual(rokid, {
  classification: "TRUE_VALUE_CONFLICT",
  deviceKey: "Rokid|Rokid Glasses|Rokid Glasses",
  canonicalKey: "display.resolution_per_eye",
  primaryClaim: "480×400",
  primarySource: "https://global.rokid.com/products/rokid-glasses",
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
assert.deepEqual(classifyConflicts({ normalized: unclassified, mappings }).blockers, [{
  code: "BLOCKED_EVIDENCE_MAP",
  deviceKey: "Rokid|Rokid Glasses|Rokid Glasses",
  path: "evidence.conflicts",
  detail: "Unreviewed prose must never become guessed evidence.",
}], "unclassified prose blocks rather than guessing a field-level mapping");

assert.throws(() => classifyConflicts({
  normalized,
  mappings: [{
    classification: "TRUE_VALUE_CONFLICT",
    deviceKey: "Rokid|Rokid Glasses|Rokid Glasses",
    conflict: "Curated fixture conflict.",
    canonicalKey: "display.resolution_per_eye",
    primaryClaim: "480×400",
    primarySource: "https://global.rokid.com/products/rokid-glasses",
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

console.log(`DEVICE_SCHEMA_V1_CONFLICTS_OK mappings=${classified.mappings.length} blockers=${classified.blockers.length}`);
