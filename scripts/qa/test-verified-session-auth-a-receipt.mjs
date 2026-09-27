import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as production from "./verified-session-auth-a-production.mjs";
import { claimAuthAProductionAttempt, createAuthAProductionTestCapability,
  markAuthAExternalDispatch } from "../lib/verified-session-auth-a-production-gate.mjs";

const sentinelDir = mkdtempSync(path.join(tmpdir(), "auth-a-receipt-test-"));
after(() => rmSync(sentinelDir, { recursive: true, force: true }));
const head = "a".repeat(40);
const packet = "b".repeat(64);

function fixture(id) {
  const authorization = { AUTH_A_EXECUTE: "1", AUTHORIZATION_ID: `auth-a-verified-session-${id}`,
    AUTHORIZED_AT_UTC: new Date().toISOString(), SOURCE_HEAD: head, PACKET_SHA256: packet };
  const binding = { authorization, observedHead: head, observedPacketSha256: packet,
    branch: "feature/auth-verified-session-v1", worktreeClean: true, sentinelDir };
  const capability = createAuthAProductionTestCapability(binding);
  claimAuthAProductionAttempt(capability, binding);
  return { authorization, capability };
}

function fields(receipt) {
  assert.match(receipt, /\n$/);
  const lines = receipt.trimEnd().split("\n");
  assert.ok(lines.every((line) => /^[A-Z0-9_]+=[^\r\n]*$/.test(line)));
  const entries = lines.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]);
  assert.equal(new Set(entries.map(([key]) => key)).size, entries.length);
  return Object.fromEntries(entries);
}

test("RECEIPT-01..02 complete PASS contains frozen redacted inventory facts", () => {
  assert.equal(typeof production.formatAuthAProductionReceipt, "function");
  const { authorization, capability } = fixture("021");
  for (const provider of ["cloudflare", "cloudflare", "supabase", "supabase", "brevo", "brevo", "database"])
    markAuthAExternalDispatch(capability, provider);
  const result = { authAStatus: "PASS", nextAction: "REQUEST_SEPARATE_CAPACITY_REVIEW",
    targetWorker: "openglasshub", targetSupabase: "xcbnxzjlsvtgzixurcof", targetMatch: true,
    deployedWorkerIdentity: "dba19da7-2fa8-4055-a94d-25c83ad3a02a",
    deployedWorkerIdentityMatch: true, deployedWorkerIdentityDrift: false,
    deployedWorkerSourceEquivalence: "PROVEN_BY_HISTORICAL_VERSION_BINDING",
    dbStage: "PRE_V1", migrationProvenance: "CLEAN_UNSHIPPED_V1",
    oldMonolithApplied: false, oldResendLockApplied: false, newFoundationApplied: false,
    newEnforcementApplied: false, v1PrivateTableCount: 0, v1FunctionCount: 0,
    v1RestrictivePolicyCount: 0,
    resendEffectiveAcl: { anon: false, authenticated: false, service: true },
    catalogPreflightStatus: "PASS", catalogDrift: "none", blockerClass: "NONE" };
  const receipt = production.formatAuthAProductionReceipt({ authorization, capability, result });
  const actual = fields(receipt);
  assert.equal(actual.DB_FAILURE_STAGE, "NONE");
  assert.equal(actual.DB_FAILURE_CLASS, "NONE");
  assert.equal(actual.DB_FAILURE_QUERY_ID, "NONE");
  const required = ["AUTH_A_STATUS", "AUTH_RELEASE_STATUS", "AUTHORIZATION_ID", "AUTHORIZATION_VALID",
    "AUTHORIZATION_CONSUMED", "REUSABLE", "SOURCE_HEAD", "PACKET_SHA256", "CATALOG_PACKET_SHA256",
    "MIGRATION_HISTORY_PACKET_SHA256", "FOUNDATION_SHA256", "ENFORCEMENT_SHA256", "TARGET_WORKER",
    "TARGET_SUPABASE", "TARGET_MATCH", "DEPLOYED_WORKER_IDENTITY", "DEPLOYED_WORKER_IDENTITY_MATCH",
    "DEPLOYED_WORKER_IDENTITY_DRIFT", "DEPLOYED_WORKER_SOURCE_EQUIVALENCE", "EXPECTED_SOURCE_COMMIT",
    "DB_STAGE", "DB_FAILURE_STAGE", "DB_FAILURE_CLASS", "DB_FAILURE_QUERY_ID",
    "EXPECTED_DB_STAGE", "MIGRATION_PROVENANCE", "OLD_MONOLITH_APPLIED",
    "OLD_RESEND_LOCK_APPLIED", "NEW_FOUNDATION_APPLIED", "NEW_ENFORCEMENT_APPLIED",
    "V1_PRIVATE_TABLE_COUNT", "V1_FUNCTION_COUNT", "V1_RESTRICTIVE_POLICY_COUNT",
    "RESEND_EFFECTIVE_ACL", "CATALOG_PREFLIGHT_STATUS", "CATALOG_DRIFT", "FREE_CAPACITY_STATUS",
    "CAPACITY_GATE", "CLOUDFLARE_READ_REQUESTS", "SUPABASE_CONTROL_PLANE_READ_REQUESTS",
    "BREVO_READ_REQUESTS", "PRODUCTION_CONNECTION_ATTEMPTS", "PRODUCTION_WRITES", "AUTH_STATE_CHANGES",
    "EMAIL_SENDS", "STORAGE_WRITES", "REALTIME_SENTINELS", "DEPLOYS", "CONFIG_CHANGES",
    "ZERO_PAID_INFRA", "BLOCKER_CLASS", "NEXT_ACTION"];
  assert.deepEqual(Object.keys(actual), required);
  assert.equal(actual.AUTH_A_STATUS, "PASS");
  assert.equal(actual.AUTHORIZATION_CONSUMED, "true");
  assert.equal(actual.REUSABLE, "false");
  assert.equal(actual.CATALOG_PACKET_SHA256, "b033239a1b7bc689e9ad5be1409a19363eaba2c7a8c6eddb791bcabc9cf6bfc7");
  assert.equal(actual.MIGRATION_HISTORY_PACKET_SHA256, "6018ce149a1520c7c097e2577281ace773a2329cc8f36ca74350fd03be347002");
  assert.equal(actual.FOUNDATION_SHA256, "575cfcea2ed0e4415e07370d97474518c957ba409248790b2f6309748c1597f9");
  assert.equal(actual.ENFORCEMENT_SHA256, "89d74d4e96f1b6dcc1298ae443e21389ebc86c6ee0a6c46f7fef9dc15755d10e");
  assert.equal(actual.DB_STAGE, "PRE_V1");
  assert.equal(actual.MIGRATION_PROVENANCE, "CLEAN_UNSHIPPED_V1");
  assert.equal(actual.OLD_MONOLITH_APPLIED, "false");
  assert.equal(actual.V1_PRIVATE_TABLE_COUNT, "0");
  assert.equal(actual.RESEND_EFFECTIVE_ACL, "anon=false,authenticated=false,service=true");
  assert.equal(actual.CATALOG_PREFLIGHT_STATUS, "PASS");
  assert.equal(actual.CLOUDFLARE_READ_REQUESTS, "2");
  assert.equal(actual.SUPABASE_CONTROL_PLANE_READ_REQUESTS, "2");
  assert.equal(actual.BREVO_READ_REQUESTS, "2");
  assert.equal(actual.PRODUCTION_CONNECTION_ATTEMPTS, "1");
  assert.equal(actual.FREE_CAPACITY_STATUS, "UNKNOWN");
  assert.equal(actual.CAPACITY_GATE, "BLOCKED_BEFORE_AUTH_B");
  assert.equal(actual.PRODUCTION_WRITES, "0");
  assert.equal(actual.AUTH_STATE_CHANGES, "0");
  assert.equal(actual.EMAIL_SENDS, "0");
  assert.equal(actual.STORAGE_WRITES, "0");
  assert.equal(actual.REALTIME_SENTINELS, "0");
  assert.equal(actual.DEPLOYS, "0");
  assert.equal(actual.CONFIG_CHANGES, "0");
  assert.equal(actual.ZERO_PAID_INFRA, "true");
  assert.equal(actual.NEXT_ACTION, "REQUEST_SEPARATE_CAPACITY_REVIEW");
  assert.equal(receipt, production.formatAuthAProductionReceipt({ authorization, capability, result }));
});

test("RECEIPT-03..10 blocked before DB remains UNKNOWN and never leaks arbitrary text", () => {
  assert.equal(typeof production.formatAuthAProductionReceipt, "function");
  const { authorization, capability } = fixture("022");
  markAuthAExternalDispatch(capability, "cloudflare");
  const result = { authAStatus: "BLOCKED", blockerClass: "Bearer secret-token password=dummy-password",
    nextAction: "REQUEST_AUTH_B_FOUNDATION_AUTHORIZATION", targetSupabase: "sender@example.test",
    dbStage: "PRE_V1", migrationProvenance: "CLEAN_UNSHIPPED_V1" };
  const receipt = production.formatAuthAProductionReceipt({ authorization, capability, result });
  const actual = fields(receipt);
  assert.equal(actual.AUTH_A_STATUS, "BLOCKED");
  assert.equal(actual.AUTHORIZATION_CONSUMED, "true");
  assert.equal(actual.CLOUDFLARE_READ_REQUESTS, "1");
  assert.equal(actual.PRODUCTION_CONNECTION_ATTEMPTS, "0");
  assert.equal(actual.DB_FAILURE_STAGE, "UNKNOWN");
  assert.equal(actual.DB_FAILURE_CLASS, "UNKNOWN");
  assert.equal(actual.DB_FAILURE_QUERY_ID, "UNKNOWN");
  assert.equal(actual.DB_STAGE, "UNKNOWN");
  assert.equal(actual.MIGRATION_PROVENANCE, "UNKNOWN");
  assert.equal(actual.OLD_MONOLITH_APPLIED, "UNKNOWN");
  assert.equal(actual.CATALOG_PREFLIGHT_STATUS, "UNKNOWN");
  assert.equal(actual.BLOCKER_CLASS, "UNKNOWN");
  assert.equal(actual.NEXT_ACTION, "STOP_FOR_REVIEW");
  for (const secret of ["secret-token", "dummy-password", "sender@example.test", "REQUEST_AUTH_B"])
    assert.equal(receipt.includes(secret), false);
});

test("fabricated PASS without complete tracked dispatch is emitted as BLOCKED", () => {
  const { authorization, capability } = fixture("024");
  markAuthAExternalDispatch(capability, "cloudflare");
  const actual = fields(production.formatAuthAProductionReceipt({ authorization, capability,
    result: { authAStatus: "PASS", nextAction: "REQUEST_SEPARATE_CAPACITY_REVIEW",
      dbStage: "PRE_V1", migrationProvenance: "CLEAN_UNSHIPPED_V1" } }));
  assert.equal(actual.AUTH_A_STATUS, "BLOCKED");
  assert.equal(actual.DB_STAGE, "UNKNOWN");
  assert.equal(actual.NEXT_ACTION, "STOP_FOR_REVIEW");
});

test("durably consumed authorization has a bounded exact blocker code", () => {
  const { authorization, capability } = fixture("025");
  markAuthAExternalDispatch(capability, "cloudflare");
  const actual = fields(production.formatAuthAProductionReceipt({ authorization, capability,
    result: { authAStatus: "BLOCKED",
      blockerClass: "AUTH_A_PRODUCTION_GATE_AUTHORIZATION_ALREADY_CONSUMED" } }));
  assert.equal(actual.AUTHORIZATION_CONSUMED, "true");
  assert.equal(actual.BLOCKER_CLASS, "AUTH_A_PRODUCTION_GATE_AUTHORIZATION_ALREADY_CONSUMED");
});

test("receipt binding comes from verified capability, not mutable caller data", () => {
  const { authorization, capability } = fixture("026");
  authorization.AUTHORIZATION_ID = "auth-a-verified-session-999";
  authorization.SOURCE_HEAD = "c".repeat(40);
  authorization.PACKET_SHA256 = "d".repeat(64);
  const actual = fields(production.formatAuthAProductionReceipt({ authorization, capability,
    result: { authAStatus: "BLOCKED", blockerClass: "PREFLIGHT_BLOCKED" } }));
  assert.equal(actual.AUTHORIZATION_ID, "auth-a-verified-session-026");
  assert.equal(actual.SOURCE_HEAD, head);
  assert.equal(actual.PACKET_SHA256, packet);
});

test("database diagnostics accept only fixed enum values and query identifiers", () => {
  const { authorization, capability } = fixture("027");
  for (const provider of ["cloudflare", "cloudflare", "supabase", "supabase", "brevo", "brevo", "database"])
    markAuthAExternalDispatch(capability, provider);
  const receipt = production.formatAuthAProductionReceipt({ authorization, capability, result: {
    authAStatus: "BLOCKED", blockerClass: "DATABASE_BLOCKED",
    dbFailureStage: "PROCESS\nDB_STAGE=PRE_V1", dbFailureClass: "password=fake-token",
    dbFailureQueryId: "CATALOG_12\nAUTH_RELEASE_STATUS=GO" } });
  const actual = fields(receipt);
  assert.equal(actual.DB_FAILURE_STAGE, "UNKNOWN");
  assert.equal(actual.DB_FAILURE_CLASS, "UNKNOWN");
  assert.equal(actual.DB_FAILURE_QUERY_ID, "UNKNOWN");
  assert.equal(receipt.includes("fake-token"), false);
  assert.doesNotMatch(receipt, /^DB_STAGE=PRE_V1$/m);
  assert.doesNotMatch(receipt, /^AUTH_RELEASE_STATUS=GO$/m);
});
