import assert from "node:assert/strict";
import { test } from "node:test";
import { runAuthAOrchestrator } from "./verified-session-auth-a-execute.mjs";
import { EXPECTED_OLD_WORKER } from "../lib/verified-session-old-worker-baseline.mjs";

const sourceHead = "a".repeat(40);
const packetSha256 = "b".repeat(64);
const authorization = { AUTH_A_EXECUTE: "1", AUTHORIZATION_ID: "auth-a-verified-session-003",
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
      activeVersionId: EXPECTED_OLD_WORKER.versionId,
      versionId: EXPECTED_OLD_WORKER.versionId, sourceCommit: "f".repeat(40) }; },
    async supabase() { calls.push("supabase"); return { requestCount: 2,
      projectRef: "xcbnxzjlsvtgzixurcof", targetMatch: true, projectStatus: "ACTIVE_HEALTHY", freePlan: true }; },
    async brevo() { calls.push("brevo"); return { requestCount: 2, plan: "FREE",
      senderReady: true, capacitySufficient: true }; },
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
  const result = await runAuthAOrchestrator({ ...base, steps });
  assert.deepEqual(calls, ["cloudflare", "supabase", "brevo", "database"]);
  assert.equal(result.authAStatus, "BLOCKED");
  assert.equal(result.freeCapacityStatus, "UNKNOWN");
  assert.equal(result.capacityGate, "BLOCKED_BEFORE_AUTH_B");
});

test("fake PRE_V1 callback cannot override DB-derived UNKNOWN", async () => {
  const { calls, steps } = fixture();
  steps.classify = async () => { calls.push("classify"); return { dbStage: "PRE_V1",
    migrationProvenance: "CLEAN_UNSHIPPED_V1", catalogPass: true }; };
  const result = await runAuthAOrchestrator({ ...base, steps });
  assert.equal(result.authAStatus, "BLOCKED");
  assert.equal(calls.includes("classify"), false);
});

test("AUTH-A-001/002 and source drift stop before any read", async () => {
  for (const options of [
    { authorization: { ...authorization, AUTHORIZATION_ID: "auth-a-verified-session-001" } },
    { authorization: { ...authorization, AUTHORIZATION_ID: "auth-a-verified-session-002" } },
    { observedHead: "c".repeat(40) },
    { observedPacketSha256: "d".repeat(64) },
    { worktreeClean: false },
  ]) {
    const { calls, steps } = fixture();
    await assert.rejects(runAuthAOrchestrator({ ...base, ...options, steps }), /AUTH_A_ORCHESTRATOR_/);
    assert.deepEqual(calls, []);
  }
});

test("WID-01 historical version reaches DB with historical provenance", async () => {
  const matched = fixture();
  const result = await runAuthAOrchestrator({ ...base, steps: matched.steps,
    expectedOldWorker: { versionId: "22222222-2222-4222-8222-222222222222",
      sourceCommit: "f".repeat(40) },
    pinnedWorkerArtifact: { sourceCommit: "f".repeat(40), artifactSha256: "c".repeat(64) } });
  assert.deepEqual(matched.calls, ["cloudflare", "supabase", "brevo", "database"]);
  assert.equal(result.deployedWorkerSourceEquivalence, "PROVEN_BY_HISTORICAL_VERSION_BINDING");
  assert.equal(result.expectedSourceCommit, EXPECTED_OLD_WORKER.sourceCommit);
  assert.equal(Object.isFrozen(EXPECTED_OLD_WORKER), true);
});

test("WID-02,03,06,07,08 wrong or caller-overridden version blocks before Supabase", async () => {
  for (const other of [EXPECTED_OLD_WORKER.versionId.slice(0, -1) + "b",
    "22222222-2222-4222-8222-222222222222"]) {
    const mismatched = fixture();
    mismatched.steps.cloudflare = async () => { mismatched.calls.push("cloudflare");
      return { requestCount: 2, workerName: EXPECTED_OLD_WORKER.workerName,
        activeVersionId: other, versionId: other }; };
    const result = await runAuthAOrchestrator({ ...base, steps: mismatched.steps,
      pinnedWorkerArtifact: { sourceCommit: EXPECTED_OLD_WORKER.sourceCommit,
        artifactSha256: "c".repeat(64), configSha256: "d".repeat(64) },
      expectedOldWorker: { versionId: other, sourceCommit: "f".repeat(40) } });
    assert.deepEqual(mismatched.calls, ["cloudflare"]);
    assert.equal(result.deployedWorkerIdentityMatch, false);
    assert.equal(result.authAStatus, "BLOCKED");
  }
  const mismatchedDetail = fixture();
  mismatchedDetail.steps.cloudflare = async () => { mismatchedDetail.calls.push("cloudflare");
    return { requestCount: 2, workerName: EXPECTED_OLD_WORKER.workerName,
      activeVersionId: EXPECTED_OLD_WORKER.versionId,
      versionId: "22222222-2222-4222-8222-222222222222" }; };
  const result = await runAuthAOrchestrator({ ...base, steps: mismatchedDetail.steps });
  assert.deepEqual(mismatchedDetail.calls, ["cloudflare"]);
  assert.equal(result.authAStatus, "BLOCKED");
  assert.equal(result.deployedWorkerIdentityDrift, true);
  const missing = fixture();
  missing.steps.cloudflare = async () => { missing.calls.push("cloudflare");
    return { requestCount: 2, workerName: EXPECTED_OLD_WORKER.workerName }; };
  const unknown = await runAuthAOrchestrator({ ...base, steps: missing.steps });
  assert.deepEqual(missing.calls, ["cloudflare"]);
  assert.equal(unknown.deployedWorkerIdentityDrift, "UNKNOWN");
});

test("non-Free or inactive sender stops before DB", async () => {
  const { calls, steps } = fixture();
  steps.brevo = async () => { calls.push("brevo"); return { requestCount: 2,
    plan: "NOT_FREE", senderReady: false }; };
  const result = await runAuthAOrchestrator({ ...base, steps });
  assert.deepEqual(calls, ["cloudflare", "supabase", "brevo"]);
  assert.equal(result.authAStatus, "BLOCKED");
});
