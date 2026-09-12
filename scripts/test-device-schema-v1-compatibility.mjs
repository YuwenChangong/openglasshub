import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
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

const SAFE_BARE_IMPORTS = new Set();

async function collectLocalModuleGraph(entryPath, seen = new Set()) {
  const resolvedEntry = path.resolve(entryPath);
  if (seen.has(resolvedEntry)) return seen;
  seen.add(resolvedEntry);
  const source = await readFile(resolvedEntry, "utf8");
  const specifiers = [
    ...source.matchAll(/\bimport\s*(?:[^"']*?\sfrom\s*)?["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);
  for (const specifier of specifiers) {
    if (!specifier.startsWith(".")) {
      if (!SAFE_BARE_IMPORTS.has(specifier)) throw new Error(`UNAPPROVED_ADAPTER_IMPORT: ${specifier}`);
      continue;
    }
    const candidate = path.resolve(path.dirname(resolvedEntry), specifier);
    const modulePath = path.extname(candidate) ? candidate : `${candidate}.mjs`;
    await collectLocalModuleGraph(modulePath, seen);
  }
  return seen;
}

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
assert.deepEqual(compatibility.key_specs, Object.entries(expectedFullSpecs)
  .flatMap(([group, fields]) => Object.entries(fields).map(([field, value]) => ({ field: `${group}.${field}`, label: field.split(".").at(-1).split("_").map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" "), value })))
  .slice(0, 5), "key_specs has a deterministic YAML-derived field, label, order, and value pairing");

const adapterPath = path.join(root, "scripts/devices/schema-v1/compatibility.mjs");
const adapterGraph = await collectLocalModuleGraph(adapterPath);
const bootstrapCatalogPath = path.join(root, "src/lib/device-catalog.ts");
assert.ok([...adapterGraph].every((modulePath) => modulePath.startsWith(path.join(root, "scripts/devices/schema-v1"))), "adapter dependency graph is limited to approved schema-v1 local modules");
assert.equal(adapterGraph.has(bootstrapCatalogPath), false, "adapter dependency graph must not reach src/lib/device-catalog.ts");
for (const modulePath of adapterGraph) {
  const source = await readFile(modulePath, "utf8");
  assert.doesNotMatch(source, /device-catalog(?:\.ts)?/, `${path.relative(root, modulePath)} must not reference the bootstrap catalog`);
  assert.doesNotMatch(source, /keySpecs|fullSpecs/, `${path.relative(root, modulePath)} must not read bootstrap keySpecs/fullSpecs fields`);
}

const graphFixtureDirectory = await mkdtemp(path.join(os.tmpdir(), "openglass-schema-v1-compatibility-"));
try {
  for (const [filename, specifier] of [["bare.mjs", "bootstrap-catalog"], ["alias.mjs", "@/lib/device-catalog"]]) {
    const fixturePath = path.join(graphFixtureDirectory, filename);
    await writeFile(fixturePath, `import ${JSON.stringify(specifier)};\n`, "utf8");
    await assert.rejects(() => collectLocalModuleGraph(fixturePath), new RegExp(`UNAPPROVED_ADAPTER_IMPORT: ${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
} finally {
  await rm(graphFixtureDirectory, { recursive: true, force: true });
}

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

const malformed = buildLegacyCompatibility({
  schemaType: "display_ar",
  identity: device.identity,
  specs: [
    { path: null, rawValue: "malformed", state: "KNOWN" },
    { path: "display.mode", rawValue: { twoD: 120 }, state: "KNOWN" },
    { path: "display.refresh_rate", rawValue: [120, 90], state: "KNOWN" },
    { path: "display.valid", rawValue: "safe", state: "KNOWN" },
  ],
  evidence: device.evidence,
});
assert.deepEqual(malformed, {
  key_specs: [{ field: "display.valid", label: "Valid", value: "safe" }],
  full_specs: { display: { valid: "safe" } },
  compatibilityGaps: [
    { code: "LEGACY_COMPAT_UNREPRESENTABLE_VALUE", path: null, state: "KNOWN", rawValue: "malformed" },
    { code: "LEGACY_COMPAT_UNREPRESENTABLE_VALUE", path: "display.mode", state: "KNOWN", rawValue: { twoD: 120 } },
    { code: "LEGACY_COMPAT_UNREPRESENTABLE_VALUE", path: "display.refresh_rate", state: "KNOWN", rawValue: [120, 90] },
  ],
  BOOTSTRAP_SPEC_VALUES_AUTHORITATIVE: false, LEGACY_COMPAT_SPEC_SOURCE: "YAML_DERIVED",
}, "invalid paths and object/array values are safely omitted with explicit compatibility gaps");

console.log(`DEVICE_SCHEMA_V1_COMPATIBILITY_OK devices=${normalized.devices.length} fullSpecs=${Object.keys(compatibility.full_specs).length} keySpecs=${compatibility.key_specs.length} gaps=${compatibility.compatibilityGaps.length}`);
