import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadApprovedDeviceYaml } from "./devices/schema-v1/yaml-input.mjs";
import { normalizeCatalogYaml } from "./devices/schema-v1/normalize.mjs";

let buildLegacyCompatibility;
try {
  ({ buildLegacyCompatibility } = await import("./devices/schema-v1/compatibility.mjs"));
} catch (error) {
  const blocker = new Error("COMPATIBILITY_ADAPTER_MISSING: buildLegacyCompatibility is not implemented");
  blocker.cause = error;
  throw blocker;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const yamlPath = path.join(root, "src/data/devices/openglasshub_device_data_v1.yaml");
const normalized = normalizeCatalogYaml(await loadApprovedDeviceYaml(yamlPath));
const device = normalized.devices.find((candidate) => candidate.identity.model === "XREAL One");
assert.ok(device, "representative normalized YAML device must exist");

const compatibility = buildLegacyCompatibility(device);
assert.equal(compatibility.BOOTSTRAP_SPEC_VALUES_AUTHORITATIVE, false, "bootstrap specification values are never authoritative");
assert.equal(compatibility.LEGACY_COMPAT_SPEC_SOURCE, "YAML_DERIVED", "legacy compatibility values come only from normalized YAML");

const representable = device.specs.filter((spec) => spec.state === "KNOWN" || spec.state === "CONFLICT");
const expectedFullSpecs = Object.fromEntries([...new Set(representable.map((spec) => spec.path.split(".")[0]))]
  .sort()
  .map((group) => [group, Object.fromEntries(representable
    .filter((spec) => spec.path.startsWith(`${group}.`))
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((spec) => [spec.path.slice(group.length + 1), String(spec.rawValue)]))]));
assert.deepEqual(compatibility.full_specs, expectedFullSpecs, "full_specs is a deterministic raw-value projection of normalized YAML");

const fullValues = Object.values(compatibility.full_specs).flatMap((group) => Object.values(group));
assert.ok(fullValues.every((value) => representable.some((spec) => String(spec.rawValue) === value)), "every compatibility value is present in normalized YAML");
assert.deepEqual(
  compatibility.compatibilityGaps,
  device.specs.filter((spec) => spec.state !== "KNOWN" && spec.state !== "CONFLICT").sort((left, right) => left.path.localeCompare(right.path)).map((spec) => ({
    code: "LEGACY_COMPAT_UNREPRESENTABLE_STATE", path: spec.path, state: spec.state, rawValue: spec.rawValue,
  })),
  "non-value YAML states are explicit safe compatibility gaps instead of fabricated strings",
);
assert.ok(compatibility.key_specs.length <= 5, "key_specs remains safe for the current five-item reader fallback");
assert.ok(compatibility.key_specs.every((item) => fullValues.includes(item.value)), "key_specs is selected only from the YAML-derived full_specs projection");

const adapterSource = await readFile(path.join(root, "scripts/devices/schema-v1/compatibility.mjs"), "utf8");
assert.doesNotMatch(adapterSource, /device-catalog(?:\.ts)?/, "compatibility adapter must not import or read the bootstrap catalog");
assert.doesNotMatch(adapterSource, /keySpecs|fullSpecs/, "compatibility adapter must not read bootstrap keySpecs/fullSpecs fields");

const unsafe = buildLegacyCompatibility({
  schemaType: "display_ar",
  identity: device.identity,
  specs: [{ path: "display.refresh_rate", rawValue: "Not disclosed", state: "NOT_DISCLOSED" }],
  evidence: device.evidence,
});
assert.deepEqual(unsafe, {
  key_specs: [], full_specs: {},
  compatibilityGaps: [{ code: "LEGACY_COMPAT_UNREPRESENTABLE_STATE", path: "display.refresh_rate", state: "NOT_DISCLOSED", rawValue: "Not disclosed" }],
  BOOTSTRAP_SPEC_VALUES_AUTHORITATIVE: false, LEGACY_COMPAT_SPEC_SOURCE: "YAML_DERIVED",
}, "a wholly unrepresentable device safely empties legacy fields without a bootstrap fallback");

console.log(`DEVICE_SCHEMA_V1_COMPATIBILITY_OK devices=${normalized.devices.length} fullSpecs=${Object.keys(compatibility.full_specs).length} keySpecs=${compatibility.key_specs.length} gaps=${compatibility.compatibilityGaps.length}`);
