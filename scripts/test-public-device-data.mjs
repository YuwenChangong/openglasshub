import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  listPublishedDevices,
  getPublishedDeviceBySlug,
  publicDeviceColumns,
} from "../src/lib/public-device-data.ts";

const row = (overrides = {}) => ({
  id: "00000000-0000-4000-8000-000000000001", slug: "public-device", brand_key: "xreal", brand_name: "XREAL", name: "Public Device",
  short_description: "Short", long_description: "Long", positioning: null, release_year: "2025", availability: "在售", type_label: "显示眼镜", status_label: null,
  media: { imageAlt: "Device", imageBackground: "dark", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" }, product_image_url: null,
  official_image_url: null, image_alt: "Device", product_url: null, official_product_url: "https://example.test/device", buy_url: null,
  category: "display_glasses", route_label: "显示眼镜", route_description: "Route", best_for: ["Testing"], not_ideal_for: ["None"],
  key_limitations: [], key_specs: [{ field: "weight", label: "重量", value: "20g" }], full_specs: { physical: { weight: "20g" } }, publication_status: "published",
  ...overrides,
});

function clientWith(rows, error = null) {
  const state = { table: null, columns: null, filters: [], order: null };
  const query = {
    select(columns) { state.columns = columns; return query; },
    eq(key, value) { state.filters.push([key, value]); return query; },
    order(key, options) { state.order = [key, options]; return Promise.resolve({ data: rows, error }); },
    maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error }); },
  };
  return { state, client: { from(table) { state.table = table; return query; } } };
}

const list = clientWith([row()]);
const published = await listPublishedDevices(list.client);
assert.equal(list.state.table, "devices");
assert.equal(list.state.columns, publicDeviceColumns);
assert.deepEqual(list.state.filters, [["publication_status", "published"]]);
assert.equal(published.length, 1);
assert.equal(published[0].publicationStatus, undefined);
assert.equal(published[0].id, undefined);
assert.equal(published[0].slug, "public-device");
assert.equal(published[0].specGroups[0].items[0].value, "20g");

const detail = clientWith([row()]);
assert.equal((await getPublishedDeviceBySlug(detail.client, "public-device"))?.slug, "public-device");
assert.deepEqual(detail.state.filters, [["publication_status", "published"], ["slug", "public-device"]]);

const absent = clientWith([]);
assert.equal(await getPublishedDeviceBySlug(absent.client, "draft-device"), null);
await assert.rejects(() => listPublishedDevices(clientWith([], { code: "XX000", message: "database exploded" }).client), /public device read failed/i);
assert.equal(/\b(id|publicationStatus|slugLocked|createdAt|updatedAt)\b/.test(publicDeviceColumns), false);

const [sitemapSource, forumSearchSource, discussionSource, legacyIndexSource, legacyDetailSource] = await Promise.all([
  readFile(new URL("../src/pages/sitemap.xml.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/forum-search.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/device-discussion.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/devices/index.astro", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/devices/[slug].astro", import.meta.url), "utf8"),
]);
assert.match(sitemapSource, /listPublishedDevices/);
assert.doesNotMatch(sitemapSource, /getDeviceBySlug/);
assert.match(forumSearchSource, /listPublishedDevices/);
assert.doesNotMatch(forumSearchSource, /getAllDevices/);
assert.doesNotMatch(discussionSource, /getDeviceBySlug/);
assert.match(legacyIndexSource, /export const prerender = false/);
assert.match(legacyDetailSource, /getPublishedDeviceBySlug/);
assert.match(legacyDetailSource, /x-robots-tag/);
console.log("PUBLIC_DEVICE_DATA_TESTS=PASS");
