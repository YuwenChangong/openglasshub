import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as publicDeviceData from "../src/lib/public-device-data.ts";
import { loadApprovedDeviceYaml } from "./devices/schema-v1/yaml-input.mjs";
import { normalizeCatalogYaml } from "./devices/schema-v1/normalize.mjs";
import { buildLegacyCompatibility } from "./devices/schema-v1/compatibility.mjs";
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
const removedImages=await listPublishedDevices(clientWith([row({product_image_url:"/assets/owned-old.png",official_image_url:"/assets/owned-official.png",media:{images:[]}})]).client);
assert.equal(removedImages[0].productImageUrl,null,"An explicitly emptied gallery must not resurrect a legacy image");
const selectedImages=await listPublishedDevices(clientWith([row({product_image_url:"/assets/owned-old.png",media:{images:[{url:"/assets/owned-new.png",altZh:"新图片",altEn:"New image",hero:true}]}})]).client);
assert.equal(selectedImages[0].productImageUrl,"/assets/owned-new.png","Selected hero must be the shared public image");

assert.equal(typeof publicDeviceData.getPublicDeviceSpecValue, "function", "canonical UI spec reader must exist");
const catalog = await loadApprovedDeviceYaml(new URL("../src/data/devices/openglasshub_device_data_v1.yaml", import.meta.url));
const normalized = normalizeCatalogYaml(catalog);
for (const brand of ["XREAL", "RayNeo", "Ray-Ban / Meta"]) {
  const device = normalized.devices.find((device) => device.identity.brand === brand);
  assert.ok(device, `approved ${brand} device exists`);
  const compatibility = buildLegacyCompatibility(device);
  const actual = (await listPublishedDevices(clientWith([row(compatibility)]).client))[0];
  for (const [field, path, unit] of [
    ["weight", "basic.weight_g", "g"],
    ["display_type", "display.display_technology", null],
    ["resolution", "display.resolution_per_eye", "(per eye)"],
    ["field_of_view", "display.fov_deg", "deg"],
    ["refresh_rate_hz", "display.refresh_rate_hz", "Hz"],
    ["eye_brightness_nits", "display.eye_brightness", "nits"],
    ["panel_or_projector_brightness_nits", "display.panel_or_projector_brightness", "nits"],
  ]) {
    const source = device.specs.find((spec) => spec.path === path);
    const value = publicDeviceData.getPublicDeviceSpecValue(actual, field);
    if (!source || source.state !== "KNOWN") assert.equal(value, null, `${brand} omitted unknown ${field} stays unknown`);
    else {
      assert.ok(value?.startsWith(String(source.rawValue)), `${brand} ${field} retains approved source value`);
      if (unit) assert.ok(value.endsWith(unit), `${brand} ${field} has correct unit`);
    }
  }
}
const canonical = (await listPublishedDevices(clientWith([row({ full_specs: {
  basic: { weight_g: "82" },
  display: { display_technology: "Micro-OLED", resolution_per_eye: "1920x1080", fov_deg: "46", refresh_rate_hz: "Up to 120", eye_brightness: "500", panel_or_projector_brightness: "100000" },
  compute: { soc: "Not disclosed" }, camera: { camera_present: "No" }, power: { typical_runtime: "Not applicable" },
} })]).client))[0];
const spec = (field) => publicDeviceData.getPublicDeviceSpecValue(canonical, field);
assert.equal(spec("weight"), "82 g");
assert.equal(spec("display_type"), "Micro-OLED");
assert.equal(spec("resolution"), "1920x1080 (per eye)");
assert.equal(spec("field_of_view"), "46 deg");
assert.equal(spec("refresh_rate_hz"), "Up to 120 Hz");
assert.equal(spec("eye_brightness_nits"), "500 nits");
assert.equal(spec("panel_or_projector_brightness_nits"), "100000 nits");
assert.equal(spec("brightness"), null, "different brightness contexts must not be conflated");
assert.equal(spec("chipset"), "Not disclosed");
assert.equal(spec("camera"), "No");
assert.equal(spec("battery_life"), "Not applicable");
assert.equal(publicDeviceData.getPublicDeviceSpecValue(published[0], "weight"), "20g", "legacy values remain readable");
assert.equal(spec("unknown_field"), null);
const withUnits = (await listPublishedDevices(clientWith([row({ full_specs: { basic: { weight_g: "72 g" }, display: { refresh_rate_hz: "120 Hz", fov_deg: "50 deg" } } })]).client))[0];
assert.equal(publicDeviceData.getPublicDeviceSpecValue(withUnits, "weight"), "72 g");
assert.equal(publicDeviceData.getPublicDeviceSpecValue(withUnits, "refresh_rate_hz"), "120 Hz");
assert.equal(publicDeviceData.getPublicDeviceSpecValue(withUnits, "field_of_view"), "50 deg");

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
