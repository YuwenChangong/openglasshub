import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuthAProductionCapability, createAuthAProductionTestCapability,
  claimAuthAProductionAttempt, markAuthAExternalDispatch, getAuthAProductionAttempt,
  assertAuthAProductionCapability } from "../lib/verified-session-auth-a-production-gate.mjs";

const head = "a".repeat(40);
const packet = "b".repeat(64);
const branch = "feature/auth-verified-session-v1";
const authorization = () => ({ AUTH_A_EXECUTE: "1", AUTHORIZATION_ID: "auth-a-verified-session-003",
  AUTHORIZED_AT_UTC: new Date().toISOString(), SOURCE_HEAD: head, PACKET_SHA256: packet });
const input = () => ({ authorization: authorization(), observedHead: head,
  observedPacketSha256: packet, branch, worktreeClean: true });

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
    { observedHead: "c".repeat(40) }, { observedPacketSha256: "d".repeat(64) },
    { branch: "main" }, { worktreeClean: false },
  ]) assert.throws(() => createAuthAProductionTestCapability({ ...valid, ...change }), /AUTH_A_PRODUCTION_GATE_/);
  assert.throws(() => createAuthAProductionCapability({ authorization: valid.authorization }),
    /AUTH_A_PRODUCTION_GATE_/);
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
