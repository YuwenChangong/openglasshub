import assert from "node:assert/strict";
import { createProductionMinimalCanaryReadAdapter } from "./qa/production-minimal-canary-http-adapter.mjs";

const originalFetch = globalThis.fetch;

async function resolveFrom(payload, slug = "approved-circle") {
  globalThis.fetch = async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  return createProductionMinimalCanaryReadAdapter({ baseUrl: "https://example.invalid", supabaseUrl: "https://example.invalid", anonKey: "test", accessToken: "test", requestTimeoutMs: 1 }).resolveCircle({ slug });
}

try {
  assert.deepEqual(await resolveFrom({ circles: [{ id: "11111111-1111-4111-8111-111111111111", slug: "approved-circle" }] }), { id: "11111111-1111-4111-8111-111111111111", slug: "approved-circle" });
  await assert.rejects(() => resolveFrom({ circles: [] }), /^Error: QA_CANARY_TARGET_NOT_FOUND$/);
  await assert.rejects(() => resolveFrom({ circles: [{ id: "11111111-1111-4111-8111-111111111111", slug: "approved-circle" }, { id: "22222222-2222-4222-8222-222222222222", slug: "approved-circle" }] }), /^Error: QA_CANARY_TARGET_AMBIGUOUS$/);
  await assert.rejects(() => resolveFrom({ circles: [{ slug: "approved-circle" }] }), /^Error: QA_CANARY_TARGET_CIRCLE_ID_MISSING$/);
  globalThis.fetch = async () => new Response("{}", { status: 503, headers: { "content-type": "application/json" } });
  await assert.rejects(() => createProductionMinimalCanaryReadAdapter({ baseUrl: "https://example.invalid", supabaseUrl: "https://example.invalid", anonKey: "test", accessToken: "test", requestTimeoutMs: 1 }).resolveCircle({ slug: "approved-circle" }), /^Error: QA_CANARY_CIRCLE_LOOKUP_FAILED$/);
  process.stdout.write("QA_CANARY_READ_ADAPTER_TARGET_DIAGNOSTICS_TEST_OK\n");
} finally {
  globalThis.fetch = originalFetch;
}
