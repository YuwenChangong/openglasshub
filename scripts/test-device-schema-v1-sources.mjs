import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadApprovedDeviceYaml } from "./devices/schema-v1/yaml-input.mjs";
import { normalizeCatalogYaml } from "./devices/schema-v1/normalize.mjs";
import {
  loadSourceMetadata,
  normalizeSourceUrl,
  sourceTypePublicLabel,
  validateSourceMetadata,
} from "./devices/schema-v1/sources.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const yamlPath = path.join(root, "src/data/devices/openglasshub_device_data_v1.yaml");
const metadataPath = path.join(root, "scripts/devices/schema-v1/source-metadata.json");
const catalog = normalizeCatalogYaml(await loadApprovedDeviceYaml(yamlPath));
const UNIQUE_SOURCE_URLS = [...new Set(catalog.devices
  .flatMap((device) => device.evidence.sourceUrls)
  .map(normalizeSourceUrl))]
  .sort();

const metadata = await loadSourceMetadata(metadataPath);
const validation = validateSourceMetadata({ sourceUrls: UNIQUE_SOURCE_URLS, metadata });

const EVIDENCE_ONLY_SOURCE_URLS = [
  "https://shop.viture.com/ja-sg/blogs/news/mmorpgs-viture-one-dock-pack-review",
  "https://store.viture.com/products/lite-xr-glasses",
  "https://www.paoka.com/product/INMO-Air2",
];
assert.equal(validation.sourceMetadataMapCount, UNIQUE_SOURCE_URLS.length + EVIDENCE_ONLY_SOURCE_URLS.length, "SOURCE_METADATA_MAP_COUNT includes only explicitly curated evidence-only sources beyond YAML URLs");
assert.equal(validation.unmappedSourceUrls.length, 0, "UNMAPPED_SOURCE_URLS=0");
assert.equal(validation.ambiguousSourceUrls.length, 0, "AMBIGUOUS_SOURCE_URLS=0");
assert.equal(validation.invalidRecords.length, 0, "all source metadata records have required fields and nullable optional dates");
for (const url of EVIDENCE_ONLY_SOURCE_URLS) {
  assert.ok(!UNIQUE_SOURCE_URLS.includes(url), "evidence-only provenance sources never become YAML spec-value sources");
}
assert.equal(metadata.find((record) => record.url === "https://shop.viture.com/ja-sg/blogs/news/mmorpgs-viture-one-dock-pack-review")?.sourceType, "archived_official");
assert.equal(metadata.find((record) => record.url === "https://store.viture.com/products/lite-xr-glasses")?.sourceType, "archived_official");
assert.equal(metadata.find((record) => record.url === "https://www.paoka.com/product/INMO-Air2")?.sourceType, "reputable_secondary");

const allowedSourceTypes = new Set([
  "current_official_product_page",
  "official_manual",
  "official_spec_sheet",
  "official_developer_docs",
  "official_faq",
  "regulatory_document",
  "archived_official",
  "reputable_secondary",
]);
for (const record of metadata) {
  assert.equal(record.url, normalizeSourceUrl(record.url), "source metadata map is keyed by normalized URL");
  assert.equal(typeof record.publisher, "string");
  assert.ok(record.publisher.trim());
  assert.ok(allowedSourceTypes.has(record.sourceType));
  assert.match(record.accessedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(record.title === null || typeof record.title === "string");
  assert.ok(record.publishedAt === null || /^\d{4}-\d{2}-\d{2}$/.test(record.publishedAt));
  if (record.sourceType === "reputable_secondary") {
    assert.notEqual(sourceTypePublicLabel(record.sourceType), "Official", "reputable secondary source is never labeled Official");
  }
}

const directory = await mkdtemp(path.join(os.tmpdir(), "openglass-source-map-"));
try {
  const fixturePath = path.join(directory, "metadata.json");
  const reviewedFixture = {
    url: "https://unreviewed.example/path",
    publisher: "Unreviewed Example",
    title: null,
    source_type: "reputable_secondary",
    published_at: null,
    accessed_at: "2026-09-05",
    region: null,
  };
  async function assertRejectedFixture(record, expectedError) {
    await writeFile(fixturePath, JSON.stringify([record]), "utf8");
    await assert.rejects(() => loadSourceMetadata(fixturePath), expectedError);
  }

  await assertRejectedFixture(
    (({ title, ...record }) => record)(reviewedFixture),
    /title is required/,
  );
  await assertRejectedFixture(
    (({ published_at, ...record }) => record)(reviewedFixture),
    /published_at is required/,
  );
  await assertRejectedFixture(
    (({ region, ...record }) => record)(reviewedFixture),
    /region is required/,
  );
  await assertRejectedFixture(
    { ...reviewedFixture, accessed_at: "2026-02-31" },
    /accessed_at is required as an ISO date/,
  );

  await writeFile(fixturePath, JSON.stringify([reviewedFixture]), "utf8");
  const fixture = await loadSourceMetadata(fixturePath);
  const unresolved = validateSourceMetadata({
    sourceUrls: ["https://unreviewed.example/path", "https://unmapped.example/product"],
    metadata: fixture,
  });
  assert.deepEqual(unresolved.unmappedSourceUrls, ["https://unmapped.example/product"], "unknown domains and paths are not inferred at runtime");
  assert.equal(unresolved.ambiguousSourceUrls.length, 0);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log(`DEVICE_SCHEMA_V1_SOURCES_OK YAML_SOURCE_URLS=${UNIQUE_SOURCE_URLS.length} EVIDENCE_ONLY_SOURCE_URLS=${EVIDENCE_ONLY_SOURCE_URLS.length} SOURCE_METADATA_MAP_COUNT=${validation.sourceMetadataMapCount} UNMAPPED_SOURCE_URLS=${validation.unmappedSourceUrls.length} AMBIGUOUS_SOURCE_URLS=${validation.ambiguousSourceUrls.length}`);
