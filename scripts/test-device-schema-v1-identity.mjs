import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadApprovedDeviceYaml } from "./devices/schema-v1/yaml-input.mjs";
import { buildDeviceRows } from "./migrate-static-device-catalog-to-supabase.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const yamlPath = path.join(root, "src/data/devices/openglasshub_device_data_v1.yaml");
const mapPath = path.join(root, "scripts/devices/schema-v1/identity-map.json");

let resolveIdentityMappings;
try {
  ({ resolveIdentityMappings } = await import("./devices/schema-v1/identity.mjs"));
} catch (error) {
  const blocker = new Error("RAY_BAN_IDENTITY_INDETERMINATE: identity resolver is not implemented");
  blocker.cause = error;
  throw blocker;
}

const yaml = await loadApprovedDeviceYaml(yamlPath);
const bootstrapRows = await buildDeviceRows();
const mappings = JSON.parse(await readFile(mapPath, "utf8")).mappings;
const resolved = resolveIdentityMappings({ yamlDevices: yaml.devices, bootstrapRows, mappings });

const expectedMappings = [
  ["XREAL", "XREAL One", "One series", "xreal-one"],
  ["XREAL", "XREAL One Pro", "One Pro", "xreal-one-pro"],
  ["XREAL", "XREAL Air 2 Pro", "Air 2 series", "xreal-air-2-pro"],
  ["XREAL", "XREAL Air 2 Ultra", "Air 2 Ultra", "xreal-air-2-ultra"],
  ["XREAL", "XREAL Air", "Original Air", "xreal-air"],
  ["XREAL", "XREAL Air 2", "Air 2 series", "xreal-air-2"],
  ["RayNeo", "RayNeo X2", "X2", "rayneo-x2"],
  ["RayNeo", "RayNeo Air 2", "Air 2", "rayneo-air-2"],
  ["RayNeo", "RayNeo Air 2s", "Air 2s", "rayneo-air-2s"],
  ["RayNeo", "RayNeo Air 3s", "Air 3s", "rayneo-air-3s"],
  ["RayNeo", "RayNeo Air 4 Pro", "Air 4 Pro", "rayneo-air-4-pro"],
  ["RayNeo", "RayNeo X3 Pro", "X3 Pro", "rayneo-x3-pro"],
  ["Rokid", "Rokid Max", "Max", "rokid-max"],
  ["Rokid", "Rokid Air", "Air", "rokid-air"],
  ["Rokid", "Rokid AR Lite", "AR Lite bundle", "rokid-ar-lite"],
  ["Rokid", "Rokid Glasses", "Rokid Glasses", "rokid-glasses"],
  ["VITURE", "VITURE Pro", "Pro", "viture-pro"],
  ["VITURE", "VITURE One", "One", "viture-one"],
  ["VITURE", "VITURE One Lite", "One Lite", "viture-one-lite"],
  ["INMO", "INMO Air 2", "Air 2", "inmo-air-2"],
  ["INMO", "INMO GO3", "GO3", "inmo-go3"],
  ["Brilliant Labs", "Frame", "Frame", "brilliant-labs-frame"],
  ["Even Realities", "G1", "G1", "even-realities-g1"],
].map(([yamlBrand, yamlModel, yamlGeneration, slug]) => ({ yamlBrand, yamlModel, yamlGeneration, slug }));

assert.equal(mappings.length, 23, "the reviewed initial map contains exactly 23 entries");
assert.deepEqual(mappings, expectedMappings, "the reviewed initial map itself is the exact approved 23-entry map and excludes Ray-Ban");
assert.deepEqual(resolved.filter((mapping) => mapping.slug), expectedMappings, "the reviewed map resolves exactly the approved 23 YAML identities to unique bootstrap slugs");
assert.equal(new Set(resolved.filter((mapping) => mapping.slug).map((mapping) => mapping.slug)).size, 23, "approved target slugs stay unique");

assert.throws(() => resolveIdentityMappings({
  yamlDevices: yaml.devices,
  bootstrapRows,
  mappings: [...mappings, { yamlBrand: "Unapproved", yamlModel: "Device", yamlGeneration: "1", slug: "xreal-one" }],
}), /Reviewed identity map contains an unmapped identity/, "an extra reviewed entry is rejected instead of being silently unused");

const rayBan = resolved.find((mapping) => mapping.yamlBrand === "Ray-Ban / Meta");
assert.deepEqual(rayBan, {
  yamlBrand: "Ray-Ban / Meta",
  yamlModel: "Ray-Ban Meta",
  yamlGeneration: "Gen 2",
  blocker: {
    code: "RAY_BAN_IDENTITY_INDETERMINATE",
    detail: "CURRENT_RAY_BAN_BOOTSTRAP_SLUG=ray-ban-meta; CURRENT_RAY_BAN_BOOTSTRAP_GENERATION=UNSPECIFIED; CURRENT_RAY_BAN_BOOTSTRAP_IDENTITY_CONFIDENCE=INSUFFICIENT_FOR_GEN_2",
  },
}, "Ray-Ban Gen 2 remains a Release B blocker without administrator-approved identity evidence");

for (const generation of ["Generic", "Gen 1"]) {
  const rayBanMismatch = resolveIdentityMappings({
    yamlDevices: yaml.devices,
    bootstrapRows: bootstrapRows.map((row) => row.slug === "ray-ban-meta" ? { ...row, generation } : row),
    mappings,
  }).find((mapping) => mapping.yamlBrand === "Ray-Ban / Meta");
  assert.equal(rayBanMismatch?.blocker?.code, "BLOCKED_IDENTITY_MISMATCH", `explicit ${generation} ray-ban-meta evidence cannot be updated as Gen 2`);
}

const firstMapping = mappings[0];
const zeroMatch = resolveIdentityMappings({
  yamlDevices: yaml.devices,
  bootstrapRows: bootstrapRows.filter((row) => row.slug !== firstMapping.slug),
  mappings,
});
assert.equal(zeroMatch.find((mapping) => mapping.slug === firstMapping.slug)?.blocker?.code, "BLOCKED_IDENTITY_NOT_FOUND", "a reviewed target absent from bootstrap blocks instead of finding a similar row");

const multipleMatches = resolveIdentityMappings({
  yamlDevices: yaml.devices,
  bootstrapRows: [...bootstrapRows, { ...bootstrapRows.find((row) => row.slug === firstMapping.slug) }],
  mappings,
});
assert.equal(multipleMatches.find((mapping) => mapping.slug === firstMapping.slug)?.blocker?.code, "BLOCKED_IDENTITY_MULTIPLE_MATCHES", "multiple bootstrap rows for a target slug block resolution");

const generationMismatch = resolveIdentityMappings({
  yamlDevices: yaml.devices,
  bootstrapRows,
  mappings: mappings.map((mapping, index) => index === 0 ? { ...mapping, yamlGeneration: "Different generation" } : mapping),
});
assert.equal(generationMismatch.find((mapping) => mapping.yamlModel === "XREAL One")?.blocker?.code, "BLOCKED_IDENTITY_MISMATCH", "a reviewed entry with a changed generation never resolves to the prior identity");

const duplicateSlug = resolveIdentityMappings({
  yamlDevices: yaml.devices,
  bootstrapRows,
  mappings: [...mappings, { ...mappings[0], yamlModel: "XREAL One Pro", yamlGeneration: "One Pro" }],
});
assert.equal(duplicateSlug.find((mapping) => mapping.yamlModel === "XREAL One")?.blocker?.code, "BLOCKED_DUPLICATE_TARGET_SLUG", "one bootstrap slug cannot stand for two YAML identities");

const whitespaceAndCase = resolveIdentityMappings({
  yamlDevices: yaml.devices,
  bootstrapRows,
  mappings: mappings.map((mapping, index) => index === 0 ? { ...mapping, yamlBrand: "  xreal ", yamlModel: " XREAL   ONE ", yamlGeneration: " one SERIES " } : mapping),
});
assert.equal(whitespaceAndCase.find((mapping) => mapping.yamlModel === "XREAL One")?.slug, "xreal-one", "approved casing and whitespace normalization preserves an exact reviewed mapping");

assert.throws(() => resolveIdentityMappings({
  yamlDevices: yaml.devices,
  bootstrapRows,
  mappings: mappings.map((mapping, index) => index === 0 ? { ...mapping, yamlModel: "XREAL Ones" } : mapping),
}), /Reviewed identity map contains an unmapped identity/, "a near name is rejected rather than fuzzy matched");

console.log(`DEVICE_SCHEMA_V1_IDENTITY_OK mappings=${resolved.filter((mapping) => mapping.slug).length} blockers=${resolved.filter((mapping) => mapping.blocker).length} releaseB=BLOCKED`);
