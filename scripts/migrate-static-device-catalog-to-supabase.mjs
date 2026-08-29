import process from "node:process";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";

const catalogFields = [
  "slug", "brandKey", "brandName", "name", "shortDescription", "longDescription", "positioning", "releaseYear",
  "availability", "typeLabel", "statusLabel", "media", "productImageUrl", "officialImageUrl", "imageAlt", "productUrl",
  "officialProductUrl", "buyUrl", "category", "routeLabel", "routeDescription", "bestFor", "notIdealFor", "keyLimitations",
  "keySpecs", "fullSpecs",
];

const columnByField = {
  slug: "slug", brandKey: "brand_key", brandName: "brand_name", name: "name", shortDescription: "short_description",
  longDescription: "long_description", positioning: "positioning", releaseYear: "release_year", availability: "availability",
  typeLabel: "type_label", statusLabel: "status_label", media: "media", productImageUrl: "product_image_url",
  officialImageUrl: "official_image_url", imageAlt: "image_alt", productUrl: "product_url", officialProductUrl: "official_product_url",
  buyUrl: "buy_url", category: "category", routeLabel: "route_label", routeDescription: "route_description",
  bestFor: "best_for", notIdealFor: "not_ideal_for", keyLimitations: "key_limitations", keySpecs: "key_specs", fullSpecs: "full_specs",
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function serializeDevice(device) {
  const row = { publication_status: "published" };
  for (const field of catalogFields) row[columnByField[field]] = device[field] ?? null;
  return row;
}

export async function buildDeviceRows() {
  const server = await createServer({ root: process.cwd(), server: { middlewareMode: true } });
  try {
    const { getAllDevices } = await server.ssrLoadModule("/src/lib/device-catalog.ts");
    return getAllDevices().map(serializeDevice);
  } finally {
    await server.close();
  }
}

export function validateDeviceRows(rows) {
  const slugs = rows.map((row) => row.slug);
  const uniqueSlugCount = new Set(slugs).size;
  const fieldParityFailures = rows.filter((row) =>
    catalogFields.some((field) => !Object.hasOwn(row, columnByField[field]))
  ).length;
  assert(rows.length === 24, `Expected exactly 24 source records; received ${rows.length}.`);
  assert(uniqueSlugCount === rows.length, "Source catalog contains duplicate slugs.");
  assert(rows.every((row) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug)), "Source catalog contains an invalid slug.");
  assert(rows.every((row) => row.publication_status === "published"), "Initial catalog rows must be published.");
  return { inputCount: rows.length, outputCount: rows.length, uniqueSlugCount, duplicateCount: rows.length - uniqueSlugCount, fieldParityFailures };
}

export function buildImportPlan(rows, existingBySlug = new Map()) {
  return rows.map((row) => {
    const existing = existingBySlug.get(row.slug);
    return existing ? { ...row, publication_status: existing.publication_status } : row;
  });
}

function requireLocalTarget(urlText) {
  const url = new URL(urlText);
  assert(["localhost", "127.0.0.1", "::1"].includes(url.hostname), "Refusing a non-local Supabase target.");
}

async function applyToLocalSupabase(rows) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url && key, "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply-local.");
  requireLocalTarget(url);
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: existing, error: existingError } = await client.from("devices").select("slug, publication_status");
  if (existingError) throw existingError;
  const existingBySlug = new Map(existing.map((row) => [row.slug, row]));
  const plan = buildImportPlan(rows, existingBySlug);
  const { error } = await client.from("devices").upsert(plan, { onConflict: "slug" });
  if (error) throw error;
}

async function main() {
  const rows = await buildDeviceRows();
  const integrity = validateDeviceRows(rows);
  if (process.argv.includes("--apply-local")) await applyToLocalSupabase(rows);
  console.log(JSON.stringify({ ...integrity, mode: process.argv.includes("--apply-local") ? "apply-local" : "dry-run" }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`STATIC_DEVICE_CATALOG_MIGRATION_FAIL ${error.message}`);
    process.exitCode = 1;
  });
}
