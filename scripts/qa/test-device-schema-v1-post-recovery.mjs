import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadApprovedDeviceYaml } from "../devices/schema-v1/yaml-input.mjs";
import { normalizeCatalogYaml } from "../devices/schema-v1/normalize.mjs";
import { buildLegacyCompatibility } from "../devices/schema-v1/compatibility.mjs";
import identityMap from "../devices/schema-v1/identity-map.json" with { type: "json" };

let verifier;
try {
  verifier = await import("./device-schema-v1-post-recovery.mjs");
} catch (error) {
  const blocker = new Error("DEVICE_SCHEMA_V1_POST_RECOVERY_VERIFIER_MISSING");
  blocker.cause = error;
  throw blocker;
}

const {
  APPROVED_POST_RECOVERY_ORIGIN,
  verifySchemaV1PostRecovery,
} = verifier;

const normalized = normalizeCatalogYaml(await loadApprovedDeviceYaml("src/data/devices/openglasshub_device_data_v1.yaml"));
const xrealOne = normalized.devices.find((device) => device.identity.model === "XREAL One");
assert.ok(xrealOne);
const xrealRefreshRate = buildLegacyCompatibility(xrealOne).full_specs.display.refresh_rate_hz;
assert.equal(xrealRefreshRate, "Up to 120");
for (const page of ["src/pages/products/index.astro", "src/pages/products/[brand].astro"]) {
  assert.ok((await readFile(page, "utf8")).includes('["refresh_rate_hz", "刷新率"]'), `${page} must read the YAML-derived refresh rate field`);
}

const expectedBrandCounts = Object.freeze({
  "brilliant-labs": 1,
  "even-realities": 1,
  inmo: 2,
  meta: 1,
  rayneo: 6,
  rokid: 4,
  viture: 3,
  xreal: 6,
});

function recoveryReceipt(overrides = {}) {
  return {
    schemaVersion: "openglass-device-schema-v1-recovery-receipt-v1",
    authorizationId: "release-b-approval-10",
    targetOrigin: APPROVED_POST_RECOVERY_ORIGIN,
    expected: {
      productsRoute: "/products/",
      publishedDevices: 24,
      brandCounts: expectedBrandCounts,
      redirects: {
        "xreal-one": "/products/xreal/#product-xreal-one",
        "ray-ban-meta": "/products/meta/#product-ray-ban-meta",
        "rayneo-x2": "/products/rayneo/#product-rayneo-x2",
      },
      compatibility: {
        "xreal-one": {
          refresh_rate_hz: xrealRefreshRate,
        },
      },
    },
    ...overrides,
  };
}

function textResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers });
}

function catalogProducts() {
  const brandKeys = { XREAL: "xreal", RayNeo: "rayneo", Rokid: "rokid", VITURE: "viture", INMO: "inmo", "Brilliant Labs": "brilliant-labs", "Even Realities": "even-realities", "Ray-Ban / Meta": "meta" };
  return identityMap.mappings.map((mapping) => ({
    slug: mapping.slug,
    brandKey: brandKeys[mapping.yamlBrand],
    compareValues: { refresh_rate_hz: xrealRefreshRate },
  }));
}

function productsHtml({ products = null, compatibilityOverride = {} } = {}) {
  const compareProducts = products ?? catalogProducts();
  for (const product of compareProducts) {
    if (compatibilityOverride[product.slug]) product.compareValues = compatibilityOverride[product.slug];
  }
  const brands = Object.entries(expectedBrandCounts).map(([key, productCount]) => ({ key, productCount }));
  const modules = brands.map(({ key }) => `<a data-brand-module href="/products/${key}/"></a>`).join("");
  return `<main id="products-brand-grid">${modules}</main><script id="products-brand-data" type="application/json">${JSON.stringify({ brands, compareProducts })}</script>`;
}

function createFetch({ statusOverride = {}, redirectOverride = {}, compatibilityOverride = {}, products = null } = {}) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ url, options });
    assert.equal(parsed.protocol, "https:");
    assert.equal(parsed.origin, APPROVED_POST_RECOVERY_ORIGIN);
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "manual");
    assert.equal(options.credentials, "omit");
    if (statusOverride[parsed.pathname]) return textResponse("boom", statusOverride[parsed.pathname]);
    if (parsed.pathname === "/products/") {
      return textResponse(productsHtml({ products, compatibilityOverride }));
    }
    if (parsed.pathname.startsWith("/devices/")) {
      const slug = parsed.pathname.split("/").filter(Boolean).at(-1);
      return textResponse("", 302, { location: redirectOverride[slug] ?? recoveryReceipt().expected.redirects[slug] });
    }
    return textResponse("not found", 404);
  };
  return { fetch, calls };
}

assert.equal(typeof verifySchemaV1PostRecovery, "function");
assert.equal(APPROVED_POST_RECOVERY_ORIGIN, "https://openglasshub.ogh.workers.dev");

await assert.rejects(
  () => verifySchemaV1PostRecovery({ receipt: recoveryReceipt({ targetOrigin: "http://openglasshub.ogh.workers.dev" }), fetch: createFetch().fetch }),
  /POST_RECOVERY_HTTPS_REQUIRED/,
  "non-HTTPS targets are rejected before route verification",
);
await assert.rejects(
  () => verifySchemaV1PostRecovery({ receipt: recoveryReceipt({ targetOrigin: "https://evil.example" }), fetch: createFetch().fetch }),
  /POST_RECOVERY_APPROVED_HOST_REQUIRED/,
  "unapproved hosts are rejected before route verification",
);

const successFetch = createFetch();
const verified = await verifySchemaV1PostRecovery({ receipt: recoveryReceipt(), fetch: successFetch.fetch });
assert.equal(verified.postRecovery.status, "PASS");
assert.deepEqual(verified.postRecovery.results.productsRoute, { status: "PASS", path: "/products/", publishedDevices: 24 });
assert.deepEqual(verified.postRecovery.results.brandCounts, { status: "PASS", counts: expectedBrandCounts });
assert.equal(verified.postRecovery.results.deviceRedirects.status, "PASS");
assert.equal(verified.postRecovery.results.yamlCompatibility.status, "PASS");
assert.equal(verified.postRecovery.sideEffects.qaProdRuns, 0);
assert.equal(verified.postRecovery.sideEffects.productionDbWrites, 0);
assert.equal(successFetch.calls.every((call) => call.options.method === "GET"), true, "post-recovery verification uses only read-only GET requests");
assert.equal(successFetch.calls.some((call) => new URL(call.url).pathname.endsWith(".json")), false, "only existing public routes are queried");

await assert.rejects(
  () => verifySchemaV1PostRecovery({ receipt: recoveryReceipt(), fetch: createFetch({ products: [] }).fetch }),
  /POST_RECOVERY_PUBLISHED_DEVICES_MISMATCH/,
  "a successful HTTP status without the recovered catalog must fail",
);
const wrongCatalog = catalogProducts();
wrongCatalog[1] = { ...wrongCatalog[1], slug: "xreal-unapproved" };
await assert.rejects(
  () => verifySchemaV1PostRecovery({ receipt: recoveryReceipt(), fetch: createFetch({ products: wrongCatalog }).fetch }),
  /POST_RECOVERY_DEVICE_SLUG_SET_MISMATCH/,
  "the full recovered slug set must match approved identities",
);

await assert.rejects(
  () => verifySchemaV1PostRecovery({ receipt: recoveryReceipt(), fetch: createFetch({ statusOverride: { "/products/": 500 } }).fetch }),
  /POST_RECOVERY_UNEXPECTED_500/,
  "unexpected HTTP 500 is classified deterministically",
);
await assert.rejects(
  () => verifySchemaV1PostRecovery({ receipt: recoveryReceipt(), fetch: createFetch({ redirectOverride: { "xreal-one": "/products/" } }).fetch }),
  /POST_RECOVERY_DEVICE_REDIRECT_MISMATCH/,
  "representative device redirects must land on the expected product anchor",
);
await assert.rejects(
  () => verifySchemaV1PostRecovery({
    receipt: recoveryReceipt(),
    fetch: createFetch({ compatibilityOverride: { "xreal-one": { keySpecs: [], fullSpecs: {} } } }).fetch,
  }),
  /POST_RECOVERY_COMPATIBILITY_MISMATCH/,
  "compatibility output must match the YAML-derived expected surface",
);

console.log(`DEVICE_SCHEMA_V1_POST_RECOVERY_OK routes=${Object.keys(verified.postRecovery.results).length}`);
