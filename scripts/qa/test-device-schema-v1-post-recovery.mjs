import assert from "node:assert/strict";

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
      brandCounts: expectedBrandCounts,
      redirects: {
        "xreal-one": "/products/xreal/#product-xreal-one",
        "ray-ban-meta": "/products/meta/#product-ray-ban-meta",
        "rayneo-x2": "/products/rayneo/#product-rayneo-x2",
      },
      compatibility: {
        "xreal-one": {
          keySpecs: [{ field: "display.refresh_rate", value: "120Hz" }],
          fullSpecs: { display: { refresh_rate: "120Hz" } },
        },
      },
    },
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers });
}

function createFetch({ statusOverride = {}, redirectOverride = {}, compatibilityOverride = {} } = {}) {
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
    if (parsed.pathname === "/products/") return textResponse("<main id=\"products-brand-grid\">产品</main>");
    if (parsed.pathname === "/products/post-recovery.json") return jsonResponse({ brandCounts: expectedBrandCounts });
    if (parsed.pathname.startsWith("/devices/")) {
      const slug = parsed.pathname.split("/").filter(Boolean).at(-1);
      return textResponse("", 302, { location: redirectOverride[slug] ?? recoveryReceipt().expected.redirects[slug] });
    }
    if (parsed.pathname === "/products/compatibility/xreal-one.json") {
      return jsonResponse(compatibilityOverride["xreal-one"] ?? recoveryReceipt().expected.compatibility["xreal-one"]);
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
assert.deepEqual(verified.postRecovery.results.productsRoute, { status: "PASS", path: "/products/" });
assert.deepEqual(verified.postRecovery.results.brandCounts, { status: "PASS", counts: expectedBrandCounts });
assert.equal(verified.postRecovery.results.deviceRedirects.status, "PASS");
assert.equal(verified.postRecovery.results.yamlCompatibility.status, "PASS");
assert.equal(verified.postRecovery.sideEffects.qaProdRuns, 0);
assert.equal(verified.postRecovery.sideEffects.productionDbWrites, 0);
assert.equal(successFetch.calls.every((call) => call.options.method === "GET"), true, "post-recovery verification uses only read-only GET requests");

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
