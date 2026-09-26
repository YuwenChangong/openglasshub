import assert from "node:assert/strict";
import { test } from "node:test";
import { runAuthAOrchestrator } from "./verified-session-auth-a-execute.mjs";

const sourceHead = "a".repeat(40);
const packetSha256 = "b".repeat(64);
const authorization = { AUTH_A_EXECUTE: "1", AUTHORIZATION_ID: "auth-a-verified-session-002",
  AUTHORIZED_AT_UTC: "2026-09-26T00:00:00.000Z", SOURCE_HEAD: sourceHead,
  PACKET_SHA256: packetSha256 };
const base = { mode: "LOCAL_TEST", authorization, sourceHead, observedHead: sourceHead,
  packetSha256, observedPacketSha256: packetSha256, worktreeClean: true };

function fixture() {
  const calls = [];
  const queryResults = [...Array.from({ length: 11 }, (_, index) => ({
    queryId: `CATALOG_${String(index + 1).padStart(2, "0")}`, completed: true,
    fields: ["observed"], rows: [], rowCount: 0 })),
  { queryId: "HISTORY_01", completed: true,
    fields: ["version", "name", "created_by", "idempotency_key", "statement_count",
      "rollback_statement_count"], rows: [], rowCount: 0 }];
  const steps = {
    async cloudflare() { calls.push("cloudflare"); return { requestCount: 2, workerName: "openglasshub",
      versionId: "version", scriptEtag: "reviewed-etag" }; },
    async supabase() { calls.push("supabase"); return { requestCount: 2,
      projectRef: "xcbnxzjlsvtgzixurcof", targetMatch: true, projectStatus: "ACTIVE_HEALTHY", freePlan: true }; },
    async brevo() { calls.push("brevo"); return { requestCount: 2, plan: "FREE", senderReady: true }; },
    async database() { calls.push("database"); return { status: "PASS", connectionAttempts: 1,
      psqlProcessCount: 1, queryCount: 12, transactionReadOnly: true, sameBackend: true,
      rollbackMode: "EXPLICIT_ROLLBACK", transportProof: { status: "PASS", connectionAttempts: 1,
      psqlProcessCount: 1, queryCount: 12, transactionReadOnly: true, sameBackend: true,
      rollbackMode: "EXPLICIT_ROLLBACK" }, queryResults }; },
    async classify() { calls.push("classify"); return { dbStage: "PRE_V1",
      migrationProvenance: "CLEAN_UNSHIPPED_V1", catalogPass: true }; },
  };
  return { calls, steps };
}

test("AUTH-A local contract orders bounded reads, identity gate and one DB session", async () => {
  const { calls, steps } = fixture();
  const result = await runAuthAOrchestrator({ ...base, steps,
    reviewedWorkerIdentity: { versionId: "version", scriptEtag: "reviewed-etag" } });
  assert.deepEqual(calls, ["cloudflare", "supabase", "brevo", "database"]);
  assert.equal(result.authAStatus, "BLOCKED");
  assert.equal(result.freeCapacityStatus, "UNKNOWN");
  assert.equal(result.capacityGate, "BLOCKED_BEFORE_AUTH_B");
});

test("fake PRE_V1 callback cannot override DB-derived UNKNOWN", async () => {
  const { calls, steps } = fixture();
  steps.classify = async () => { calls.push("classify"); return { dbStage: "PRE_V1",
    migrationProvenance: "CLEAN_UNSHIPPED_V1", catalogPass: true }; };
  const result = await runAuthAOrchestrator({ ...base, steps,
    reviewedWorkerIdentity: { versionId: "version", scriptEtag: "reviewed-etag" } });
  assert.equal(result.authAStatus, "BLOCKED");
  assert.equal(calls.includes("classify"), false);
});

test("AUTH-A-001, source drift and Production stop before any read", async () => {
  for (const options of [
    { authorization: { ...authorization, AUTHORIZATION_ID: "auth-a-verified-session-001" } },
    { observedHead: "c".repeat(40) },
    { observedPacketSha256: "d".repeat(64) },
    { worktreeClean: false },
    { mode: "PRODUCTION" },
  ]) {
    const { calls, steps } = fixture();
    await assert.rejects(runAuthAOrchestrator({ ...base, ...options, steps }), /AUTH_A_ORCHESTRATOR_/);
    assert.deepEqual(calls, []);
  }
});

test("missing reviewed old Worker mapping stops before DB", async () => {
  const { calls, steps } = fixture();
  const result = await runAuthAOrchestrator({ ...base, steps });
  assert.deepEqual(calls, ["cloudflare", "supabase", "brevo"]);
  assert.equal(result.authAStatus, "BLOCKED");
  assert.equal(result.deployedWorkerIdentityMatch, false);
});

test("non-Free or inactive sender stops before DB", async () => {
  const { calls, steps } = fixture();
  steps.brevo = async () => { calls.push("brevo"); return { requestCount: 2,
    plan: "NOT_FREE", senderReady: false }; };
  const result = await runAuthAOrchestrator({ ...base, steps,
    reviewedWorkerIdentity: { versionId: "version", scriptEtag: "reviewed-etag" } });
  assert.deepEqual(calls, ["cloudflare", "supabase", "brevo"]);
  assert.equal(result.authAStatus, "BLOCKED");
});
