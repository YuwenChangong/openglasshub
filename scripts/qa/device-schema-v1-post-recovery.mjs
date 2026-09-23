import { JSDOM } from "jsdom";
import { RELEASE_B_PACKET } from "./device-schema-v1-release-b-gate.mjs";
import identityMap from "../devices/schema-v1/identity-map.json" with { type: "json" };

export const APPROVED_POST_RECOVERY_ORIGIN = "https://openglasshub.ogh.workers.dev";

const READ_ONLY_FETCH_OPTIONS = Object.freeze({
  method: "GET",
  redirect: "manual",
  credentials: "omit",
});

function fail(code, details = undefined) {
  const error = new TypeError(code);
  if (details !== undefined) error.details = details;
  throw error;
}

function assertPlainObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

function assertApprovedOrigin(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    fail("POST_RECOVERY_TARGET_ORIGIN_INVALID");
  }

  if (parsed.protocol !== "https:") fail("POST_RECOVERY_HTTPS_REQUIRED");
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    fail("POST_RECOVERY_TARGET_ORIGIN_INVALID");
  }
  if (parsed.origin !== APPROVED_POST_RECOVERY_ORIGIN) fail("POST_RECOVERY_APPROVED_HOST_REQUIRED");
  return parsed.origin;
}

function assertExpectedPath(path, code) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) fail(code);
  return path;
}

function responseStatus(response) {
  return Number(response?.status ?? 0);
}

async function fetchReadOnly(fetchImpl, origin, path) {
  const response = await fetchImpl(new URL(assertExpectedPath(path, "POST_RECOVERY_ROUTE_INVALID"), origin).toString(), READ_ONLY_FETCH_OPTIONS);
  const status = responseStatus(response);
  if (status >= 500) fail("POST_RECOVERY_UNEXPECTED_500", { path, status });
  return response;
}

async function readProductsPage(response) {
  try {
    const document = new JSDOM(await response.text()).window.document;
    const payload = JSON.parse(document.getElementById("products-brand-data")?.textContent ?? "");
    if (!Array.isArray(payload.brands) || !Array.isArray(payload.compareProducts)) throw new TypeError();
    return { document, payload };
  } catch {
    fail("POST_RECOVERY_PRODUCTS_PAYLOAD_INVALID");
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertDeepEqual(actual, expected, code) {
  if (stableJson(actual) !== stableJson(expected)) fail(code, { actual, expected });
}

function redirectLocation(response) {
  if (typeof response?.headers?.get === "function") return response.headers.get("location");
  return undefined;
}

export async function verifySchemaV1PostRecovery({ receipt, fetch: fetchImpl = globalThis.fetch } = {}) {
  assertPlainObject(receipt, "POST_RECOVERY_RECEIPT_REQUIRED");
  if (typeof fetchImpl !== "function") fail("POST_RECOVERY_FETCH_REQUIRED");

  const origin = assertApprovedOrigin(receipt.targetOrigin);
  const expected = assertPlainObject(receipt.expected, "POST_RECOVERY_EXPECTED_REQUIRED");

  const productsPath = assertExpectedPath(expected.productsRoute, "POST_RECOVERY_PRODUCTS_ROUTE_REQUIRED");
  const productsResponse = await fetchReadOnly(fetchImpl, origin, productsPath);
  if (responseStatus(productsResponse) < 200 || responseStatus(productsResponse) > 299) {
    fail("POST_RECOVERY_PRODUCTS_ROUTE_MISMATCH", { status: responseStatus(productsResponse) });
  }
  const { document, payload } = await readProductsPage(productsResponse);

  const brandCounts = assertPlainObject(expected.brandCounts, "POST_RECOVERY_BRAND_COUNTS_REQUIRED");
  const publishedDevices = expected.publishedDevices;
  if (publishedDevices !== RELEASE_B_PACKET.expectedAfterCounts.publishedDevices) fail("POST_RECOVERY_PUBLISHED_DEVICES_REQUIRED");
  const actualBrandCounts = {};
  for (const brand of payload.brands) {
    if (typeof brand?.key !== "string" || !brand.key || !Number.isInteger(brand.productCount) || Object.hasOwn(actualBrandCounts, brand.key)) fail("POST_RECOVERY_BRAND_COUNTS_INVALID");
    actualBrandCounts[brand.key] = brand.productCount;
    const matchingModule = [...document.querySelectorAll("[data-brand-module]")].filter((module) => module.getAttribute("href") === `/products/${brand.key}/`);
    if (matchingModule.length !== 1) fail("POST_RECOVERY_BRAND_COUNTS_MISMATCH");
  }
  assertDeepEqual(actualBrandCounts, brandCounts, "POST_RECOVERY_BRAND_COUNTS_MISMATCH");
  const productSlugs = new Set();
  const productCounts = {};
  for (const product of payload.compareProducts) {
    if (typeof product?.slug !== "string" || !product.slug || productSlugs.has(product.slug) || !Object.hasOwn(brandCounts, product.brandKey)) fail("POST_RECOVERY_PUBLISHED_DEVICES_MISMATCH");
    productSlugs.add(product.slug);
    productCounts[product.brandKey] = (productCounts[product.brandKey] ?? 0) + 1;
  }
  if (productSlugs.size !== publishedDevices) fail("POST_RECOVERY_PUBLISHED_DEVICES_MISMATCH");
  const approvedSlugs = new Set(identityMap.mappings.map((mapping) => mapping.slug));
  if (approvedSlugs.size !== RELEASE_B_PACKET.expectedAfterCounts.uniqueSlugs
    || [...approvedSlugs].some((slug) => !productSlugs.has(slug))) fail("POST_RECOVERY_DEVICE_SLUG_SET_MISMATCH");
  assertDeepEqual(Object.fromEntries(Object.keys(brandCounts).map((key) => [key, productCounts[key] ?? 0])), brandCounts, "POST_RECOVERY_BRAND_COUNTS_MISMATCH");

  const redirects = assertPlainObject(expected.redirects, "POST_RECOVERY_REDIRECTS_REQUIRED");
  const verifiedRedirects = {};
  for (const [slug, location] of Object.entries(redirects)) {
    if (typeof slug !== "string" || !slug) fail("POST_RECOVERY_DEVICE_REDIRECT_INVALID");
    if (!productSlugs.has(slug)) fail("POST_RECOVERY_DEVICE_REDIRECT_INVALID");
    const expectedLocation = assertExpectedPath(location, "POST_RECOVERY_DEVICE_REDIRECT_INVALID");
    const response = await fetchReadOnly(fetchImpl, origin, `/devices/${encodeURIComponent(slug)}/`);
    const status = responseStatus(response);
    if (status < 300 || status > 399 || redirectLocation(response) !== expectedLocation) {
      fail("POST_RECOVERY_DEVICE_REDIRECT_MISMATCH", { slug, status, location: redirectLocation(response), expectedLocation });
    }
    verifiedRedirects[slug] = expectedLocation;
  }

  const compatibility = assertPlainObject(expected.compatibility, "POST_RECOVERY_COMPATIBILITY_REQUIRED");
  const verifiedCompatibilitySlugs = [];
  for (const [slug, expectedCompatibility] of Object.entries(compatibility)) {
    if (typeof slug !== "string" || !slug) fail("POST_RECOVERY_COMPATIBILITY_INVALID");
    assertPlainObject(expectedCompatibility, "POST_RECOVERY_COMPATIBILITY_INVALID");
    const product = payload.compareProducts.find((item) => item.slug === slug);
    if (!product || !product.compareValues) fail("POST_RECOVERY_COMPATIBILITY_INVALID");
    assertDeepEqual(Object.fromEntries(Object.keys(expectedCompatibility).map((key) => [key, product.compareValues[key]])), expectedCompatibility, "POST_RECOVERY_COMPATIBILITY_MISMATCH");
    verifiedCompatibilitySlugs.push(slug);
  }

  return {
    ...receipt,
    postRecovery: {
      status: "PASS",
      approvedOrigin: origin,
      readOnly: true,
      httpsOnly: true,
      approvedHostOnly: true,
      results: {
        productsRoute: { status: "PASS", path: productsPath, publishedDevices },
        brandCounts: { status: "PASS", counts: brandCounts },
        deviceRedirects: { status: "PASS", redirects: verifiedRedirects },
        yamlCompatibility: { status: "PASS", slugs: verifiedCompatibilitySlugs },
      },
      sideEffects: {
        productionDbConnections: 0,
        productionDbWrites: 0,
        qaProdRuns: 0,
        providerMutations: 0,
      },
    },
  };
}
