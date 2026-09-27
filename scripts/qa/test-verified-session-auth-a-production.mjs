import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createAuthAProductionTestCapability, getAuthAProductionAttempt,
  claimAuthAProductionAttempt, markAuthAExternalDispatch } from
  "../lib/verified-session-auth-a-production-gate.mjs";
import { EXPECTED_OLD_WORKER } from "../lib/verified-session-old-worker-baseline.mjs";
import { createAuthAProductionSteps } from "./verified-session-auth-a-production.mjs";
import { runAuthAOrchestrator } from "./verified-session-auth-a-execute.mjs";
import { createAuthAReadClient } from "./verified-session-auth-a-read-client.mjs";
import { runAuthADbCaptureInternal } from "./verified-session-auth-a-db-capture.mjs";
import { readFileSync } from "node:fs";

globalThis.fetch = async () => { throw new Error("REAL_NETWORK_FORBIDDEN"); };

const head = "a".repeat(40);
const packet = "b".repeat(64);
const accountId = "c".repeat(32);
const ref = "xcbnxzjlsvtgzixurcof";
const dsn = `postgresql://postgres.${ref}:dummy-password@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres`;
const credentials = { cloudflareToken: "dummy-cloudflare", cloudflareAccountId: accountId,
  supabaseToken: "dummy-supabase", brevoToken: "dummy-brevo",
  brevoSender: "expected@example.test", databaseUrl: dsn };
const catalog = readFileSync("docs/ops/verified-session-v1-hosted-catalog-preflight.sql", "utf8");
const history = readFileSync("docs/ops/p9-migration-history-rows-read-only.sql", "utf8");
const nonce = "a".repeat(32);

function fixture(id = "003") {
  const authorization = { AUTH_A_EXECUTE: "1", AUTHORIZATION_ID: `auth-a-verified-session-${id}`,
    AUTHORIZED_AT_UTC: new Date().toISOString(), SOURCE_HEAD: head, PACKET_SHA256: packet };
  const binding = { authorization, observedHead: head, observedPacketSha256: packet,
    branch: "feature/auth-verified-session-v1", worktreeClean: true };
  return { authorization, binding, capability: createAuthAProductionTestCapability(binding) };
}

function fakeProviders({ version = EXPECTED_OLD_WORKER.versionId, projectRef = ref,
  brevoReady = true, relayEnabled = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const target = new URL(url);
    calls.push({ host: target.host, path: target.pathname + target.search, method: options.method });
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "manual");
    let body;
    if (target.host === "api.cloudflare.com" && target.pathname.endsWith("/deployments"))
      body = { success: true, result: { deployments: [{ id: "11111111-1111-4111-8111-111111111111",
        versions: [{ version_id: version, percentage: 100 }] }] } };
    else if (target.host === "api.cloudflare.com" && target.pathname.endsWith(`/versions/${version}`))
      body = { success: true, result: { id: version, metadata: {}, resources: {
        script_runtime: { compatibility_date: "2026-05-17", compatibility_flags: ["nodejs_compat"] },
        bindings: [] } } };
    else if (target.host === "api.supabase.com" && target.pathname === "/v1/projects")
      body = [{ ref: projectRef, organization_slug: "test-org", status: "ACTIVE_HEALTHY",
        database: { host: `db.${projectRef}.supabase.co` } }];
    else if (target.host === "api.supabase.com" && target.pathname === "/v1/organizations/test-org")
      body = { slug: "test-org", plan: "free" };
    else if (target.host === "api.brevo.com" && target.pathname === "/v3/account")
      body = { plan: [{ type: brevoReady ? "free" : "paid", creditsType: "sendLimit", credits: 1 }],
        relay: { enabled: relayEnabled } };
    else if (target.host === "api.brevo.com" && target.pathname === "/v3/senders")
      body = { senders: [{ email: "expected@example.test", active: brevoReady }] };
    else throw new Error("UNEXPECTED_FAKE_REQUEST");
    return new Response(JSON.stringify(body), { status: 200,
      headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

function fakePsql() {
  let spawns = 0;
  let transcript = "";
  const spawnImpl = (_executable, args, options) => {
    spawns += 1;
    assert.deepEqual(args, ["-X", "-q", "-v", "ON_ERROR_STOP=1"]);
    assert.equal(options.shell, false);
    const child = new EventEmitter();
    child.pid = 4321;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end(input) {
      transcript = input;
      queueMicrotask(() => {
        const frame = (id, rows) => [`P9::${nonce}::BEGIN::${id}`, ...rows, `P9::${nonce}::END::${id}`];
        const lines = frame("SESSION", ["transaction_read_only,current_database,current_user,backend_pid",
          `on,postgres,postgres.${ref},777`]);
        for (let i = 1; i <= 11; i++) lines.push(...frame(`CATALOG_${String(i).padStart(2, "0")}`, ["fact"]));
        lines.push(...frame("HISTORY_01", ["fact"]));
        lines.push(...frame("SESSION_FINAL", ["backend_pid", "777"]));
        child.stdout.emit("data", lines.join("\n"));
        child.emit("close", 0);
      });
    } };
    return child;
  };
  return { spawnImpl, get spawns() { return spawns; }, get transcript() { return transcript; } };
}

async function runFixture(id, providerOptions = {}) {
  const { authorization, binding, capability } = fixture(id);
  const providers = fakeProviders(providerOptions);
  const psql = fakePsql();
  const steps = createAuthAProductionSteps({ capability, credentials,
    fetchImpl: providers.fetchImpl, spawnImpl: psql.spawnImpl, nonce });
  const result = await runAuthAOrchestrator({ mode: "PRODUCTION", authorization,
    sourceHead: head, packetSha256: packet, ...binding, capability, steps });
  return { result, providers, psql, attempt: getAuthAProductionAttempt(capability) };
}

test("PROD-01..07 missing/invalid capability, 001/002 and drift stop before reads", async () => {
  for (const id of ["001", "002"]) {
    const authorization = { AUTH_A_EXECUTE: "1", AUTHORIZATION_ID: `auth-a-verified-session-${id}`,
      AUTHORIZED_AT_UTC: new Date().toISOString(), SOURCE_HEAD: head, PACKET_SHA256: packet };
    await assert.rejects(runAuthAOrchestrator({ mode: "PRODUCTION", authorization,
      sourceHead: head, observedHead: head, packetSha256: packet, observedPacketSha256: packet,
      worktreeClean: true, branch: "feature/auth-verified-session-v1", steps: {
        cloudflare: () => { throw new Error("DISPATCHED"); }, supabase() {}, brevo() {}, database() {} } }),
    /AUTH_A_ORCHESTRATOR_/);
  }
  const { authorization, binding } = fixture("004");
  let calls = 0;
  const steps = { cloudflare: () => { calls++; }, supabase() {}, brevo() {}, database() {} };
  for (const change of [{}, { observedHead: "c".repeat(40) },
    { observedPacketSha256: "d".repeat(64) }, { worktreeClean: false }]) {
    await assert.rejects(runAuthAOrchestrator({ mode: "PRODUCTION", authorization,
      sourceHead: head, packetSha256: packet, ...binding, ...change, steps }), /AUTH_A_/);
    assert.equal(calls, 0);
  }
});

test("missing credentials and unsafe DSN block before any provider dispatch", () => {
  const { capability } = fixture("013");
  assert.throws(() => createAuthAProductionSteps({ capability,
    credentials: { ...credentials, brevoToken: "" },
    fetchImpl: () => { throw new Error("DISPATCHED"); } }), /AUTH_A_PRODUCTION_PREFLIGHT_BLOCKED/);
  assert.throws(() => createAuthAProductionSteps({ capability,
    credentials: { ...credentials, databaseUrl: dsn.replace("pooler.supabase.com", "wrong.invalid") },
    fetchImpl: () => { throw new Error("DISPATCHED"); } }), /P9_TARGET_VALIDATION_FAILED/);
  assert.equal(getAuthAProductionAttempt(capability).consumed, false);
});

test("Production rejects fabricated step counts without tracked dispatch", async () => {
  const { authorization, binding, capability } = fixture("014");
  let laterCalled = false;
  const result = await runAuthAOrchestrator({ mode: "PRODUCTION", authorization,
    sourceHead: head, packetSha256: packet, ...binding, capability, steps: {
      cloudflare: async () => ({ requestCount: 2, workerName: EXPECTED_OLD_WORKER.workerName,
        activeVersionId: EXPECTED_OLD_WORKER.versionId, versionId: EXPECTED_OLD_WORKER.versionId }),
      supabase: async () => { laterCalled = true; },
      brevo: async () => { laterCalled = true; },
      database: async () => { laterCalled = true; },
    } });
  assert.equal(result.authAStatus, "BLOCKED");
  assert.equal(laterCalled, false);
  assert.equal(getAuthAProductionAttempt(capability).consumed, false);
});

test("PROD-08,12,13 valid dummy fixture uses 2/2/2/1 and read-only P9", async () => {
  const { result, providers, psql, attempt } = await runFixture("003");
  assert.deepEqual(providers.calls.map(({ host }) => host), ["api.cloudflare.com", "api.cloudflare.com",
    "api.supabase.com", "api.supabase.com", "api.brevo.com", "api.brevo.com"]);
  assert.equal(psql.spawns, 1);
  assert.match(psql.transcript, /BEGIN READ ONLY;/);
  assert.match(psql.transcript, /ROLLBACK;/);
  assert.ok(psql.transcript.indexOf("CATALOG_11") < psql.transcript.indexOf("HISTORY_01"));
  assert.deepEqual(attempt.counts, { cloudflare: 2, supabase: 2, brevo: 2, database: 1 });
  assert.equal(attempt.consumed, true);
  assert.equal(result.authReleaseStatus, "NO_GO");
  assert.equal(result.freeCapacityStatus, "UNKNOWN");
  assert.equal(result.capacityGate, "BLOCKED_BEFORE_AUTH_B");
  assert.equal(JSON.stringify(result).includes("dummy-password"), false);
});

test("PROD-09..11 provider drift stops before later providers or DB", async () => {
  const version = await runFixture("005", { version: "22222222-2222-4222-8222-222222222222" });
  assert.deepEqual(version.attempt.counts, { cloudflare: 1, supabase: 0, brevo: 0, database: 0 });
  assert.equal(version.result.deployedWorkerIdentityDrift, true);
  const target = await runFixture("006", { projectRef: "other-project" });
  assert.deepEqual(target.attempt.counts, { cloudflare: 2, supabase: 1, brevo: 0, database: 0 });
  const brevo = await runFixture("007", { brevoReady: false });
  assert.deepEqual(brevo.attempt.counts, { cloudflare: 2, supabase: 2, brevo: 2, database: 0 });
  const relay = await runFixture("011", { relayEnabled: false });
  assert.deepEqual(relay.attempt.counts, { cloudflare: 2, supabase: 2, brevo: 2, database: 0 });
});

test("Production client denies arbitrary origin, no capability, redirects and third GET", async () => {
  assert.throws(() => createAuthAReadClient({ mode: "PRODUCTION", origin: "https://example.invalid/",
    token: "dummy", headerName: "Authorization", allowedPaths: ["/one"], maxRequests: 2 }),
  /AUTH_A_READ_ORIGIN_INVALID/);
  assert.throws(() => createAuthAReadClient({ mode: "PRODUCTION", origin: "https://api.cloudflare.com/",
    token: "dummy", headerName: "Authorization", allowedPaths: ["/one"], maxRequests: 2 }),
  /AUTH_A_PRODUCTION_GATE_CAPABILITY_INVALID/);
  const { capability, binding } = fixture("008");
  claimAuthAProductionAttempt(capability, binding);
  const client = createAuthAReadClient({ mode: "PRODUCTION", origin: "https://api.cloudflare.com/",
    capability, token: "dummy", headerName: "Authorization", allowedPaths: ["/one"], maxRequests: 2,
    fetchImpl: async () => new Response("{}", { status: 200 }) });
  assert.equal("post" in client, false);
  await assert.rejects(client.get("/one"), /AUTH_A_READ_PATH_DENIED/);
  const allowedPath = `/client/v4/accounts/${accountId}/workers/scripts/openglasshub/deployments`;
  const allowed = createAuthAReadClient({ mode: "PRODUCTION", origin: "https://api.cloudflare.com/",
    capability, token: "dummy", headerName: "Authorization", allowedPaths: [allowedPath], maxRequests: 2,
    fetchImpl: async () => new Response("{}", { status: 200 }) });
  await allowed.get(allowedPath); await allowed.get(allowedPath);
  await assert.rejects(allowed.get(allowedPath), /AUTH_A_READ_BUDGET_EXCEEDED/);
  assert.equal(getAuthAProductionAttempt(capability).counts.cloudflare, 2);
  const denied = fixture("009");
  claimAuthAProductionAttempt(denied.capability, denied.binding);
  const redirectClient = createAuthAReadClient({ mode: "PRODUCTION", origin: "https://api.cloudflare.com/",
    capability: denied.capability, token: "dummy", headerName: "Authorization",
    allowedPaths: [allowedPath], maxRequests: 2,
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://example.invalid/" } }) });
  await assert.rejects(redirectClient.get(allowedPath), /AUTH_A_READ_HTTP_FAILURE/);
  assert.equal(getAuthAProductionAttempt(denied.capability).consumed, true);
});

test("Production DB target rejects wrong host/project/user before fake spawn", async () => {
  const { capability, binding } = fixture("010");
  claimAuthAProductionAttempt(capability, binding);
  for (const provider of ["cloudflare", "cloudflare", "supabase", "supabase", "brevo", "brevo"])
    markAuthAExternalDispatch(capability, provider);
  const psql = fakePsql();
  for (const wrong of [
    dsn.replace("aws-1-ap-northeast-1.pooler.supabase.com", "wrong.invalid"),
    dsn.replace(`postgres.${ref}`, "postgres.otherproject"),
    dsn.replace(`postgres.${ref}`, "postgres"),
  ]) await assert.rejects(runAuthADbCaptureInternal({ mode: "PRODUCTION", capability,
    dsn: wrong, catalog, history, spawnImpl: psql.spawnImpl, nonce }), /P9_TARGET_VALIDATION_FAILED/);
  assert.equal(psql.spawns, 0);
  assert.equal(getAuthAProductionAttempt(capability).counts.database, 0);
});

test("Production DB shared proof preserves target and refuses a second process", async () => {
  const { capability, binding } = fixture("012");
  claimAuthAProductionAttempt(capability, binding);
  for (const provider of ["cloudflare", "cloudflare", "supabase", "supabase", "brevo", "brevo"])
    markAuthAExternalDispatch(capability, provider);
  const psql = fakePsql();
  const options = { mode: "PRODUCTION", capability, dsn, catalog, history,
    spawnImpl: psql.spawnImpl, nonce };
  const first = await runAuthADbCaptureInternal(options);
  assert.equal(first.transportProof.targetClass, "PRODUCTION");
  assert.equal(first.transportProof.connectionAttempts, 1);
  assert.equal(first.transportProof.queryCount, 12);
  assert.equal(first.transportProof.transactionReadOnly, true);
  assert.equal(first.transportProof.sameBackend, true);
  assert.equal(first.transportProof.rollbackMode, "EXPLICIT_ROLLBACK");
  await assert.rejects(runAuthADbCaptureInternal(options), /AUTH_A_PRODUCTION_GATE_DISPATCH_ORDER_OR_BUDGET/);
  assert.equal(psql.spawns, 1);
});
