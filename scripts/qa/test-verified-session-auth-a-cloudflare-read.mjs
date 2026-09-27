import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { readCloudflareWorker } from "./verified-session-auth-a-cloudflare-read.mjs";
import { createAuthAReadClient } from "./verified-session-auth-a-read-client.mjs";
import { EXPECTED_OLD_WORKER } from "../lib/verified-session-old-worker-baseline.mjs";

const accountId = "a".repeat(32);
const deploymentId = "11111111-1111-4111-8111-111111111111";
const versionId = EXPECTED_OLD_WORKER.versionId;
const base = `/client/v4/accounts/${accountId}/workers/scripts/openglasshub`;
const versionPath = `${base}/versions/${versionId}`;
const deployment = { id: deploymentId, versions: [{ version_id: versionId, percentage: 100 }] };
const version = { id: versionId,
  metadata: { created_on: "2026-09-26T00:00:00Z", source: "wrangler", source_commit: "untrusted" },
  resources: { bindings: [{ name: "SESSION", type: "kv_namespace", secret_value: "dummy-secret" }],
    script_runtime: { compatibility_date: "2026-05-17", compatibility_flags: ["nodejs_compat"] } } };

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

test("WID-01,09,10,11 historical active version uses exactly two metadata GETs", async () => {
  await serve(list(), detail(), async (origin, requests) => {
    const result = await readCloudflareWorker(options(origin));
    assert.equal(result.deploymentId, deploymentId);
    assert.equal(result.activeVersionId, versionId);
    assert.equal(result.versionId, versionId);
    assert.equal(result.requestCount, 2);
    assert.deepEqual(requests, [{ method: "GET", path: `${base}/deployments` },
      { method: "GET", path: versionPath }]);
    assert.ok(requests.every((request) => !request.path.includes("include=modules")));
  });
});

test("WID-02,03 a different active version blocks before CF-2", async () => {
  for (const other of [versionId.slice(0, -1) + "b", "22222222-2222-4222-8222-222222222222"]) {
    await serve(list([{ ...deployment, versions: [{ version_id: other, percentage: 100 }] }]),
      detail(), async (origin, requests) => {
        await assert.rejects(readCloudflareWorker(options(origin)), /AUTH_A_CF_VERSION_DRIFT/);
        assert.equal(requests.length, 1);
      });
  }
});

test("WID-04,05 missing, split, malformed and 99% deployment block", async () => {
  for (const first of [
    { success: true, result: [deployment] }, list([]),
    list([{ ...deployment, versions: [{ version_id: versionId, percentage: 50 },
      { version_id: deploymentId, percentage: 50 }] }]),
    list([{ ...deployment, versions: [{ version_id: versionId, percentage: 99 }] }]),
    list([{ ...deployment, versions: [{ version_id: "invalid", percentage: 100 }] }]),
  ]) await serve(first, detail(), async (origin, requests) => {
    await assert.rejects(readCloudflareWorker(options(origin)), /AUTH_A_CF_/);
    assert.equal(requests.length, 1);
  });
});

test("WID-06 CF-2 version drift and ambiguous metadata block", async () => {
  for (const bad of [{ ...version, id: deploymentId },
    { ...version, resources: undefined },
    { ...version, resources: { ...version.resources, bindings: [version.resources.bindings[0],
      version.resources.bindings[0]] } }]) {
    await serve(list(), detail(bad), async (origin, requests) => {
      await assert.rejects(readCloudflareWorker(options(origin)), /AUTH_A_CF_/);
      assert.equal(requests.length, 2);
    });
  }
});

test("WID-14 result retains metadata but no secret, source claim or raw response", async () => {
  await serve(list(), detail(), async (origin) => {
    const result = await readCloudflareWorker(options(origin));
    assert.deepEqual(result.bindingNamesAndTypes, [{ name: "SESSION", type: "kv_namespace" }]);
    assert.equal(result.compatibilityDate, "2026-05-17");
    assert.equal(JSON.stringify(result).includes("dummy-secret"), false);
    assert.equal(JSON.stringify(result).includes("untrusted"), false);
    assert.equal("modules" in result, false);
    assert.equal("sourceCommit" in result, false);
  });
});

test("WID-11,12 body cap, redirect and third-request budget deny without retry", async () => {
  await serve(list(), { length: 128 * 1024 + 1, body: {} }, async (origin, requests) => {
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

test("WID-13 Production origin substitution remains denied", async () => {
  await assert.rejects(readCloudflareWorker({ mode: "PRODUCTION", origin: "https://example.invalid/",
    accountId, token: "dummy" }), /AUTH_A_CF_ORIGIN_DENIED/);
});
