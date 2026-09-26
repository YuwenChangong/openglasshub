import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { readCloudflareWorker } from "./verified-session-auth-a-cloudflare-read.mjs";

const accountId = "a".repeat(32);
const deploymentId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const base = `/client/v4/accounts/${accountId}/workers/scripts/openglasshub`;
const deployment = { id: deploymentId, versions: [{ version_id: versionId, percentage: 100 }], created_on: "2026-09-26T00:00:00Z" };
const version = { id: versionId,
  metadata: { created_on: "2026-09-26T00:00:00Z", source: "wrangler", source_commit: "not-attested" },
  resources: {
    bindings: [{ name: "SESSION", type: "kv_namespace", secret_value: "dummy-secret" }],
    script: { etag: "script-content-etag" },
    script_runtime: { compatibility_date: "2026-05-17", compatibility_flags: ["nodejs_compat"] },
  } };

async function serve(handler, fn) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.close(); await once(server, "close"); }
}

test("CF-01..09 fixed two GETs, single active version and redacted metadata", async () => {
  const requests = [];
  await serve((req, res) => {
    requests.push({ method: req.method, path: req.url });
    res.setHeader("content-type", "application/json");
    if (req.url === `${base}/deployments`) res.end(JSON.stringify({ success: true, result: [deployment] }));
    else if (req.url === `${base}/versions/${versionId}`) res.end(JSON.stringify({ success: true, result: version }));
    else { res.statusCode = 404; res.end("{}"); }
  }, async (origin) => {
    const result = await readCloudflareWorker({ mode: "LOCAL_TEST", origin, accountId,
      token: "dummy-token" });
    assert.equal(result.requestCount, 2);
    assert.equal(result.deploymentId, deploymentId);
    assert.equal(result.versionId, versionId);
    assert.deepEqual(result.bindingNamesAndTypes, [{ name: "SESSION", type: "kv_namespace" }]);
    assert.equal(result.scriptEtag, "script-content-etag");
    assert.equal(result.versionSource, "wrangler");
    assert.equal(result.compatibilityDate, "2026-05-17");
    assert.equal(JSON.stringify(result).includes("dummy-secret"), false);
    assert.equal(JSON.stringify(result).includes("dummy-token"), false);
    assert.equal(JSON.stringify(result).includes("not-attested"), false);
  });
  assert.deepEqual(requests, [
    { method: "GET", path: `${base}/deployments` },
    { method: "GET", path: `${base}/versions/${versionId}` },
  ]);
});

test("CF documented resource shape fails closed on missing or malformed resource fields", async () => {
  for (const badVersion of [
    { ...version, resources: undefined },
    { ...version, resources: { ...version.resources, bindings: [{ name: "SESSION", type: "?" }] } },
    { ...version, id: deploymentId },
  ]) {
    let requests = 0;
    await serve((req, res) => { requests++; res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ success: true, result: req.url.endsWith("/deployments") ? [deployment] : badVersion }));
    }, async (origin) => {
      await assert.rejects(readCloudflareWorker({ mode: "LOCAL_TEST", origin, accountId,
        token: "dummy-token" }), /AUTH_A_CF_/);
    });
    assert.equal(requests, 2);
  }
});

test("CF-05 multi-version traffic and CF-09 target drift stop before version GET", async () => {
  for (const result of [
    [{ ...deployment, versions: [{ version_id: versionId, percentage: 50 }, { version_id: deploymentId, percentage: 50 }] }],
    [{ ...deployment, versions: [{ version_id: versionId, percentage: 99 }] }],
    [{ ...deployment, script_name: "other" }],
  ]) {
    let requests = 0;
    await serve((_req, res) => { requests++; res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ success: true, result })); }, async (origin) => {
      await assert.rejects(readCloudflareWorker({ mode: "LOCAL_TEST", origin, accountId,
        token: "dummy-token" }), /AUTH_A_CF_/);
    });
    assert.equal(requests, 1);
  }
});

test("CF-10..13 failures, redirects, no retry and no token disclosure", async () => {
  for (const status of [301, 401, 403, 404, 429, 500]) {
    let requests = 0;
    await serve((_req, res) => { requests++; res.statusCode = status;
      if (status === 301) res.setHeader("location", "https://example.invalid/"); res.end("{}"); }, async (origin) => {
      await assert.rejects(readCloudflareWorker({ mode: "LOCAL_TEST", origin, accountId,
        token: "dummy-token" }), (error) => !error.message.includes("dummy-token"));
    });
    assert.equal(requests, 1);
  }
});

test("CF Production origin cannot be caller-substituted", async () => {
  await assert.rejects(readCloudflareWorker({ mode: "PRODUCTION", origin: "https://example.invalid/",
    accountId, token: "dummy-token" }), /AUTH_A_CF_ORIGIN_DENIED/);
});
