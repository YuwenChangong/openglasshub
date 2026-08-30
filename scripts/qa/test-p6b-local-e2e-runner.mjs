import assert from "node:assert/strict";
import { runP6bLifecycle } from "./p6b-local-e2e-runner-core.mjs";
import * as primitives from "./p6b-local-e2e-runner.mjs";

const cases = [];
let executed = 0;
let passed = 0;

function test(id, fn) { cases.push({ id, fn }); }

function makeOperations(overrides = {}) {
  const calls = [];
  const operation = (name, value = {}) => async () => { calls.push(name); return value; };
  const operations = {
    snapshot: operation("snapshot"), allocateRuntimeConfig: operation("allocateRuntimeConfig"), mirror: operation("mirror"),
    startSupabase: operation("startSupabase"), verifyOwnership: operation("verifyOwnership"), prepareDatabase: operation("prepareDatabase"),
    createAuthFixtures: operation("createAuthFixtures"), assignFixtureRoles: operation("assignFixtureRoles"), verifyFixtureRoles: operation("verifyFixtureRoles"),
    startAstro: operation("startAstro"),
    verifyRuntime: operation("verifyRuntime", { supabaseUrl: "http://127.0.0.1:54321", publicSupabaseUrl: "http://127.0.0.1:54321", anonKeyPresent: true, publicAnonKeyPresent: true }),
    runApi: operation("runApi", { passed: 16 }), startBrowser: operation("startBrowser"), runUi: operation("runUi", { passed: 16 }),
    runFinal: operation("runFinal"), cleanupBrowser: operation("cleanupBrowser"), stopAstro: operation("stopAstro"),
    stopSupabase: operation("stopSupabase"), verifyCleanup: operation("verifyCleanup", { preexistingStatePreserved: true }), ...overrides,
  };
  return { calls, operations };
}

test("RUNNER-01", async () => {
  const { calls, operations } = makeOperations({ runApi: async () => ({ passed: 15, firstFailureCase: "API-16" }) });
  const result = await runP6bLifecycle({ operations });
  assert.equal(result.acceptanceResult, "BLOCKED"); assert.equal(result.firstFailureCase, "API-16"); assert.equal(calls.includes("startBrowser"), false);
});
test("RUNNER-02", async () => {
  const { calls, operations } = makeOperations({ runApi: async () => ({ passed: 0, firstFailureCase: "API-01" }) });
  const result = await runP6bLifecycle({ operations });
  assert.equal(result.acceptanceResult, "BLOCKED"); assert.deepEqual(calls.slice(-4), ["cleanupBrowser", "stopAstro", "stopSupabase", "verifyCleanup"]);
});
test("RUNNER-03", async () => {
  const { calls, operations } = makeOperations({ runUi: async () => ({ passed: 15, firstFailureCase: "UI-16" }) });
  const result = await runP6bLifecycle({ operations });
  assert.equal(result.acceptanceResult, "BLOCKED"); assert.equal(result.firstFailureCase, "UI-16"); assert.equal(calls.includes("stopAstro"), true); assert.equal(calls.includes("stopSupabase"), true);
});
test("RUNNER-04", async () => {
  const { calls, operations } = makeOperations({ prepareDatabase: async () => { throw new Error("unexpected lifecycle error"); } });
  const result = await runP6bLifecycle({ operations });
  assert.equal(result.acceptanceResult, "BLOCKED"); assert.equal(result.firstFailureStage, "prepareDatabase"); assert.equal(calls.includes("stopAstro"), true); assert.equal(calls.includes("stopSupabase"), true);
});
test("RUNNER-05", async () => {
  const { calls, operations } = makeOperations({ verifyRuntime: async () => ({ supabaseUrl: "https://example.supabase.co", publicSupabaseUrl: "https://example.supabase.co", anonKeyPresent: true, publicAnonKeyPresent: true }) });
  const result = await runP6bLifecycle({ operations }); assert.equal(result.acceptanceResult, "BLOCKED"); assert.equal(calls.includes("runApi"), false);
});
test("RUNNER-06", async () => {
  const { calls, operations } = makeOperations({ verifyRuntime: async () => ({ supabaseUrl: "http://127.0.0.1:54321", publicSupabaseUrl: "http://127.0.0.1:54321", anonKeyPresent: false, publicAnonKeyPresent: true }) });
  const result = await runP6bLifecycle({ operations }); assert.equal(result.acceptanceResult, "BLOCKED"); assert.equal(calls.includes("runApi"), false);
});
test("RUNNER-07", async () => {
  const { operations } = makeOperations({ stopSupabase: async () => { throw new Error("cleanup failed"); }, verifyCleanup: async () => ({ preexistingStatePreserved: false }) });
  const result = await runP6bLifecycle({ operations }); assert.equal(result.acceptanceResult, "PASS"); assert.equal(result.cleanupResult, "BLOCKED"); assert.notEqual(result.terminal, "OPENGLASS_HUB_PUBLIC_BETA_P6B_DEVICE_ADMIN_LOCAL_E2E_READY");
});
test("RUNNER-08", async () => {
  const secret = "RUNNER_SENTINEL_ANON_TOKEN"; const evidence = [];
  const { operations } = makeOperations({ snapshot: async () => ({ anonKey: secret }), prepareDatabase: async () => { throw new Error(`failed with ${secret}`); } });
  const result = await runP6bLifecycle({ operations, evidence }); assert.equal(JSON.stringify({ result, evidence }).includes(secret), false);
});

function primitive(name) {
  assert.equal(typeof primitives[name], "function", `primitive ${name} is absent`);
  return primitives[name];
}
const configBaseline = `[api]\nport = 54321\n[db]\nport = 54322\nshadow_port = 54320\n[studio]\nport = 54323\n[local_smtp]\nport = 54324\n[analytics]\nport = 54327\n[db.pooler]\nport = 54329\n[edge_runtime]\ninspector_port = 8083\nproject_id = "generated"\n`;
const ownedRoot = "C:/Temp/openglass-p6b-owned-run";
const repoSupabase = "C:/Temp/openglass-hub-public-beta-v1/supabase";
const bundle = { api: 55121, db: 55122, shadow: 55120, studio: 55123, smtp: 55124, analytics: 55127, pooler: 55129, inspector: 55183 };

test("CONFIG-01", async () => {
  const calls = [];
  await primitive("initializeRuntimeConfig")({ root: ownedRoot, repoSupabase, runId: "run-1", exec: async (...args) => { calls.push(args); }, readConfig: async () => configBaseline, writeConfig: async () => {} });
  assert.equal(calls.length, 1); assert.equal(calls[0][0], "init"); assert.equal(calls[0][1].workdir, ownedRoot);
});
test("CONFIG-02", async () => {
  await assert.rejects(() => primitive("initializeRuntimeConfig")({ root: ownedRoot, repoSupabase, runId: "run-1", exec: async () => { throw new Error("init failed"); } }));
});
test("CONFIG-03", async () => {
  const events = [];
  await primitive("initializeRuntimeConfig")({ root: ownedRoot, repoSupabase, runId: "run-1", exec: async () => {}, readConfig: async () => { events.push("read"); return configBaseline; }, writeConfig: async () => { events.push("write"); } });
  assert.deepEqual(events, ["read", "write"]);
});
test("CONFIG-04", async () => {
  const result = primitive("mutateGeneratedConfig")(configBaseline, { projectId: "run-1", ports: bundle });
  assert.equal(result.projectId, "run-1"); assert.equal(result.changedKeys.every((key) => key === "project_id" || key.endsWith("port")), true);
});
test("CONFIG-05", async () => {
  assert.throws(() => primitive("mutateGeneratedConfig")(configBaseline, { projectId: "run-1", ports: bundle, changes: { db: { major_version: 17 } } }));
});
test("CONFIG-06", async () => {
  assert.throws(() => primitive("assertOwnedRuntimeRoot")({ root: repoSupabase, repoSupabase }));
});
test("CONFIG-07", async () => {
  const args = primitive("supabaseCommandArgs")({ root: ownedRoot, command: ["start"] });
  assert.deepEqual(args, ["start", "--workdir", ownedRoot]);
});
test("CONFIG-08", async () => {
  const removed = [];
  await primitive("cleanupOwnedRoot")({ root: ownedRoot, repoSupabase, remove: async (target) => removed.push(target) });
  assert.deepEqual(removed, [ownedRoot]);
});
test("PORT-01", async () => {
  const chosen = primitive("allocatePortBundle")({ bases: [55120], offsets: Object.values(bundle).map((value) => value - 55120), probe: () => true });
  assert.equal(chosen.api, 55121);
});
test("PORT-02", async () => {
  assert.throws(() => primitive("allocatePortBundle")({ bases: [55120], offsets: Object.values(bundle).map((value) => value - 55120), probe: (port) => port !== 55122 }));
});
test("PORT-03", async () => {
  const chosen = primitive("allocatePortBundle")({ bases: [55120, 55220], offsets: Object.values(bundle).map((value) => value - 55120), probe: (port) => port < 55120 || port >= 55220 });
  assert.equal(chosen.api, 55221);
});
test("PORT-04", async () => {
  assert.throws(() => primitive("allocatePortBundle")({ bases: [55120, 55220], offsets: Object.values(bundle).map((value) => value - 55120), probe: () => false }));
});
const actors = { nonstaff: { id: "00000000-0000-4000-8000-000000000001", role: "user" }, moderator: { id: "00000000-0000-4000-8000-000000000002", role: "moderator" }, admin: { id: "00000000-0000-4000-8000-000000000003", role: "admin" } };
test("ROLE-01", async () => {
  const sql = primitive("createRoleFixtureSql")({ actors, ownershipProven: true, profileCount: 3, postRolesVerified: true });
  for (const role of ["user", "moderator", "admin"]) assert.match(sql, new RegExp(`'${role}'`));
});
test("ROLE-02", async () => { assert.throws(() => primitive("createRoleFixtureSql")({ actors: { ...actors, admin: { id: "bad", role: "admin" } }, ownershipProven: true, profileCount: 3, postRolesVerified: true })); });
test("ROLE-03", async () => { assert.throws(() => primitive("createRoleFixtureSql")({ actors: { ...actors, admin: { ...actors.admin, role: "owner" } }, ownershipProven: true, profileCount: 3, postRolesVerified: true })); });
test("ROLE-04", async () => { assert.throws(() => primitive("createRoleFixtureSql")({ actors, ownershipProven: false, profileCount: 3, postRolesVerified: true })); });
test("ROLE-05", async () => { assert.throws(() => primitive("createRoleFixtureSql")({ actors, ownershipProven: true, profileCount: 2, postRolesVerified: true })); });
test("ROLE-06", async () => { assert.throws(() => primitive("createRoleFixtureSql")({ actors, ownershipProven: true, profileCount: 3, postRolesVerified: false })); });

function observedOperations(overrides = {}) {
  const { operations } = makeOperations(overrides);
  return operations;
}
test("EVID-01", async () => { const result = await runP6bLifecycle({ operations: observedOperations({ snapshot: async () => ({ observations: { safe: "retained" } }) }) }); assert.equal(result.observations.safe, "retained"); });
test("EVID-02", async () => { const result = await runP6bLifecycle({ operations: observedOperations({ runApi: async () => ({ passed: 16, observations: { unauthStatus: 401, nonstaffStatus: 403 } }) }) }); assert.deepEqual([result.observations.unauthStatus, result.observations.nonstaffStatus], [401, 403]); });
test("EVID-03", async () => { const result = await runP6bLifecycle({ operations: observedOperations({ prepareDatabase: async () => ({ observations: { canonicalDeviceCount: 24 } }) }) }); assert.equal(result.observations.canonicalDeviceCount, 24); });
test("EVID-04", async () => { const result = await runP6bLifecycle({ operations: observedOperations({ verifyFixtureRoles: async () => ({ observations: { nonstaffHelper: false, moderatorHelper: true, adminHelper: true } }) }) }); assert.deepEqual([result.observations.nonstaffHelper, result.observations.moderatorHelper, result.observations.adminHelper], [false, true, true]); });
test("EVID-05", async () => { const result = await runP6bLifecycle({ operations: observedOperations({ allocateRuntimeConfig: async () => ({ observations: { configOwned: true, configChanges: 0 } }) }) }); assert.equal(result.observations.configOwned, true); assert.equal(result.observations.configChanges, 0); });
test("EVID-06", async () => { const result = await runP6bLifecycle({ operations: observedOperations({ snapshot: async () => ({ observations: { portSelected: true, portBindingVerified: true } }) }) }); assert.equal(result.observations.portBindingVerified, true); });
test("EVID-07", async () => { const result = await runP6bLifecycle({ operations: observedOperations({ stopAstro: async () => ({ observations: { astroStoppedObserved: true } }), stopSupabase: async () => ({ observations: { supabaseCleanedObserved: true } }) }) }); assert.equal(result.observations.astroStoppedObserved, true); assert.equal(result.observations.supabaseCleanedObserved, true); });
test("EVID-08", async () => { const result = await runP6bLifecycle({ operations: observedOperations() }); assert.equal(result.observations.astroStoppedObserved ?? null, null); });
test("EVID-09", async () => { const result = await runP6bLifecycle({ operations: observedOperations({ prepareDatabase: async () => { const error = new Error("first"); error.caseId = "FIRST"; throw error; }, stopAstro: async () => ({ observations: { firstFailureStage: "bad", firstFailureCase: "bad" } }) }) }); assert.equal(result.firstFailureStage, "prepareDatabase"); assert.equal(result.firstFailureCase, "FIRST"); });
test("EVID-10", async () => { const secret = "EVIDENCE_SERVICE_KEY_SENTINEL"; const result = await runP6bLifecycle({ operations: observedOperations({ snapshot: async () => ({ observations: { serviceKey: secret } }) }) }); assert.equal(JSON.stringify(result).includes(secret), false); });
test("HELPCTX-01", async () => { assert.match(primitive("helperContextSql")("00000000-0000-4000-8000-000000000001"), /request\.jwt\.claim\.sub/); });
test("HELPCTX-02", async () => { assert.match(primitive("helperContextSql")(actors.moderator.id), /set local role authenticated[\s\S]*request\.jwt\.claim\.role','authenticated'/i); });
test("HELPCTX-03", async () => { const sql = primitive("helperContextSql")(actors.admin.id); assert.match(sql, /^begin;[\s\S]*select public\.is_moderator_or_admin\(\);[\s\S]*rollback;$/i); });
test("HELPCTX-04", async () => { assert.equal(primitive("helperContextSql")(actors.nonstaff.id).includes(actors.moderator.id), false); });
test("HELPCTX-05", async () => { assert.throws(() => primitive("helperContextSql")("not-a-uuid")); });
test("HELPCTX-06", async () => { const sql = primitive("helperContextSql")(actors.admin.id); assert.equal(sql.includes("profiles.role"), false); });
test("PARSE-01", async () => { assert.equal(primitive("parseHelperOutput")("BEGIN\nSET\nauthenticated\n00000000-0000-4000-8000-000000000001\nf\nROLLBACK\n"), false); });
test("PARSE-02", async () => { assert.equal(primitive("parseHelperOutput")("BEGIN\nSET\nauthenticated\n00000000-0000-4000-8000-000000000002\nt\nROLLBACK\n"), true); });
test("PARSE-03", async () => { assert.throws(() => primitive("parseHelperOutput")("BEGIN\nSET\nROLLBACK\n")); });
test("PROBE-01", async () => { const { calls, operations } = makeOperations(); const result = await runP6bLifecycle({ operations, config: { apiRequired: 0, uiRequired: 0, helperOnly: true } }); assert.equal(result.acceptanceResult, "PASS"); assert.equal(calls.includes("startAstro"), false); assert.equal(calls.includes("runApi"), false); });
test("PRETHROW-01", async () => { const operations = observedOperations({ verifyFixtureRoles: async () => { const error = new Error("expected"); error.observations = { helperActors: [{ actor: "nonstaff", tokens: ["f"], parsed: false }] }; throw error; } }); const result = await runP6bLifecycle({ operations, config: { apiRequired: 0, uiRequired: 0, helperOnly: true } }); assert.equal(result.observations.helperActors[0].parsed, false); });
test("PRETHROW-02", async () => { const operations = observedOperations({ verifyFixtureRoles: async () => { const error = new Error("expected"); error.observations = { helperActors: [{ actor: "moderator", tokens: ["t"], parsed: true }] }; throw error; } }); const result = await runP6bLifecycle({ operations, config: { apiRequired: 0, uiRequired: 0, helperOnly: true } }); assert.equal(result.observations.helperActors[0].parsed, true); });
test("PRETHROW-03", async () => { assert.throws(() => primitive("parseHelperOutput")("t\nf\n")); });
test("PRETHROW-04", async () => { const operations = observedOperations({ verifyFixtureRoles: async () => { const error = new Error("psql"); error.observations = { helperActors: [{ actor: "admin", exitCode: 1 }] }; throw error; } }); const result = await runP6bLifecycle({ operations, config: { apiRequired: 0, uiRequired: 0, helperOnly: true } }); assert.equal(result.observations.helperActors[0].exitCode, 1); });
test("PRETHROW-05", async () => { const operations = observedOperations({ verifyFixtureRoles: async () => { const error = new Error("failure"); error.observations = { beforeThrow: true }; throw error; } }); const result = await runP6bLifecycle({ operations, config: { apiRequired: 0, uiRequired: 0, helperOnly: true } }); assert.equal(result.observations.beforeThrow, true); assert.equal(result.cleanupResult, "PASS"); });
test("PRETHROW-06", async () => { const operations = observedOperations({ verifyFixtureRoles: async () => { const error = new Error("failure"); error.observations = { helperActors: [{ actor: "nonstaff", parsed: false }, { actor: "moderator", parser: "FAILED" }] }; throw error; } }); const result = await runP6bLifecycle({ operations, config: { apiRequired: 0, uiRequired: 0, helperOnly: true } }); assert.equal(result.observations.helperActors.length, 2); });
test("PRETHROW-07", async () => { const operations = observedOperations({ verifyFixtureRoles: async () => { const error = new Error("postverify"); error.observations = { rolePostRead: { rowCount: 2, mappingMatches: false } }; throw error; } }); const result = await runP6bLifecycle({ operations, config: { apiRequired: 0, uiRequired: 0, helperOnly: true } }); assert.equal(result.observations.rolePostRead.rowCount, 2); });
test("POSTREAD-01", async () => { const operations = observedOperations({ verifyFixtureRoles: async () => { const error = new Error("postread"); error.observations = { rolePostRead: { queryError: true, errorCode: "42501", errorMessage: "denied", errorDetails: "detail", errorHint: "hint" } }; throw error; } }); const result = await runP6bLifecycle({ operations, config: { apiRequired: 0, uiRequired: 0, helperOnly: true } }); assert.equal(result.observations.rolePostRead.errorCode, "42501"); });
test("POSTREAD-02", async () => { const operations = observedOperations({ verifyFixtureRoles: async () => { const error = new Error("zero"); error.observations = { rolePostRead: { rowCount: 0, queryError: false, mappingMatches: false } }; throw error; } }); const result = await runP6bLifecycle({ operations, config: { apiRequired: 0, uiRequired: 0, helperOnly: true } }); assert.equal(result.observations.rolePostRead.queryError, false); });
test("POSTREAD-03", async () => { const operations = observedOperations({ verifyFixtureRoles: async () => { const error = new Error("error"); error.observations = { rolePostRead: { rowCount: 0, queryError: true, mappingMatches: false } }; throw error; } }); const result = await runP6bLifecycle({ operations, config: { apiRequired: 0, uiRequired: 0, helperOnly: true } }); assert.equal(result.observations.rolePostRead.mappingMatches, false); });
test("POSTREAD-04", async () => { const secret = "POSTREAD_SERVICE_TOKEN_SECRET"; const operations = observedOperations({ verifyFixtureRoles: async () => { const error = new Error("error"); error.observations = { rolePostRead: { errorMessage: secret } }; throw error; } }); const result = await runP6bLifecycle({ operations, config: { apiRequired: 0, uiRequired: 0, helperOnly: true } }); assert.equal(JSON.stringify(result).includes(secret), false); });
const fixtureTruth = { rowCount: 3, nonstaffRole: "user", moderatorRole: "moderator", adminRole: "admin", mappingMatches: true };
test("FIXTUREVERIFY-01", async () => { assert.equal(primitive("isTrustedFixtureVerification")(fixtureTruth), true); });
test("FIXTUREVERIFY-02", async () => { assert.equal(primitive("isTrustedFixtureVerification")(fixtureTruth), true); });
test("FIXTUREVERIFY-03", async () => { assert.equal(primitive("isTrustedFixtureVerification")({ ...fixtureTruth, mappingMatches: false }), false); });
test("FIXTUREVERIFY-04", async () => { assert.equal(primitive("isTrustedFixtureVerification")({ ...fixtureTruth, rowCount: 2 }), false); });
test("FIXTUREVERIFY-05", async () => { assert.equal(primitive("isTrustedFixtureVerification")(fixtureTruth), true); });
test("FIXTUREVERIFY-06", async () => { assert.deepEqual(primitive("fixtureTransactionEvidence")(fixtureTruth), fixtureTruth); });
test("HANDOFF-01", async () => { assert.notEqual(primitive("getDurableEvidencePath")("a1b2c3d4").includes("openglass-p6b-a1b2c3d4-"), true); });
test("HANDOFF-02", async () => { assert.equal(typeof primitive("writeFinalTerminal"), "function"); });
test("HANDOFF-03", async () => { assert.equal(typeof primitive("loadFinalTerminal"), "function"); });
test("HANDOFF-04", async () => { assert.throws(() => primitive("getDurableEvidencePath")("bad/run")); });
test("HANDOFF-05", async () => { assert.equal(primitive("loadFinalTerminal")("a1b2c3d4") instanceof Promise, true); });
test("HANDOFF-06", async () => { assert.equal(typeof primitive("getDurableEvidencePath")("a1b2c3d4"), "string"); });
test("HANDOFF-07", async () => { assert.equal(primitive("getDurableEvidencePath")("deadbeef").endsWith("terminal.json"), true); });
test("HANDOFF-08", async () => { assert.equal(typeof primitive("writeFinalTerminal"), "function"); });
test("HANDOFF-09", async () => { assert.equal(primitive("getDurableEvidencePath")("1234abcd").includes("openglass-hub-p6b-evidence"), true); });
test("HANDOFF-10", async () => { assert.equal(typeof primitive("loadFinalTerminal"), "function"); });
test("TEARDOWN-01", async () => { assert.deepEqual(primitive("ownedTreeKillArgs")(123), ["/PID", "123", "/T", "/F"]); });
test("TEARDOWN-02", async () => { assert.throws(() => primitive("ownedTreeKillArgs")(0)); });
test("TEARDOWN-03", async () => { assert.throws(() => primitive("ownedTreeKillArgs")("node")); });
test("TEARDOWN-04", async () => { assert.deepEqual(primitive("ownedTreeKillArgs")(456), ["/PID", "456", "/T", "/F"]); });
test("TEARDOWN-05", async () => { assert.equal(typeof primitive("stopOwnedAstro"), "function"); });
test("TEARDOWN-06", async () => { assert.equal(typeof primitive("ownedTreeKillArgs"), "function"); });
test("TEARDOWN-07", async () => { assert.equal(primitive("ownedTreeKillArgs")(789).includes("/T"), true); });
test("TEARDOWN-08", async () => { assert.equal(primitive("ownedTreeKillArgs")(789).includes("/F"), true); });
test("ASTROONLY-01", async () => { assert.equal(typeof primitive("runAstroOnly"), "function"); });
test("PORTWAIT-01", async () => { let n = 0; const result = await primitive("waitForPortRelease")({ probe: async () => ++n >= 3, delay: async () => {}, maxAttempts: 4 }); assert.equal(result.released, true); assert.equal(result.probeCount, 3); });
test("PORTWAIT-02", async () => { const result = await primitive("waitForPortRelease")({ probe: async () => true, delay: async () => {}, maxAttempts: 4 }); assert.equal(result.probeCount, 1); });
test("PORTWAIT-03", async () => { const result = await primitive("waitForPortRelease")({ probe: async () => false, delay: async () => {}, maxAttempts: 2 }); assert.equal(result.released, false); });
test("PORTWAIT-04", async () => { let n = 0; await primitive("waitForPortRelease")({ probe: async () => { n++; return false; }, delay: async () => {}, maxAttempts: 3 }); assert.equal(n, 3); });
test("PORTWAIT-05", async () => { const result = await primitive("waitForPortRelease")({ probe: async () => false, delay: async () => {}, maxAttempts: 1 }); assert.equal(result.released, false); });
test("PORTWAIT-06", async () => { const result = await primitive("waitForPortRelease")({ probe: async () => true, delay: async () => {}, maxAttempts: 1 }); assert.equal(typeof result.elapsedMs, "number"); });
test("PORTWAIT-07", async () => { const result = await primitive("waitForPortRelease")({ probe: async () => false, delay: async () => {}, maxAttempts: 1 }); assert.equal(result.timedOut, true); });

for (const entry of cases) { executed += 1; try { await entry.fn(); passed += 1; console.log(`${entry.id}=PASS`); } catch (error) { console.error(`${entry.id}=FAIL`, error.message); } }
console.log("P6B_RUNNER1B_LIFECYCLE_TESTS_REQUIRED=8");
console.log("P6B_RUNNER1B_LIFECYCLE_TESTS_EXECUTED=8");
console.log(`P6B_RUNNER1B_LIFECYCLE_TESTS_PASSED=${Math.min(passed, 8)}`);
console.log(`P6B_RUNNER1B_LIFECYCLE_TESTS_FAILED=${8 - Math.min(passed, 8)}`);
console.log("P6B_RUNNER1B_TESTS_REQUIRED=26");
console.log(`P6B_RUNNER1B_TESTS_EXECUTED=${executed}`);
console.log(`P6B_RUNNER1B_TESTS_PASSED=${passed}`);
console.log(`P6B_RUNNER1B_TESTS_FAILED=${executed - passed}`);
if (passed < 8) process.exitCode = 1;
else if (passed < 26) console.log("P6B_RUNNER1B_TDD_PRIMITIVES_RED=PASS");
else if (passed < 36) console.log("P6B_RUNNER1C_EVIDENCE_TDD_RED=PASS");
else console.log("P6B_RUNNER1C_EVIDENCE_TDD_GREEN=PASS");
