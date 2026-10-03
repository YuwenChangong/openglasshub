import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { parseDocument } from "yaml";
import { loadApprovedDeviceYaml } from "../devices/schema-v1/yaml-input.mjs";
import { normalizeCatalogYaml } from "../devices/schema-v1/normalize.mjs";
import { resolveIdentityMappings } from "../devices/schema-v1/identity.mjs";
import { buildDefinitionRegistry } from "../devices/schema-v1/definitions.mjs";
import { buildNormalizedModel } from "../devices/schema-v1/model.mjs";
import { buildLegacyCompatibility } from "../devices/schema-v1/compatibility.mjs";
import { classifyConflicts, loadConflictMappings } from "../devices/schema-v1/conflicts.mjs";
import { loadSourceMetadata, validateSourceMetadata } from "../devices/schema-v1/sources.mjs";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const artifactDirectory = "artifacts/qa/product-detail-task-1";
const planCommit = "dae4694369c65645c3b4d15e0c81042b94449687";
const yamlPath = "src/data/devices/openglasshub_device_data_v1.yaml";
const schemaRoot = "scripts/devices/schema-v1";
const identityFields = new Set(["brand", "model", "generation", "device_type", "status", "release_date"]);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const copy = (value) => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const pointerKey = (key) => key.replaceAll("~", "~0").replaceAll("/", "~1");
const keyOf = (basic) => `${basic.brand}|${basic.model}|${basic.generation}`;

function canonicalPath(section, field) {
  if (section !== "display_optics") return `${section}.${field}`;
  const renamed = { eye_brightness_nits: "eye_brightness", panel_or_projector_brightness_nits: "panel_or_projector_brightness" };
  return `display.${renamed[field] ?? field}`;
}

// This oracle walks original YAML leaves, never normalizer/model output.
export function enumerateSourceParameters(catalog) {
  if (!Array.isArray(catalog?.devices) || !catalog.devices.length) throw new Error("SOURCE_MISSING:devices");
  return catalog.devices.flatMap((device, index) => Object.entries(device)
    .filter(([section]) => section !== "schema_type" && section !== "evidence")
    .flatMap(([section, fields]) => Object.entries(fields)
      .filter(([field]) => section !== "basic" || !identityFields.has(field))
      .map(([field, value]) => ({
        deviceIndex: index, deviceKey: keyOf(device.basic),
        pointer: `/devices/${index}/${pointerKey(section)}/${pointerKey(field)}`,
        sourcePath: yamlPath, sourceField: `${section}.${field}`, canonicalPath: canonicalPath(section, field),
        value, valueType: typeof value,
        state: value === "Not disclosed" ? "NOT_DISCLOSED" : value === "Not applicable" ? "NOT_APPLICABLE" : "KNOWN",
      }))));
}

function atPointer(value, pointer) {
  return pointer.split("/").slice(1).reduce((current, key) => current?.[key.replaceAll("~1", "/").replaceAll("~0", "~")], value);
}

export function compareSourceStages(source, stages) {
  return source.map((entry) => {
    const observed = stages.map(({ layer, read }) => ({ layer, matches: equal(read(entry), entry.value) }));
    return { ...entry, observed, firstLossLayer: observed.find((item) => !item.matches)?.layer ?? null };
  });
}

export function requireResolvedIdentities(input) {
  const identities = resolveIdentityMappings(input);
  const unresolved = identities.filter((entry) => entry.blocker);
  if (unresolved.length || new Set(identities.map((entry) => entry.slug)).size !== identities.length) {
    throw new Error(`IDENTITY_MAPPING_MISSING:${schemaRoot}/identity-map.json:${unresolved[0]?.blocker.code ?? "DUPLICATE_IDENTITY"}`);
  }
  return identities;
}

function modelPreservesValue(model, slug, entry) {
  const spec = model.specs.find((spec) => spec.deviceSlug === slug && spec.definitionKey === entry.canonicalPath);
  if (!equal(spec?.rawValue, entry.value)) return false;
  if (entry.state !== "KNOWN") return true;
  const expected = entry.value === "Yes" ? true : entry.value === "No" ? false : entry.value;
  return [spec.valueNumber, spec.valueBoolean, spec.valueText, spec.valueJson].some((value) => value !== null && equal(value, expected));
}

function sandboxModule(source, filename, allowedModules = {}) {
  const compiled = ts.transpileModule(source, {
    fileName: filename.replace(/\.mjs$/, ".ts"), reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  if (compiled.diagnostics?.some((item) => item.category === ts.DiagnosticCategory.Error)) throw new Error(`SOURCE_COMPILE_FAILED:${filename}`);
  const module = { exports: {} };
  runInNewContext(compiled.outputText, {
    module, exports: module.exports, URL,
    require(name) {
      if (!Object.hasOwn(allowedModules, name)) throw new Error(`OFFLINE_IMPORT_DENIED:${filename}`);
      return allowedModules[name];
    },
  }, { filename, timeout: 10000, contextCodeGeneration: { strings: false, wasm: false } });
  return module.exports;
}

function selectedDeclarations(source, filename, names) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const found = new Map();
  for (const statement of ast.statements) {
    if (ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text)) found.set(statement.name.text, statement.getText(ast));
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)) {
          found.set(declaration.name.text, `const ${declaration.getText(ast)};`);
        }
      }
    }
  }
  if (found.size !== names.length) throw new Error(`SOURCE_CONTRACT_CHANGED:${filename}`);
  return names.map((name) => found.get(name)).join("\n") + `\nexport { ${names.join(", ")} };`;
}

function flattenSpecs(value) {
  return Object.entries(value ?? {}).flatMap(([group, fields]) => Object.entries(fields ?? {})
    .map(([field, value]) => ({ path: `${group}.${field}`, value })));
}

function publicSpecMap(device) {
  return new Map((device?.specGroups ?? []).flatMap((group) => group.items.map((item) => [`${group.key}.${item.field}`, item.value])));
}

// A query-shape double only: no SDK/client construction, DB, Auth, HTTP or RLS claim.
async function projectRows(mapper, rows) {
  const calls = [];
  const client = { from(table) {
    calls.push({ table, columns: null, filters: [] });
    const call = calls.at(-1);
    const query = {
      select(columns) { call.columns = columns; return query; },
      eq(key, value) { call.filters.push([key, value]); return query; },
      order(key, options) { call.order = { key, options }; return Promise.resolve({ data: rows, error: null }); },
    };
    return query;
  } };
  const devices = await mapper.listPublishedDevices(client);
  if (calls.length !== 1 || calls[0].table !== "devices" || !equal(calls[0].filters, [["publication_status", "published"]])) {
    throw new Error("PUBLIC_READER_CONTRACT_CHANGED");
  }
  return { devices: copy(devices), calls: copy(calls) };
}

async function readRepositoryInputs(root) {
  const paths = [yamlPath, `${schemaRoot}/identity-map.json`, `${schemaRoot}/source-metadata.json`, `${schemaRoot}/conflict-map.json`,
    `${schemaRoot}/yaml-input.mjs`, `${schemaRoot}/normalize.mjs`, `${schemaRoot}/identity.mjs`, `${schemaRoot}/definitions.mjs`,
    `${schemaRoot}/sources.mjs`, `${schemaRoot}/conflicts.mjs`, `${schemaRoot}/model.mjs`, `${schemaRoot}/compatibility.mjs`,
    "src/data/product-public-data.json", "src/lib/device-catalog.ts", "src/data/devices.ts", "src/lib/public-device-data.ts",
    "scripts/migrate-static-device-catalog-to-supabase.mjs", "scripts/devices/import-device-schema-v1.mjs", "src/pages/devices/[slug].astro",
    "scripts/lib/product-detail-repository-inventory.mjs", "scripts/test-product-detail-data-survival.mjs"];
  const texts = new Map();
  for (const inputPath of paths) {
    try { texts.set(inputPath, await readFile(path.join(root, inputPath), "utf8")); }
    catch (error) { if (error.code === "ENOENT") throw new Error(`SOURCE_MISSING:${inputPath}`); throw error; }
  }
  const documents = (await readdir(path.join(root, "src/content/docs/devices"))).filter((name) => name.endsWith(".mdx")).sort(compare);
  for (const name of documents) {
    const inputPath = `src/content/docs/devices/${name}`;
    texts.set(inputPath, await readFile(path.join(root, inputPath), "utf8"));
  }
  const productPages = (await readdir(path.join(root, "src/pages/products"), { recursive: true })).sort(compare);
  return { texts, productPages };
}

export async function buildRepositoryInventory({ root = repositoryRoot } = {}) {
  const { texts, productPages } = await readRepositoryInputs(root);
  const get = (name) => texts.get(name);
  const rawDocument = parseDocument(get(yamlPath), { uniqueKeys: true });
  if (rawDocument.errors.length) throw new Error(`SOURCE_PARSE_FAILED:${yamlPath}`);
  const raw = rawDocument.toJS();
  const source = enumerateSourceParameters(raw);
  if (!source.some((entry) => entry.state === "KNOWN")) throw new Error(`SOURCE_MISSING:${yamlPath}:known_parameters`);
  const parsed = await loadApprovedDeviceYaml(path.join(root, yamlPath));
  const manifest = JSON.parse(get("src/data/product-public-data.json"));
  const catalog = sandboxModule(get("src/lib/device-catalog.ts"), "src/lib/device-catalog.ts", {
    "../data/product-public-data.json": manifest,
  });
  const legacyFunctions = sandboxModule(selectedDeclarations(get("src/lib/device-catalog.ts"), "catalog.ts",
    ["deviceCatalog", "normalizeValue", "sanitizeSpecValue"]), "catalog-selected.ts");
  const bootstrapModule = sandboxModule(selectedDeclarations(get("scripts/migrate-static-device-catalog-to-supabase.mjs"),
    "bootstrap.mjs", ["catalogFields", "columnByField", "serializeDevice"]), "bootstrap-selected.mjs");
  const bootstrap = copy(catalog.getAllDevices().map(bootstrapModule.serializeDevice));
  const identityMap = JSON.parse(get(`${schemaRoot}/identity-map.json`));
  const identities = requireResolvedIdentities({ yamlDevices: raw.devices, bootstrapRows: bootstrap, mappings: identityMap.mappings });
  const normalized = normalizeCatalogYaml(parsed);
  const definitions = buildDefinitionRegistry(normalized);
  const sourceMetadata = await loadSourceMetadata(path.join(root, `${schemaRoot}/source-metadata.json`));
  const sourceCheck = validateSourceMetadata({ sourceUrls: normalized.devices.flatMap((device) => device.evidence.sourceUrls), metadata: sourceMetadata });
  if (sourceCheck.unmappedSourceUrls.length || sourceCheck.ambiguousSourceUrls.length || sourceCheck.invalidRecords.length) throw new Error("SOURCE_EVIDENCE_MAPPING_MISSING");
  const conflicts = classifyConflicts({ normalized, mappings: await loadConflictMappings(path.join(root, `${schemaRoot}/conflict-map.json`)),
    reviewedEvidenceSourceUrls: sourceMetadata.map((entry) => entry.url) });
  const model = buildNormalizedModel({ normalized, definitions, sourceMetadata, identityMappings: identities, conflicts });
  if (model.blockers.length) throw new Error(`PROCESSING_BLOCKED:${model.blockers[0].code}`);
  const compatibility = normalized.devices.map(buildLegacyCompatibility);
  const rows = identities.map((identity, index) => ({ ...bootstrap.find((row) => row.slug === identity.slug),
    full_specs: compatibility[index].full_specs, key_specs: compatibility[index].key_specs }));
  const mapper = sandboxModule(get("src/lib/public-device-data.ts"), "src/lib/public-device-data.ts");
  const projection = await projectRows(mapper, rows);
  const oldProjection = await projectRows(mapper, bootstrap);
  const projectedBySlug = new Map(projection.devices.map((device) => [device.slug, publicSpecMap(device)]));
  const known = source.filter((entry) => entry.state === "KNOWN");
  const parameterLedger = compareSourceStages(source, [
    { layer: "PARSER_DROPPED", read: (entry) => atPointer(parsed, entry.pointer) },
    { layer: "NORMALIZER_DROPPED", read: (entry) => normalized.devices[entry.deviceIndex]?.specs.find((spec) => spec.path === entry.canonicalPath)?.rawValue },
    { layer: "MODEL_DROPPED", read: (entry) => modelPreservesValue(model, identities[entry.deviceIndex].slug, entry) ? entry.value : undefined },
    { layer: "LEGACY_COMPAT_DROPPED", read: (entry) => {
      const spec = flattenSpecs(compatibility[entry.deviceIndex].full_specs).find((spec) => spec.path === entry.canonicalPath);
      return spec && spec.value === String(entry.value) ? entry.value : undefined;
    } },
    { layer: "PUBLIC_READER_DROPPED", read: (entry) => projectedBySlug.get(identities[entry.deviceIndex].slug)?.get(entry.canonicalPath) === String(entry.value) ? entry.value : undefined },
  ]).map((entry) => ({ ...entry, slug: identities[entry.deviceIndex].slug,
    region: raw.devices[entry.deviceIndex].evidence.region,
    definition: definitions.find((definition) => definition.key === entry.canonicalPath),
    sourceEvidencePointers: { sourceUrls: `/devices/${entry.deviceIndex}/evidence/source_urls`, conflicts: `/devices/${entry.deviceIndex}/evidence/conflicts` },
    typedValuePreserved: modelPreservesValue(model, identities[entry.deviceIndex].slug, entry),
  }));
  const surviving = (layer) => parameterLedger.filter((entry) => entry.state === "KNOWN" && entry.observed.find((item) => item.layer === layer)?.matches).length;
  const lost = parameterLedger.filter((entry) => entry.state === "KNOWN" && entry.firstLossLayer);
  const route = "[brand]/[slug].astro";
  const detailRouteExists = productPages.some((name) => name.replaceAll("\\", "/") === route);
  const legacyRouteSource = get("src/pages/devices/[slug].astro");
  const legacyAnchor = legacyRouteSource.includes("/#product-${product.slug}") && legacyRouteSource.includes(", 301)");

  // Legacy manifests are inventoried separately; they cannot replace YAML fact authority.
  const legacyLedger = manifest.products.flatMap((product, index) => flattenSpecs(product.publicData?.fullSpecs).map((entry) => {
    const row = bootstrap.find((row) => row.slug === product.slug);
    const [group, field] = entry.path.split(".");
    const before = row?.full_specs?.[group]?.[field];
    const after = publicSpecMap(oldProjection.devices.find((device) => device.slug === product.slug)).get(entry.path);
    const normalizedValue = legacyFunctions.normalizeValue(entry.value);
    const sanitizedValue = legacyFunctions.sanitizeSpecValue(field, normalizedValue);
    const catalogView = publicSpecMap(catalog.getDeviceBySlug(product.slug)).get(entry.path);
    return { sourcePath: "src/data/product-public-data.json", pointer: `/products/${index}/publicData/fullSpecs/${group}/${field}`,
      slug: product.slug, ...entry, authoritative: false, bootstrapExact: equal(before, entry.value), mapperExact: equal(after, entry.value),
      normalizedValue, sanitizedValue, catalogViewValue: catalogView ?? null,
      firstUnavailableLayer: normalizedValue === null ? "LEGACY_NORMALIZER_REJECTED" : sanitizedValue === null ? "LEGACY_SANITIZER_REJECTED"
        : !equal(catalogView, sanitizedValue) ? "LEGACY_CATALOG_GROUP_MAPPING_OR_PRECEDENCE"
        : !equal(before, sanitizedValue) ? "LEGACY_BOOTSTRAP_PROJECTION" : !equal(after, before) ? "PUBLIC_READER_DROPPED" : null };
  }));
  const legacyLibrary = sandboxModule(get("src/data/devices.ts"), "src/data/devices.ts").deviceLibrary;
  const typedProbe = await projectRows(mapper, [{ ...bootstrap[0], full_specs: { probe: { zero: 0, no: false, numeric: 12, text: "probe" } } }]);
  const probeMap = publicSpecMap(typedProbe.devices[0]);
  const sourceHashes = [...texts].map(([inputPath, text]) => ({ path: inputPath, sha256: hash(text) })).sort((a, b) => compare(a.path, b.path));
  const summary = {
    SLICE_C_TASK_1_DATA_SURVIVAL_FORENSIC: "PASS",
    BASE_HEAD: planCommit,
    EXECUTION_HEAD: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    PLAN_COMMIT: planCommit,
    AUTHORITATIVE_PARAMETER_SOURCE: yamlPath,
    CANONICAL_DEVICE_DATA_SOURCE: "public.devices via src/lib/public-device-data.ts (runtime contract only; no DB read)",
    LEGACY_PARAMETER_DATA_SOURCES: ["src/data/product-public-data.json", "src/lib/device-catalog.ts", "src/data/devices.ts", "src/content/docs/devices/*.mdx"],
    DEVICE_IDENTITY_COUNT: identities.length,
    DEVICE_IDENTITIES_FOUND: identities.map((entry) => entry.slug).sort(compare),
    EXISTING_DEVICE_DATA_PRESENT: identities.length > 0,
    EXISTING_PARAMETER_DATA_PRESENT: known.length > 0,
    KNOWN_SOURCE_PARAMETER_COUNT: known.length,
    PARAMETERS_SURVIVING_PARSER_COUNT: surviving("PARSER_DROPPED"),
    PARAMETERS_SURVIVING_NORMALIZER_COUNT: surviving("NORMALIZER_DROPPED"),
    PARAMETERS_SURVIVING_TYPED_MODEL_COUNT: parameterLedger.filter((entry) => entry.state === "KNOWN" && entry.typedValuePreserved).length,
    PARAMETERS_SURVIVING_CURRENT_PUBLIC_MAPPER_COUNT: surviving("PUBLIC_READER_DROPPED"),
    KNOWN_SOURCE_VALUE_DROPPED_COUNT: lost.length,
    FIRST_DATA_LOSS_LAYER: lost[0]?.firstLossLayer ?? (!detailRouteExists && legacyAnchor ? "ROUTE_DISCONNECTED" : "NO_DATA_LOSS_FOUND"),
    DATASET_MISSING: false, IDENTITY_MAPPING_MISSING: false,
    PARSER_DROPS_VALUES: surviving("PARSER_DROPPED") !== known.length,
    NORMALIZER_DROPS_VALUES: surviving("NORMALIZER_DROPPED") !== known.length,
    PUBLIC_MAPPER_DROPS_VALUES: surviving("PUBLIC_READER_DROPPED") !== known.length,
    ROOT_CAUSE_CLASSIFICATION: lost[0]?.firstLossLayer ?? (!detailRouteExists && legacyAnchor ? "ROUTE_DISCONNECTED" : "NO_DATA_LOSS_FOUND"),
    PRODUCTION_PUBLICATION_STATE: "UNKNOWN", PUBLISHED_DEVICE_COUNT: "UNKNOWN",
    MAPPER_EVIDENCE_SCOPE: "OFFLINE_YAML_DERIVED_COMPATIBILITY_INPUT_NOT_DEPLOYED_DATA_OR_RLS",
    CANONICAL_DETAIL_ROUTE_EXISTS: detailRouteExists,
    LEGACY_DEVICE_ROUTE: legacyAnchor ? "301_TO_BRAND_ANCHOR" : "UNKNOWN",
    TOTAL_SOURCE_PARAMETER_FIELD_COUNT: source.length,
    COMPATIBILITY_NON_KNOWN_STATE_OMISSION_COUNT: parameterLedger.filter((entry) => entry.state !== "KNOWN" && !entry.observed.find((item) => item.layer === "LEGACY_COMPAT_DROPPED").matches).length,
    LEGACY_MANIFEST_FULL_SPEC_FIELD_COUNT: legacyLedger.length,
    LEGACY_MANIFEST_FIELDS_NOT_EXACTLY_IN_BOOTSTRAP_COUNT: legacyLedger.filter((entry) => !entry.bootstrapExact).length,
    LEGACY_MANIFEST_FIELDS_DROPPED_BY_PUBLIC_MAPPER_COUNT: legacyLedger.filter((entry) => entry.bootstrapExact && !entry.mapperExact).length,
    LEGACY_MANIFEST_NORMALIZER_REJECTED_COUNT: legacyLedger.filter((entry) => entry.firstUnavailableLayer === "LEGACY_NORMALIZER_REJECTED").length,
    LEGACY_MANIFEST_SANITIZER_REJECTED_COUNT: legacyLedger.filter((entry) => entry.firstUnavailableLayer === "LEGACY_SANITIZER_REJECTED").length,
    LEGACY_MANIFEST_FIRST_UNAVAILABLE_LAYERS: Object.fromEntries([...new Set(legacyLedger.map((entry) => entry.firstUnavailableLayer).filter(Boolean))].sort(compare)
      .map((layer) => [layer, legacyLedger.filter((entry) => entry.firstUnavailableLayer === layer).length])),
    TYPED_MAPPER_PROBE: { evidenceClass: "SYNTHETIC_CAPABILITY_ONLY_NOT_OBSERVED_YAML_LOSS", zeroRetained: probeMap.has("probe.zero"), falseRetained: probeMap.has("probe.no"), numberRetained: probeMap.has("probe.numeric"), textRetained: probeMap.has("probe.text") },
  };
  return {
    format: "product-detail-repository-inventory-v1", summary, sourceHashes,
    identities: identities.map((identity, index) => ({ ...identity,
      brandKey: bootstrap.find((row) => row.slug === identity.slug).brand_key, canonicalIdentity: keyOf(raw.devices[index].basic),
      identityMetadata: copy(raw.devices[index].basic), publicationState: "UNKNOWN",
      evidence: { ...copy(raw.devices[index].evidence), notes: undefined, notesExcludedAsInternalCount: raw.devices[index].evidence.notes.length },
    })).sort((a, b) => compare(a.slug, b.slug)),
    definitions, sources: model.sources, sourceLinks: model.sourceLinks, fieldEvidence: model.evidence,
    parameterLedger, legacyLedger,
    legacyInventory: { manifestProducts: copy(manifest.products), catalogBaseDevices: copy(legacyFunctions.deviceCatalog), libraryEntries: copy(legacyLibrary),
      editorialPaths: sourceHashes.filter((entry) => entry.path.endsWith(".mdx")).map((entry) => entry.path) },
    pipeline: { bootstrap, readerCompatibleRows: rows, compatibility, projectionQuery: projection.calls,
      normalizedBlockers: model.blockers,
      publicMapperKnownScope: "specGroups; card/preview/quick subsets are intentionally bounded, not a full parameter oracle",
      tablesObservedInMapperQuery: projection.calls.map((call) => call.table),
      normalizedTablesReadByCurrentMapper: projection.calls.some((call) => call.table !== "devices"), normalizedMetadataAvailableViaLegacySpecs: false,
      dataImportApplied: false, runtimeDataState: "UNKNOWN", privateInternalExclusions: ["evidence.notes", "database raw_value", "updated_by", "audit metadata"] },
  };
}

export function serializeInventory(inventory) {
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort(compare).map((key) => [key, stable(value[key])]));
    return value;
  }
  return JSON.stringify(stable(inventory), null, 2) + "\n";
}

async function main() {
  if (process.argv.length !== 2) throw new Error("NO_ARGUMENTS_ALLOWED");
  const inventory = await buildRepositoryInventory();
  const directory = path.join(repositoryRoot, artifactDirectory);
  execFileSync("git", ["check-ignore", "--quiet", `${artifactDirectory}/inventory.json`], { cwd: repositoryRoot });
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "inventory.json"), serializeInventory(inventory));
  await writeFile(path.join(directory, "receipt.json"), serializeInventory(inventory.summary));
  console.log(JSON.stringify({ ...inventory.summary, INVENTORY_PATH: `${artifactDirectory}/inventory.json` }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    const code = /^(SOURCE_MISSING|SOURCE_PARSE_FAILED|IDENTITY_MAPPING_MISSING|SOURCE_EVIDENCE_MAPPING_MISSING|PROCESSING_BLOCKED|PUBLIC_READER_CONTRACT_CHANGED|SOURCE_CONTRACT_CHANGED|OFFLINE_IMPORT_DENIED|SOURCE_COMPILE_FAILED|NO_ARGUMENTS_ALLOWED)(?::[a-zA-Z0-9_./-]+)*$/;
    console.error(`PRODUCT_DETAIL_REPOSITORY_INVENTORY=FAIL FIRST_FAIL=${code.test(error.message) ? error.message : "FORENSIC_EXECUTION_ERROR"}`);
    process.exitCode = 1;
  });
}
