import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAuthAProductionTestCapability, getAuthAProductionAttempt } from
  "../lib/verified-session-auth-a-production-gate.mjs";
import { EXPECTED_OLD_WORKER } from "../lib/verified-session-old-worker-baseline.mjs";
import { readCloudflareWorker } from "./verified-session-auth-a-cloudflare-read.mjs";
import { runAuthAOrchestrator } from "./verified-session-auth-a-execute.mjs";
import { formatAuthAProductionReceipt } from "./verified-session-auth-a-production.mjs";

const sentinelDir = mkdtempSync(path.join(tmpdir(), "auth-a-cf-diagnostics-"));
after(() => rmSync(sentinelDir, { recursive: true, force: true }));
const accountId = "a".repeat(32);
const head = "b".repeat(40);
const packet = "c".repeat(64);
const deploymentId = "11111111-1111-4111-8111-111111111111";
const versionId = EXPECTED_OLD_WORKER.versionId;
const deployment = { id: deploymentId, versions: [{ version_id: versionId, percentage: 100 }] };
const list = (deployments = [deployment]) => ({ success: true, result: { deployments } });
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });

async function observe(id, first, second = null) {
  const authorization = { AUTH_A_EXECUTE: "1", AUTHORIZATION_ID: `auth-a-verified-session-${id}`,
    AUTHORIZED_AT_UTC: new Date().toISOString(), SOURCE_HEAD: head, PACKET_SHA256: packet,
    TARGET_CLOUDFLARE_ACCOUNT_ID: accountId };
  const binding = { authorization, observedHead: head, observedPacketSha256: packet,
    branch: "feature/auth-verified-session-v1", worktreeClean: true, sentinelDir };
  const capability = createAuthAProductionTestCapability(binding);
  let requests = 0;
  const fetchImpl = async (_url, options) => {
    requests += 1;
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "manual");
    return (requests === 1 ? first : second)(options);
  };
  const steps = { cloudflare: () => readCloudflareWorker({ mode: "PRODUCTION", capability,
    accountId, token: "fake-token-marker", fetchImpl }),
  supabase: () => { throw new Error("LATER_PROVIDER_CALLED"); },
  brevo: () => { throw new Error("LATER_PROVIDER_CALLED"); },
  database: () => { throw new Error("LATER_PROVIDER_CALLED"); } };
  const result = await runAuthAOrchestrator({ mode: "PRODUCTION", authorization,
    sourceHead: head, packetSha256: packet, ...binding, capability, steps });
  const receipt = formatAuthAProductionReceipt({ authorization, capability, result });
  assert.equal(getAuthAProductionAttempt(capability).consumed, true);
  assert.equal(getAuthAProductionAttempt(capability).counts.cloudflare, requests);
  assert.equal(getAuthAProductionAttempt(capability).counts.supabase, 0);
  assert.equal(getAuthAProductionAttempt(capability).counts.database, 0);
  assert.equal(receipt.includes("fake-token-marker"), false);
  assert.equal(receipt.includes("fake-provider-body-marker"), false);
  assert.equal(receipt.includes("stack"), false);
  return { result, receipt, requests };
}

const cases = [
  ["101", () => json({ error: "fake-provider-body-marker" }, 401), "AUTHENTICATION_OR_PERMISSION"],
  ["102", () => json({ error: "fake-provider-body-marker" }, 403), "AUTHENTICATION_OR_PERMISSION"],
  ["103", () => json({ error: "fake-provider-body-marker" }, 404), "HTTP_STATUS"],
  ["104", () => json({ error: "fake-provider-body-marker" }, 503), "HTTP_STATUS"],
  ["105", () => new Response(null, { status: 302, headers: { location: "https://example.invalid/" } }), "REDIRECT"],
  ["106", () => { throw Object.assign(new Error("fake-token-marker"), { name: "TimeoutError" }); }, "TIMEOUT"],
  ["107", () => { throw new Error("fake-token-marker"); }, "TRANSPORT"],
  ["108", () => new Response("{fake-provider-body-marker", { status: 200 }), "INVALID_JSON"],
  ["109", () => new Response("{}", { status: 200,
    headers: { "content-length": String(128 * 1024 + 1) } }), "RESPONSE_TOO_LARGE"],
  ["110", () => json({ success: false, error: "fake-provider-body-marker" }), "PROVIDER_REPORTED_FAILURE"],
  ["111", () => json({ success: true, result: null }), "DEPLOYMENT_RESPONSE_INVALID"],
  ["112", () => json({ success: true, result: {} }), "DEPLOYMENT_RESPONSE_INVALID"],
  ["113", () => json(list([])), "DEPLOYMENT_COUNT_INVALID"],
  ["114", () => json(list([deployment, deployment])), "DEPLOYMENT_COUNT_INVALID"],
  ["115", () => json(list([{ ...deployment, versions: [] }])), "DEPLOYMENT_SHAPE_INVALID"],
  ["116", () => json(list([{ ...deployment, versions: [{ version_id: versionId, percentage: "100" }] }])),
    "DEPLOYMENT_SHAPE_INVALID"],
  ["117", () => json(list([{ ...deployment, script_name: "wrong-worker" }])), "DEPLOYMENT_SHAPE_INVALID"],
];

for (const [id, first, expected] of cases) {
  test(`first Cloudflare request failure ${id} emits only ${expected}`, async () => {
    const { result, receipt, requests } = await observe(id, first);
    assert.equal(requests, 1);
    assert.equal(result.blockerClass, "CLOUDFLARE_BLOCKED");
    assert.match(receipt, /^CLOUDFLARE_FAILURE_STAGE=REQUEST_1$/m);
    assert.match(receipt, new RegExp(`^CLOUDFLARE_FAILURE_CLASS=${expected}$`, "m"));
  });
}

test("historical version drift keeps WORKER_VERSION_DRIFT", async () => {
  const other = "22222222-2222-4222-8222-222222222222";
  const { result, receipt, requests } = await observe("118", () => json(list([{ ...deployment,
    versions: [{ version_id: other, percentage: 100 }] }])));
  assert.equal(requests, 1);
  assert.equal(result.blockerClass, "WORKER_VERSION_DRIFT");
  assert.match(receipt, /^CLOUDFLARE_FAILURE_STAGE=REQUEST_1$/m);
  assert.match(receipt, /^CLOUDFLARE_FAILURE_CLASS=VERSION_DRIFT$/m);
});

test("second Cloudflare request failure is REQUEST_2 without retry", async () => {
  const { receipt, requests } = await observe("119", () => json(list()),
    () => json({ error: "fake-provider-body-marker" }, 404));
  assert.equal(requests, 2);
  assert.match(receipt, /^CLOUDFLARE_FAILURE_STAGE=REQUEST_2$/m);
  assert.match(receipt, /^CLOUDFLARE_FAILURE_CLASS=HTTP_STATUS$/m);
});
