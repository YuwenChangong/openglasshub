import { readFile } from "node:fs/promises";

export const DEVICE_SOURCE_TYPES = Object.freeze([
  "current_official_product_page",
  "official_manual",
  "official_spec_sheet",
  "official_developer_docs",
  "official_faq",
  "regulatory_document",
  "archived_official",
  "reputable_secondary",
]);

const SOURCE_TYPE_SET = new Set(DEVICE_SOURCE_TYPES);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoCalendarDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

/** Normalize a URL for deterministic reviewed-map lookup only. */
export function normalizeSourceUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Source URL must be a non-empty string");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new TypeError("Source URL must use HTTP(S)");
  url.hash = "";
  return url.toString();
}

function toRecord(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`source metadata record ${index} must be an object`);
  for (const key of ["url", "publisher", "title", "source_type", "published_at", "accessed_at", "region"]) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`source metadata record ${index} ${key} is required`);
  }
  const record = {
    url: normalizeSourceUrl(value.url),
    publisher: value.publisher,
    title: value.title,
    sourceType: value.source_type,
    publishedAt: value.published_at,
    accessedAt: value.accessed_at,
    region: value.region,
  };
  if (typeof record.publisher !== "string" || !record.publisher.trim()) throw new TypeError(`source metadata record ${index} publisher is required`);
  if (!SOURCE_TYPE_SET.has(record.sourceType)) throw new TypeError(`source metadata record ${index} source_type is not approved`);
  if (record.title !== null && typeof record.title !== "string") throw new TypeError(`source metadata record ${index} title must be nullable text`);
  if (record.publishedAt !== null && !isIsoCalendarDate(record.publishedAt)) throw new TypeError(`source metadata record ${index} published_at must be a nullable ISO date`);
  if (!isIsoCalendarDate(record.accessedAt)) throw new TypeError(`source metadata record ${index} accessed_at is required as an ISO date`);
  if (record.region !== null && typeof record.region !== "string") throw new TypeError(`source metadata record ${index} region must be nullable text`);
  return Object.freeze(record);
}

/** Load reviewed source metadata; source classification is data, never inferred from URL domains or paths. */
export async function loadSourceMetadata(sourcePath) {
  const parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  if (!Array.isArray(parsed)) throw new TypeError("source metadata map must be an array");
  return Object.freeze(parsed.map(toRecord));
}

/** Resolve normalized catalog URLs against the reviewed sidecar without network, domain, or path inference. */
export function validateSourceMetadata({ sourceUrls, metadata }) {
  if (!Array.isArray(sourceUrls)) throw new TypeError("sourceUrls must be an array");
  if (!Array.isArray(metadata)) throw new TypeError("metadata must be an array");
  const requestedUrls = [...new Set(sourceUrls.map(normalizeSourceUrl))].sort();
  const recordsByUrl = new Map();
  for (const record of metadata) {
    const url = normalizeSourceUrl(record.url);
    const records = recordsByUrl.get(url) ?? [];
    records.push(record);
    recordsByUrl.set(url, records);
  }
  const unmappedSourceUrls = requestedUrls.filter((url) => !recordsByUrl.has(url));
  const ambiguousSourceUrls = requestedUrls.filter((url) => (recordsByUrl.get(url)?.length ?? 0) > 1);
  const invalidRecords = metadata.flatMap((record, index) => {
    try {
      toRecord({
        url: record.url,
        publisher: record.publisher,
        title: record.title,
        source_type: record.sourceType,
        published_at: record.publishedAt,
        accessed_at: record.accessedAt,
        region: record.region,
      }, index);
      return [];
    } catch (error) {
      return [{ index, message: error.message }];
    }
  });
  return {
    sourceMetadataMapCount: metadata.length,
    unmappedSourceUrls,
    ambiguousSourceUrls,
    invalidRecords,
  };
}

/** Only an explicitly secondary type renders as secondary; source types are not guessed from URLs. */
export function sourceTypePublicLabel(sourceType) {
  if (!SOURCE_TYPE_SET.has(sourceType)) throw new TypeError("source_type is not approved");
  return sourceType === "reputable_secondary" ? "Secondary source" : "Official";
}
