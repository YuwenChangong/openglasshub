import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseDocument } from "yaml";
import { enumerateSourceParameters, compareSourceStages, requireResolvedIdentities, buildRepositoryInventory, serializeInventory } from "./lib/product-detail-repository-inventory.mjs";

const yamlPath = new URL("../src/data/devices/openglasshub_device_data_v1.yaml", import.meta.url);
const catalog = parseDocument(await readFile(yamlPath, "utf8"), { uniqueKeys: true }).toJS();
const identityFields = new Set(["brand", "model", "generation", "device_type", "status", "release_date"]);
const expectedPointers = catalog.devices.flatMap((device, index) => Object.entries(device)
  .filter(([section]) => section !== "schema_type" && section !== "evidence")
  .flatMap(([section, fields]) => Object.keys(fields)
    .filter((field) => section !== "basic" || !identityFields.has(field))
    .map((field) => `/devices/${index}/${section}/${field}`)));
assert.ok(expectedPointers.length > 0);
test("DATA_SURVIVAL_ORACLE_COVERS_ALL_SOURCE_FIELDS", () => {
  assert.deepEqual(enumerateSourceParameters(catalog).map((entry) => entry.pointer).sort(), expectedPointers.sort());
});

test("oracle retains false/zero/long text and unknown states independently of normalization", () => {
  const input = { devices: [{ schema_type: "display_ar", basic: { brand: "Probe", model: "Probe", generation: "Probe", zero: 0, no: false },
    display_optics: { eye_brightness_nits: "probe", panel_or_projector_brightness_nits: "probe" },
    other: { long: "probe".repeat(30), undisclosed: "Not disclosed", inapplicable: "Not applicable" },
    evidence: { notes: ["internal"], source_urls: [] } }] };
  const entries = enumerateSourceParameters(input);
  assert.equal(entries.length, 7);
  assert.equal(entries.find((entry) => entry.sourceField === "basic.zero").value, 0);
  assert.equal(entries.find((entry) => entry.sourceField === "basic.no").value, false);
  assert.equal(entries.filter((entry) => entry.state === "KNOWN").length, 5);
  assert.ok(entries.every((entry) => !entry.sourceField.startsWith("evidence.")));
  assert.equal(entries.find((entry) => entry.sourceField === "display_optics.eye_brightness_nits").canonicalPath, "display.eye_brightness");
  assert.equal(entries.find((entry) => entry.sourceField === "display_optics.panel_or_projector_brightness_nits").canonicalPath, "display.panel_or_projector_brightness");
});

test("omission detector reports earliest stage and cannot use later recovery to hide loss", () => {
  const source = [{ pointer: "/probe", value: false }];
  const result = compareSourceStages(source, [
    { layer: "PARSER_DROPPED", read: () => false },
    { layer: "NORMALIZER_DROPPED", read: () => undefined },
    { layer: "PUBLIC_READER_DROPPED", read: () => false },
  ]);
  assert.equal(result[0].firstLossLayer, "NORMALIZER_DROPPED");
  assert.equal(result[0].observed[2].matches, true);
  assert.equal(compareSourceStages(source, [{ layer: "PARSER_DROPPED", read: () => "false" }])[0].firstLossLayer, "PARSER_DROPPED");
});

test("missing source is a blocker, never a fabricated or empty success", async () => {
  assert.throws(() => enumerateSourceParameters({ devices: [] }), /SOURCE_MISSING/);
  const root = await mkdtemp(path.join(tmpdir(), "product-detail-forensic-empty-"));
  try { await assert.rejects(buildRepositoryInventory({ root }), /SOURCE_MISSING:src\/data\/devices\/openglasshub_device_data_v1.yaml/); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("identity ambiguity stops deterministically without inventing a slug", () => {
  const device = { basic: { brand: "Probe", model: "Probe", generation: "One" } };
  const mapping = { yamlBrand: "Probe", yamlModel: "Probe", yamlGeneration: "One", slug: "probe" };
  assert.throws(() => requireResolvedIdentities({ yamlDevices: [device], bootstrapRows: [{ slug: "probe" }], mappings: [] }), /IDENTITY_MAPPING_MISSING/);
  assert.throws(() => requireResolvedIdentities({ yamlDevices: [device], bootstrapRows: [{ slug: "probe" }], mappings: [mapping, mapping] }), /IDENTITY_MAPPING_MISSING/);
});

let inventory;
test("real repository forensic is deterministic, offline and covers every reviewed identity", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("TASK_1_NETWORK_FORBIDDEN"); };
  try {
    inventory = await buildRepositoryInventory();
    assert.equal(serializeInventory(inventory), serializeInventory(await buildRepositoryInventory()));
  } finally { globalThis.fetch = previousFetch; }
  const expectedSlugs = JSON.parse(await readFile(new URL("./devices/schema-v1/identity-map.json", import.meta.url), "utf8")).mappings.map((entry) => entry.slug).sort();
  assert.deepEqual(inventory.summary.DEVICE_IDENTITIES_FOUND, expectedSlugs);
  assert.equal(inventory.summary.DEVICE_IDENTITY_COUNT, catalog.devices.length);
  assert.equal(new Set(inventory.identities.map((entry) => entry.slug)).size, catalog.devices.length);
  assert.equal(inventory.parameterLedger.length, expectedPointers.length);
  assert.ok(inventory.sourceHashes.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
});

test("authoritative raw oracle vs actual parser/normalizer/model/compatibility/public mapper", () => {
  const independentlyKnown = catalog.devices.reduce((count, device) => count + Object.entries(device)
    .filter(([section]) => section !== "schema_type" && section !== "evidence")
    .reduce((sum, [section, fields]) => sum + Object.entries(fields)
      .filter(([field, value]) => (section !== "basic" || !identityFields.has(field)) && value !== "Not disclosed" && value !== "Not applicable").length, 0), 0);
  const s = inventory.summary;
  assert.equal(s.KNOWN_SOURCE_PARAMETER_COUNT, independentlyKnown);
  for (const field of ["PARAMETERS_SURVIVING_PARSER_COUNT", "PARAMETERS_SURVIVING_NORMALIZER_COUNT", "PARAMETERS_SURVIVING_TYPED_MODEL_COUNT", "PARAMETERS_SURVIVING_CURRENT_PUBLIC_MAPPER_COUNT"]) {
    assert.equal(s[field], independentlyKnown, field);
  }
  assert.equal(s.KNOWN_SOURCE_VALUE_DROPPED_COUNT, 0);
  assert.ok(inventory.parameterLedger.every((entry) => entry.typedValuePreserved));
  const missing = inventory.parameterLedger.find((entry) => entry.state === "KNOWN");
  const tampered = compareSourceStages([missing], [{ layer: "PUBLIC_READER_DROPPED", read: () => undefined }]);
  assert.equal(tampered[0].firstLossLayer, "PUBLIC_READER_DROPPED");
});

test("non-known compatibility omissions and intentional internal exclusions are separate", () => {
  const nonKnown = inventory.parameterLedger.filter((entry) => entry.state !== "KNOWN");
  assert.equal(inventory.summary.COMPATIBILITY_NON_KNOWN_STATE_OMISSION_COUNT, nonKnown.length);
  assert.ok(nonKnown.every((entry) => entry.observed.slice(0, 3).every((stage) => stage.matches)));
  assert.ok(inventory.identities.every((entry) => !Object.hasOwn(entry.evidence, "notes") || entry.evidence.notes === undefined));
  assert.ok(inventory.pipeline.privateInternalExclusions.includes("evidence.notes"));
  assert.equal(inventory.summary.KNOWN_SOURCE_VALUE_DROPPED_COUNT, 0);
});

test("legacy manifest mismatches expose their exact source pointers without becoming YAML loss", () => {
  const manifest = inventory.legacyInventory.manifestProducts;
  const expectedLegacyCount = manifest.reduce((count, product) => count + Object.values(product.publicData.fullSpecs ?? {})
    .reduce((sum, group) => sum + Object.keys(group).length, 0), 0);
  assert.equal(inventory.legacyLedger.length, expectedLegacyCount);
  assert.ok(inventory.legacyLedger.some((entry) => entry.firstUnavailableLayer === "LEGACY_BOOTSTRAP_PROJECTION"));
  assert.ok(inventory.legacyLedger.every((entry) => entry.pointer.startsWith("/products/") && entry.authoritative === false));
  assert.equal(inventory.summary.LEGACY_MANIFEST_FIELDS_NOT_EXACTLY_IN_BOOTSTRAP_COUNT,
    inventory.legacyLedger.filter((entry) => !entry.bootstrapExact).length);
  assert.equal(inventory.summary.LEGACY_MANIFEST_FIELDS_DROPPED_BY_PUBLIC_MAPPER_COUNT, 0);
  assert.equal(inventory.summary.KNOWN_SOURCE_VALUE_DROPPED_COUNT, 0);
});

test("typed mapper limitation is characterized, not mislabeled as real YAML loss", () => {
  assert.deepEqual(inventory.summary.TYPED_MAPPER_PROBE, {
    evidenceClass: "SYNTHETIC_CAPABILITY_ONLY_NOT_OBSERVED_YAML_LOSS", zeroRetained: false, falseRetained: false, numberRetained: false, textRetained: true,
  });
  assert.equal(inventory.summary.PUBLIC_MAPPER_DROPS_VALUES, false);
  assert.equal(inventory.summary.MAPPER_EVIDENCE_SCOPE, "OFFLINE_YAML_DERIVED_COMPATIBILITY_INPUT_NOT_DEPLOYED_DATA_OR_RLS");
});

test("actual source route is disconnected, not an invented parser or missing-dataset cause", () => {
  assert.equal(inventory.summary.CANONICAL_DETAIL_ROUTE_EXISTS, false);
  assert.equal(inventory.summary.LEGACY_DEVICE_ROUTE, "301_TO_BRAND_ANCHOR");
  assert.equal(inventory.summary.FIRST_DATA_LOSS_LAYER, "ROUTE_DISCONNECTED");
  assert.equal(inventory.summary.ROOT_CAUSE_CLASSIFICATION, "ROUTE_DISCONNECTED");
  assert.equal(inventory.summary.DATASET_MISSING, false);
  assert.equal(inventory.summary.IDENTITY_MAPPING_MISSING, false);
});

test("repository cohort is not Production publication or an applied import/RLS acceptance", () => {
  assert.equal(inventory.summary.PRODUCTION_PUBLICATION_STATE, "UNKNOWN");
  assert.equal(inventory.summary.PUBLISHED_DEVICE_COUNT, "UNKNOWN");
  assert.equal(inventory.pipeline.dataImportApplied, false);
  assert.equal(inventory.pipeline.runtimeDataState, "UNKNOWN");
  assert.deepEqual(inventory.pipeline.tablesObservedInMapperQuery, ["devices"]);
  assert.equal(inventory.pipeline.normalizedTablesReadByCurrentMapper, false);
});
