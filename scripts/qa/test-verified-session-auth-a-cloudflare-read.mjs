import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { MAX_CF_VERSION_BODY_BYTES, readCloudflareWorker } from "./verified-session-auth-a-cloudflare-read.mjs";
import { createAuthAReadClient } from "./verified-session-auth-a-read-client.mjs";
import { canonicalWorkerArtifact } from "../lib/verified-session-worker-artifact.mjs";

const accountId = "a".repeat(32);
const deploymentId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const base = `/client/v4/accounts/${accountId}/workers/scripts/openglasshub`;
const versionPath = `/client/v4/accounts/${accountId}/workers/workers/openglasshub/versions/${versionId}?include=modules`;
const deployment = { id: deploymentId, versions: [{ version_id: versionId, percentage: 100 }] };
const version = { id: versionId, main_module: "index.js", modules: [
  { name: "index.js", content_type: "application/javascript", content_base64: Buffer.from("export default 1").toString("base64") },
  { name: "other.js", content_type: "application/javascript", content_base64: Buffer.from("export const n = 2").toString("base64") },
], metadata: { created_on: "2026-09-26T00:00:00Z", source: "wrangler", source_commit: "untrusted" },
resources: { bindings: [{ name: "SESSION", type: "kv_namespace", secret_value: "dummy-secret" }],
  script_runtime: { compatibility_date: "2026-05-17", compatibility_flags: ["nodejs_compat"] },
  assets: { binding: "ASSETS", run_worker_first: true, router_config: { has_user_worker: true } } } };

async function serve(first, second, fn) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url });
    const reply = req.url === `${base}/deployments` ? first : req.url === versionPath ? second : { status: 404, body: {} };
    res.statusCode = reply?.status ?? 200;
    if (reply?.location) res.setHeader("location", reply.location);
    if (reply?.length) res.setHeader("content-length", reply.length);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(reply?.body ?? reply));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { return await fn(`http://127.0.0.1:${server.address().port}`, requests); }
  finally { server.close(); await once(server, "close"); }
}

const list = (deployments = [deployment]) => ({ success: true, result: { deployments } });
const detail = (value = version) => ({ success: true, result: value });
const options = (origin) => ({ mode: "LOCAL_TEST", origin, accountId, token: "dummy-token" });

test("CF-01,04,05,06 exact deployment-derived active version and only two GETs", async () => {
  await serve(list(), detail(), async (origin, requests) => {
    const result = await readCloudflareWorker(options(origin));
    assert.equal(result.deploymentId, deploymentId);
    assert.equal(result.versionId, versionId);
    assert.equal(result.requestCount, 2);
    assert.deepEqual(requests, [{ method: "GET", path: `${base}/deployments` },
      { method: "GET", path: versionPath }]);
    assert.ok(!requests.some((entry) => entry.path.includes("latest")));
  });
});

test("CF-02,03 wrong deployment shape or split stops before second request", async () => {
  for (const first of [
    { success: true, result: [deployment] },
    list([{ ...deployment, versions: [{ version_id: versionId, percentage: 50 },
      { version_id: deploymentId, percentage: 50 }] }]),
    list([{ ...deployment, versions: [{ version_id: versionId, percentage: 99 }] }]),
    list([]),
  ]) await serve(first, detail(), async (origin, requests) => {
    await assert.rejects(readCloudflareWorker(options(origin)), /AUTH_A_CF_/);
    assert.equal(requests.length, 1);
  });
});

test("CF-07..10 version drift, missing modules, malformed bytes and duplicates fail closed", async () => {
  for (const bad of [
    { ...version, id: deploymentId },
    { ...version, modules: undefined },
    { ...version, modules: [{ ...version.modules[0], content_base64: "not-base64!" }] },
    { ...version, modules: [version.modules[0], version.modules[0]] },
  ]) await serve(list(), detail(bad), async (origin, requests) => {
    await assert.rejects(readCloudflareWorker(options(origin)), /AUTH_A_CF_/);
    assert.equal(requests.length, 2);
  });
});

test("CF-11..16 canonical artifact is ordered, exact, config-bound and redacted", async () => {
  const first = canonicalWorkerArtifact({ mainModule: version.main_module, modules: version.modules,
    compatibilityDate: version.resources.script_runtime.compatibility_date,
    compatibilityFlags: version.resources.script_runtime.compatibility_flags,
    bindings: version.resources.bindings, assets: version.resources.assets });
  const reordered = canonicalWorkerArtifact({ mainModule: version.main_module, modules: [...version.modules].reverse(),
    compatibilityDate: version.resources.script_runtime.compatibility_date,
    compatibilityFlags: version.resources.script_runtime.compatibility_flags,
    bindings: version.resources.bindings, assets: version.resources.assets });
  assert.deepEqual(reordered, first);
  const changed = canonicalWorkerArtifact({ mainModule: version.main_module,
    modules: [{ ...version.modules[0], content_base64: Buffer.from("export default 2").toString("base64") }, version.modules[1]],
    compatibilityDate: version.resources.script_runtime.compatibility_date,
    compatibilityFlags: version.resources.script_runtime.compatibility_flags,
    bindings: version.resources.bindings, assets: version.resources.assets });
  assert.notEqual(changed.artifactSha256, first.artifactSha256);
  const configChanged = canonicalWorkerArtifact({ mainModule: version.main_module, modules: version.modules,
    compatibilityDate: "2026-05-18", compatibilityFlags: ["nodejs_compat"],
    bindings: version.resources.bindings, assets: version.resources.assets });
  assert.notEqual(configChanged.configSha256, first.configSha256);
  const bindingChanged = canonicalWorkerArtifact({ mainModule: version.main_module, modules: version.modules,
    compatibilityDate: "2026-05-17", compatibilityFlags: ["nodejs_compat"],
    bindings: [...version.resources.bindings, { name: "EXTRA", type: "secret_text", value: "hidden" }],
    assets: version.resources.assets });
  assert.notEqual(bindingChanged.configSha256, first.configSha256);
  await serve(list(), detail(), async (origin) => {
    const result = await readCloudflareWorker(options(origin));
    assert.equal(result.artifactSha256, first.artifactSha256);
    assert.equal(result.configSha256, first.configSha256);
    assert.equal(JSON.stringify(result).includes("dummy-secret"), false);
    assert.equal(JSON.stringify(result).includes("export default"), false);
    assert.equal(JSON.stringify(result).includes("untrusted"), false);
  });
});

test("CF-17..19 body cap, redirect and third-request budget deny without retry", async () => {
  assert.equal(MAX_CF_VERSION_BODY_BYTES, 10_250_096);
  await serve(list(), { length: MAX_CF_VERSION_BODY_BYTES + 1, body: {} }, async (origin, requests) => {
    await assert.rejects(readCloudflareWorker(options(origin)), /AUTH_A_READ_BODY_TOO_LARGE/);
    assert.equal(requests.length, 2);
  });
  await serve({ status: 302, location: "https://example.invalid/", body: {} }, detail(), async (origin, requests) => {
    await assert.rejects(readCloudflareWorker(options(origin)), /AUTH_A_READ_HTTP_FAILURE/);
    assert.equal(requests.length, 1);
  });
  const client = createAuthAReadClient({ mode: "LOCAL_TEST", origin: "http://127.0.0.1/",
    token: "dummy", headerName: "Authorization", allowedPaths: ["/one"], maxRequests: 2,
    fetchImpl: async () => new Response("{}", { status: 200 }) });
  await client.get("/one"); await client.get("/one");
  await assert.rejects(client.get("/one"), /AUTH_A_READ_BUDGET_EXCEEDED/);
});

test("CF Production dispatch remains hard disabled", async () => {
  await assert.rejects(readCloudflareWorker({ mode: "PRODUCTION", origin: "https://example.invalid/",
    accountId, token: "dummy" }), /AUTH_A_CF_ORIGIN_DENIED/);
});
