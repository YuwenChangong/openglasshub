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

async function readJson(response, code) {
  try {
    return await response.json();
  } catch {
    fail(code);
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

  const brandCounts = assertPlainObject(expected.brandCounts, "POST_RECOVERY_BRAND_COUNTS_REQUIRED");
  const brandCountsResponse = await fetchReadOnly(fetchImpl, origin, "/products/post-recovery.json");
  const brandCountsBody = await readJson(brandCountsResponse, "POST_RECOVERY_BRAND_COUNTS_INVALID");
  assertDeepEqual(brandCountsBody.brandCounts, brandCounts, "POST_RECOVERY_BRAND_COUNTS_MISMATCH");

  const redirects = assertPlainObject(expected.redirects, "POST_RECOVERY_REDIRECTS_REQUIRED");
  const verifiedRedirects = {};
  for (const [slug, location] of Object.entries(redirects)) {
    if (typeof slug !== "string" || !slug) fail("POST_RECOVERY_DEVICE_REDIRECT_INVALID");
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
    const response = await fetchReadOnly(fetchImpl, origin, `/products/compatibility/${encodeURIComponent(slug)}.json`);
    const actualCompatibility = await readJson(response, "POST_RECOVERY_COMPATIBILITY_INVALID");
    assertDeepEqual(actualCompatibility, expectedCompatibility, "POST_RECOVERY_COMPATIBILITY_MISMATCH");
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
        productsRoute: { status: "PASS", path: productsPath },
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
