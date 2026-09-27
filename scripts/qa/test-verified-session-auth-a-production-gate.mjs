import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createAuthAProductionCapability, createAuthAProductionTestCapability,
  claimAuthAProductionAttempt, markAuthAExternalDispatch, getAuthAProductionAttempt,
  assertAuthAProductionCapability, validateAuthAArtifactHashes } from "../lib/verified-session-auth-a-production-gate.mjs";

const head = "a".repeat(40);
const packet = "b".repeat(64);
const branch = "feature/auth-verified-session-v1";
const accountId = "a".repeat(32);
const sentinelDir = mkdtempSync(path.join(tmpdir(), "auth-a-gate-test-"));
after(() => rmSync(sentinelDir, { recursive: true, force: true }));
const authorization = () => ({ AUTH_A_EXECUTE: "1", AUTHORIZATION_ID: "auth-a-verified-session-003",
  AUTHORIZED_AT_UTC: new Date().toISOString(), SOURCE_HEAD: head, PACKET_SHA256: packet,
  TARGET_CLOUDFLARE_ACCOUNT_ID: accountId });
const input = () => ({ authorization: authorization(), observedHead: head,
  observedPacketSha256: packet, branch, worktreeClean: true, sentinelDir });

test("PROD gate rejects missing, void, stale and drifting authorization before dispatch", () => {
  const valid = input();
  for (const change of [
    { authorization: undefined },
    { authorization: { ...valid.authorization, AUTHORIZATION_ID: "auth-a-verified-session-001" } },
    { authorization: { ...valid.authorization, AUTHORIZATION_ID: "auth-a-verified-session-002" } },
    { authorization: { ...valid.authorization, AUTHORIZED_AT_UTC: "2026-09-26T23:34:38Z" } },
    { authorization: { ...valid.authorization, AUTHORIZED_AT_UTC: "not-utc" } },
    { authorization: { ...valid.authorization, SOURCE_HEAD: "c".repeat(40) } },
    { authorization: { ...valid.authorization, PACKET_SHA256: "d".repeat(64) } },
    { authorization: { ...valid.authorization, TARGET_CLOUDFLARE_ACCOUNT_ID: undefined } },
    { authorization: { ...valid.authorization, TARGET_CLOUDFLARE_ACCOUNT_ID: "wrong" } },
    { observedHead: "c".repeat(40) }, { observedPacketSha256: "d".repeat(64) },
    { branch: "main" }, { worktreeClean: false },
  ]) assert.throws(() => createAuthAProductionTestCapability({ ...valid, ...change }), /AUTH_A_PRODUCTION_GATE_/);
  assert.throws(() => createAuthAProductionCapability({ authorization: valid.authorization }),
    /AUTH_A_PRODUCTION_GATE_/);
});

test("frozen AUTH-A artifact hashes reject drift before Production dispatch", () => {
  const expected = {
    foundation: "575cfcea2ed0e4415e07370d97474518c957ba409248790b2f6309748c1597f9",
    enforcement: "89d74d4e96f1b6dcc1298ae443e21389ebc86c6ee0a6c46f7fef9dc15755d10e",
    catalog: "b033239a1b7bc689e9ad5be1409a19363eaba2c7a8c6eddb791bcabc9cf6bfc7",
    history: "6018ce149a1520c7c097e2577281ace773a2329cc8f36ca74350fd03be347002",
  };
  assert.doesNotThrow(() => validateAuthAArtifactHashes(expected));
  for (const name of Object.keys(expected)) {
    assert.throws(() => validateAuthAArtifactHashes({ ...expected, [name]: "0".repeat(64) }),
      /AUTH_A_PRODUCTION_GATE_ARTIFACT_DRIFT/);
  }
});

test("PROD gate accepts dummy 003, consumes before first dispatch and cannot start twice", () => {
  const valid = input();
  const capability = createAuthAProductionTestCapability(valid);
  assert.equal(Object.isFrozen(capability), true);
  assert.deepEqual(getAuthAProductionAttempt(capability).counts, { cloudflare: 0, supabase: 0, brevo: 0, database: 0 });
  assert.equal(getAuthAProductionAttempt(capability).consumed, false);
  assert.throws(() => markAuthAExternalDispatch(capability, "cloudflare"), /AUTH_A_PRODUCTION_GATE_/);
  claimAuthAProductionAttempt(capability, valid);
  assert.equal(Object.isFrozen(assertAuthAProductionCapability(capability)), true);
  assert.throws(() => claimAuthAProductionAttempt(capability, valid), /AUTH_A_PRODUCTION_GATE_/);
  const duplicate = createAuthAProductionTestCapability(valid);
  assert.throws(() => claimAuthAProductionAttempt(duplicate, valid), /AUTH_A_PRODUCTION_GATE_ATTEMPT_ALREADY_CLAIMED/);
  for (const provider of ["cloudflare", "cloudflare", "supabase", "supabase", "brevo", "brevo", "database"])
    markAuthAExternalDispatch(capability, provider);
  const state = getAuthAProductionAttempt(capability);
  assert.equal(state.consumed, true);
  assert.deepEqual(state.counts, { cloudflare: 2, supabase: 2, brevo: 2, database: 1 });
  assert.throws(() => markAuthAExternalDispatch(capability, "database"), /AUTH_A_PRODUCTION_GATE_/);
});

test("PROD gate cannot be forged or moved to another authorization", () => {
  assert.throws(() => claimAuthAProductionAttempt(Object.freeze({}), input()), /AUTH_A_PRODUCTION_GATE_/);
  const valid = input();
  const capability = createAuthAProductionTestCapability(valid);
  assert.throws(() => claimAuthAProductionAttempt(capability, { ...valid,
    authorization: { ...valid.authorization, AUTHORIZATION_ID: "auth-a-verified-session-004" } }),
  /AUTH_A_PRODUCTION_GATE_/);
});

test("DURABLE-01..10 first dispatch persists exclusive non-secret sentinel across gate restart", async () => {
  const gitStatus = () => {
    const result = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8", shell: false });
    assert.equal(result.status, 0);
    return result.stdout;
  };
  const beforeStatus = gitStatus();
  const valid = input();
  valid.authorization.AUTHORIZATION_ID = "auth-a-verified-session-015";
  const capability = createAuthAProductionTestCapability(valid);
  claimAuthAProductionAttempt(capability, valid);
  assert.deepEqual(readdirSync(sentinelDir).filter((name) => name.includes("015")), []);
  markAuthAExternalDispatch(capability, "cloudflare");
  const files = readdirSync(sentinelDir).filter((name) => name.includes("015"));
  assert.equal(files.length, 1);
  const sentinel = JSON.parse(readFileSync(path.join(sentinelDir, files[0]), "utf8"));
  assert.deepEqual(Object.keys(sentinel).sort(), ["AUTHORIZATION_ID", "AUTHORIZED_AT_UTC",
    "CONSUMED_AT_UTC", "PACKET_SHA256", "SOURCE_HEAD"].sort());
  assert.equal(sentinel.AUTHORIZATION_ID, valid.authorization.AUTHORIZATION_ID);
  assert.equal(sentinel.SOURCE_HEAD, head);
  assert.equal(sentinel.PACKET_SHA256, packet);
  assert.match(sentinel.CONSUMED_AT_UTC, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(readFileSync(path.join(sentinelDir, files[0]), "utf8").includes("dummy-password"), false);
  const restarted = await import(`../lib/verified-session-auth-a-production-gate.mjs?restart=${Date.now()}`);
  const duplicate = restarted.createAuthAProductionTestCapability(valid);
  assert.throws(() => restarted.claimAuthAProductionAttempt(duplicate, valid),
    /AUTH_A_PRODUCTION_GATE_AUTHORIZATION_ALREADY_CONSUMED/);
  assert.equal(restarted.getAuthAProductionAttempt(duplicate).consumed, true);
  const another = input();
  another.authorization.AUTHORIZATION_ID = "auth-a-verified-session-016";
  const fresh = restarted.createAuthAProductionTestCapability(another);
  restarted.claimAuthAProductionAttempt(fresh, another);
  assert.equal(restarted.getAuthAProductionAttempt(fresh).consumed, false);
  assert.equal(gitStatus(), beforeStatus);
  assert.equal(Object.keys(restarted).some((name) => /reset|retry|delete|clear/i.test(name)), false);
});
