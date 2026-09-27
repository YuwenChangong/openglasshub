import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, test } from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAuthAProductionTestCapability, getAuthAProductionAttempt,
  claimAuthAProductionAttempt, markAuthAExternalDispatch } from
  "../lib/verified-session-auth-a-production-gate.mjs";
import { EXPECTED_OLD_WORKER } from "../lib/verified-session-old-worker-baseline.mjs";
import { createAuthAProductionSteps, formatAuthAProductionReceipt } from "./verified-session-auth-a-production.mjs";
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
const sentinelDir = mkdtempSync(path.join(tmpdir(), "auth-a-production-test-"));
after(() => rmSync(sentinelDir, { recursive: true, force: true }));

function fixture(id = "003") {
  const authorization = { AUTH_A_EXECUTE: "1", AUTHORIZATION_ID: `auth-a-verified-session-${id}`,
    AUTHORIZED_AT_UTC: new Date().toISOString(), SOURCE_HEAD: head, PACKET_SHA256: packet,
    TARGET_CLOUDFLARE_ACCOUNT_ID: accountId };
  const binding = { authorization, observedHead: head, observedPacketSha256: packet,
    branch: "feature/auth-verified-session-v1", worktreeClean: true, sentinelDir };
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
      body = [{ ref: projectRef, organization_id: "fixture-organization-id", organization_slug: "test-org", status: "ACTIVE_HEALTHY",
        database: { host: `db.${projectRef}.supabase.co` } }];
    else if (target.host === "api.supabase.com" && target.pathname === "/v1/organizations/test-org")
      body = { id: "fixture-organization-id", name: "Fixture Organization", plan: "free" };
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

function fakePsql({ stderr = "", stdoutExtra = "", failAt = null, processError = false,
  spawnThrows = false, badSession = false, badTranscript = false } = {}) {
  let spawns = 0;
  let transcript = "";
  const spawnImpl = (_executable, args, options) => {
    spawns += 1;
    if (spawnThrows) throw new Error("password=forbidden");
    assert.deepEqual(args, ["-X", "-q", "-v", "ON_ERROR_STOP=1"]);
    assert.equal(options.shell, false);
    const child = new EventEmitter();
    child.pid = 4321;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end(input) {
      transcript = input;
      queueMicrotask(() => {
        if (processError) { child.emit("error", new Error("password=forbidden")); return; }
        const frame = (id, rows) => [`P9::${nonce}::BEGIN::${id}`, ...rows, `P9::${nonce}::END::${id}`];
        const lines = frame("SESSION", ["transaction_read_only,current_database,current_user,backend_pid",
          `on,postgres,postgres.${ref},777`]);
        for (let i = 1; i <= 11; i++) {
          const id = `CATALOG_${String(i).padStart(2, "0")}`;
          if (id === failAt) { lines.push(`P9::${nonce}::BEGIN::${id}`); break; }
          lines.push(...frame(id, ["fact"]));
        }
        if (!failAt && badTranscript) lines.push(`P9::${nonce}::BEGIN::HISTORY_01`);
        else if (!failAt) lines.push(...frame("HISTORY_01", ["fact"]));
        if (!failAt) lines.push(...frame("SESSION_FINAL", ["backend_pid", badSession ? "778" : "777"]));
        child.stdout.emit("data", [...lines, stdoutExtra].filter(Boolean).join("\n"));
        if (stderr) child.stderr.emit("data", stderr);
        child.emit("close", stderr || failAt ? 1 : 0);
      });
    } };
    return child;
  };
  return { spawnImpl, get spawns() { return spawns; }, get transcript() { return transcript; } };
}

async function runFixture(id, providerOptions = {}, psqlOptions = {}) {
  const { authorization, binding, capability } = fixture(id);
  const providers = fakeProviders(providerOptions);
  const psql = fakePsql(psqlOptions);
  const steps = createAuthAProductionSteps({ capability, credentials,
    fetchImpl: providers.fetchImpl, spawnImpl: psql.spawnImpl, nonce });
  const result = await runAuthAOrchestrator({ mode: "PRODUCTION", authorization,
    sourceHead: head, packetSha256: packet, ...binding, capability, steps });
  return { result, providers, psql, attempt: getAuthAProductionAttempt(capability), authorization, capability };
}

test("DB failure receipt preserves only bounded transport diagnostics", async () => {
  for (const [id, options, expectedStage, expectedClass, expectedQuery] of [
    ["030", { stderr: "password authentication failed password=fake-password token=fake-token postgresql://private.invalid/db\nDB_STAGE=PRE_V1",
      stdoutExtra: "password=stdout-secret" },
      "PSQL_EXECUTION", "AUTHENTICATION_FAILED", "SESSION_FINAL"],
    ["031", { stderr: "could not translate host name" }, "PSQL_EXECUTION", "DNS_FAILURE", "SESSION_FINAL"],
    ["032", { stderr: "ERROR: read-only SQL failed", failAt: "CATALOG_03" },
      "PSQL_EXECUTION", "TRANSPORT_UNKNOWN_CONNECTION_FAILURE", "CATALOG_03"],
    ["033", { processError: true }, "PROCESS", "P9_PSQL_PROCESS_FAILURE", "UNKNOWN"],
    ["034", { badSession: true }, "SESSION_PROOF", "P9_SESSION_PROOF_FAILURE", "UNKNOWN"],
    ["035", { badTranscript: true }, "RESULT_PARSING", "P9_RESULT_PRESERVATION_FAILURE", "UNKNOWN"],
    ["036", { spawnThrows: true }, "PROCESS", "P9_PSQL_PROCESS_FAILURE", "UNKNOWN"],
  ]) {
    const { result, authorization, capability, attempt } = await runFixture(id, {}, options);
    const receipt = formatAuthAProductionReceipt({ result, authorization, capability });
    assert.match(receipt, new RegExp(`^DB_FAILURE_STAGE=${expectedStage}$`, "m"));
    assert.match(receipt, new RegExp(`^DB_FAILURE_CLASS=${expectedClass}$`, "m"));
    assert.match(receipt, new RegExp(`^DB_FAILURE_QUERY_ID=${expectedQuery}$`, "m"));
    assert.match(receipt, /^BLOCKER_CLASS=DATABASE_BLOCKED$/m);
    assert.deepEqual(attempt.counts, { cloudflare: 2, supabase: 2, brevo: 2, database: 1 });
    for (const secret of ["fake-password", "fake-token", "stdout-secret", "postgresql://", "private.invalid"])
      assert.equal(receipt.includes(secret), false);
    assert.doesNotMatch(receipt, /^DB_STAGE=PRE_V1$/m);
  }
});

test("catalog mismatch receipt emits only allowlisted families and remains blocked", async () => {
  const { result, authorization, capability } = await runFixture("037");
  const receipt = formatAuthAProductionReceipt({ result, authorization, capability });
  assert.match(receipt, /^AUTH_A_STATUS=BLOCKED$/m);
  assert.match(receipt, /^AUTH_RELEASE_STATUS=NO_GO$/m);
  assert.match(receipt, /^DB_STAGE=UNKNOWN$/m);
  assert.match(receipt, /^CATALOG_PREFLIGHT_STATUS=FAIL$/m);
  assert.match(receipt, /^CATALOG_PRE_V1_MISMATCH_FAMILIES=(?:[A-Za-z]+(?:,[A-Za-z]+)*|none)$/m);
  const injected = formatAuthAProductionReceipt({ result: {
    ...result, catalogPreV1MismatchFamilies: "schemas,secret-raw-row" }, authorization, capability });
  assert.match(injected, /^CATALOG_PRE_V1_MISMATCH_FAMILIES=UNKNOWN$/m);
  assert.equal(injected.includes("secret-raw-row"), false);
});

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

test("wrong Cloudflare account binding blocks before the first provider request", async () => {
  const { authorization, binding, capability } = fixture("017");
  const providers = fakeProviders();
  const steps = createAuthAProductionSteps({ capability,
    credentials: { ...credentials, cloudflareAccountId: "d".repeat(32) },
    fetchImpl: providers.fetchImpl, spawnImpl: fakePsql().spawnImpl, nonce });
  const result = await runAuthAOrchestrator({ mode: "PRODUCTION", authorization,
    sourceHead: head, packetSha256: packet, ...binding, capability, steps });
  assert.equal(result.authAStatus, "BLOCKED");
  assert.equal(providers.calls.length, 0);
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
  assert.deepEqual([result.dbFailureStage, result.dbFailureClass, result.dbFailureQueryId],
    ["NONE", "NONE", "NONE"]);
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

test("failed first provider response leaves durable authorization consumed before fake fetch", async () => {
  const { authorization, binding, capability } = fixture("023");
  claimAuthAProductionAttempt(capability, binding);
  const sentinel = path.join(sentinelDir, authorization.AUTHORIZATION_ID);
  const allowedPath = `/client/v4/accounts/${accountId}/workers/scripts/openglasshub/deployments`;
  const client = createAuthAReadClient({ mode: "PRODUCTION", origin: "https://api.cloudflare.com/",
    capability, token: "dummy", headerName: "Authorization", allowedPaths: [allowedPath], maxRequests: 2,
    fetchImpl: async () => {
      assert.equal(existsSync(sentinel), true);
      return new Response("{}", { status: 503 });
    } });
  await assert.rejects(client.get(allowedPath), /AUTH_A_READ_HTTP_FAILURE/);
  assert.equal(existsSync(sentinel), true);
  assert.equal(getAuthAProductionAttempt(capability).consumed, true);
  const restarted = await import(`../lib/verified-session-auth-a-production-gate.mjs?failed=${Date.now()}`);
  const duplicate = restarted.createAuthAProductionTestCapability(binding);
  assert.throws(() => restarted.claimAuthAProductionAttempt(duplicate, binding),
    /AUTH_A_PRODUCTION_GATE_AUTHORIZATION_ALREADY_CONSUMED/);
});

test("ambiguous first provider response consumes authorization without leaking fake secrets", async () => {
  const { authorization, binding, capability } = fixture("024");
  claimAuthAProductionAttempt(capability, binding);
  const allowedPath = `/client/v4/accounts/${accountId}/workers/scripts/openglasshub/deployments`;
  const client = createAuthAReadClient({ mode: "PRODUCTION", origin: "https://api.cloudflare.com/",
    capability, token: "fake-api-key-marker", headerName: "Authorization",
    allowedPaths: [allowedPath], maxRequests: 2,
    fetchImpl: async () => new Response("{fake-api-key-marker", { status: 200 }) });
  await assert.rejects(client.get(allowedPath), (error) => {
    assert.equal(error.message, "AUTH_A_READ_JSON_INVALID");
    assert.equal(JSON.stringify(error).includes("fake-api-key-marker"), false);
    return true;
  });
  assert.equal(getAuthAProductionAttempt(capability).consumed, true);
  const restarted = await import(`../lib/verified-session-auth-a-production-gate.mjs?ambiguous=${Date.now()}`);
  const duplicate = restarted.createAuthAProductionTestCapability(binding);
  assert.throws(() => restarted.claimAuthAProductionAttempt(duplicate, binding),
    /AUTH_A_PRODUCTION_GATE_AUTHORIZATION_ALREADY_CONSUMED/);
  assert.equal(authorization.AUTHORIZATION_ID.includes("fake-api-key-marker"), false);
});
