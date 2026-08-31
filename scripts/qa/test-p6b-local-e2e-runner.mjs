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
    runApi: operation("runApi", { passed: 16 }), startBrowser: operation("startBrowser", { started: true }), runUi: operation("runUi", { passed: 16, observerCounters: { observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 } }),
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

// RUNNER2D browser wiring is deliberately adapter-tested: these checks must never
// launch Chromium or contact Supabase while proving the lifecycle contract.
test("BROWSERAUTH-01", async () => {
  const { calls, operations } = makeOperations({ runApi: async () => ({ cases: [] }) });
  await runP6bLifecycle({ operations, config: { mode: "UI_ONLY", apiRequired: 0, uiRequired: 16 } });
  assert.equal(calls.includes("startBrowser"), true);
});
test("FOCUSED-01", () => { assert.deepEqual(primitive("focusedUiModeConfig")(), { mode: "FOCUSED_UIE2E02", apiRequired: 0, uiRequired: 2, focusedUiOnly: true }); });
const focus03Config = { mode: "FOCUSED_UIE2E03", apiRequired: 0, uiRequired: 3, focusedUiOnly: true, focusedUiCaseLimit: 3, finalizeOnUiFailure: true };
const focus03Ledger = (failedAt = null) => Array.from({ length: 3 }, (_, index) => ({ caseId: `UIE2E-${String(index + 1).padStart(2, "0")}`, result: failedAt === index + 1 ? "FAIL" : "PASS", expected: "focused UI contract", observed: "safe" }));
const focus03Run = async (overrides = {}) => {
  const { calls, operations } = makeOperations({ runApi: async () => ({ cases: [] }), runUi: async () => ({ cases: focus03Ledger(), observerCounters: { observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 } }), ...overrides });
  return { calls, result: await runP6bLifecycle({ operations, config: focus03Config }) };
};
test("FOCUS03-01", () => { assert.deepEqual(primitive("focusedUiE2e03ModeConfig")(), focus03Config); assert.equal(primitive("parseRunnerMode")(["node", "runner", "--focused-uie2e03"]), "FOCUSED_UIE2E03"); });
test("FOCUS03-02", async () => { const { result } = await focus03Run(); assert.equal(result.uiRequired, 3); });
test("FOCUS03-03", async () => { const { result } = await focus03Run(); assert.equal(result.uiCases[0].caseId, "UIE2E-01"); });
test("FOCUS03-04", async () => { const { result } = await focus03Run(); assert.equal(result.uiCases[1].caseId, "UIE2E-02"); });
test("FOCUS03-05", async () => { const { result } = await focus03Run(); assert.equal(result.uiCases[2].caseId, "UIE2E-03"); });
test("FOCUS03-06", async () => { const { result } = await focus03Run(); assert.equal(result.uiCases.some((entry) => entry.caseId === "UIE2E-04"), false); });
test("FOCUS03-07", async () => { const { result } = await focus03Run(); assert.equal(result.uiCases.some((entry) => /^UIE2E-(0[5-9]|1[0-6])$/.test(entry.caseId)), false); });
test("FOCUS03-08", async () => { const { result } = await focus03Run(); assert.deepEqual([result.uiExecuted, result.uiPassed, result.uiFailed], [3, 3, 0]); });
test("FOCUS03-09", async () => { const { calls, result } = await focus03Run({ runUi: async () => ({ cases: focus03Ledger(3), observerCounters: { observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 } }) }); assert.deepEqual([result.firstFailureCase, result.uiExecuted, result.uiFailed], ["UIE2E-03", 3, 1]); assert.equal(calls.includes("runFinal"), true); });
test("FOCUS03-10", async () => { const { calls } = await focus03Run(); assert.equal(calls.includes("runFinal"), true); });
test("FOCUS03-11", async () => { const { result } = await focus03Run({ runFinal: async () => ({ observations: { postCleanup: { canonicalExpectedCount: 24, canonicalObservedCount: 24, ownedRemainingCount: 0, unexpectedNonCanonicalCount: 0, finalDataGate: "PASS" } } }) }); assert.equal(result.observations.postCleanup.finalDataGate, "PASS"); });
test("FOCUS03-12", async () => { const { calls } = await focus03Run(); assert.deepEqual(calls.slice(-4), ["cleanupBrowser", "stopAstro", "stopSupabase", "verifyCleanup"]); });
test("FOCUS03-13", async () => { const runId = "f0300013"; await primitive("runLifecycleWithDurableTerminal")({ runId, mode: "FOCUSED_UIE2E03", operations: makeOperations({ runApi: async () => ({ cases: [] }), runUi: async () => ({ cases: focus03Ledger(), observerCounters: { observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 } }) }).operations, config: focus03Config }); assert.equal((await primitive("loadFinalTerminal")(runId)).mode, "FOCUSED_UIE2E03"); });
test("FOCUS03-14", async () => { const { result } = await focus03Run(); assert.deepEqual([result.observerPendingPromises, result.observerStaleListeners, result.observerUnhandledRejections], [0, 0, 0]); });
test("FOCUS03-15", async () => { const progress = primitive("createUiProgressState")({ runId: "f0300015", mode: "FOCUSED_UIE2E03" }); for (const caseId of ["UIE2E-01", "UIE2E-02", "UIE2E-03"]) await primitive("runUiCaseWithLiveness")({ caseId, action: async () => ({}), progress }); assert.equal(progress.snapshot().uiLastCompletedCase, "UIE2E-03"); });
test("FOCUS03-16", () => { assert.deepEqual(primitive("focusedUiModeConfig")(), { mode: "FOCUSED_UIE2E02", apiRequired: 0, uiRequired: 2, focusedUiOnly: true }); });
test("FOCUS03-17", async () => { const result = await runP6bLifecycle({ operations: fullOperations(), config: { mode: "UI_ONLY", apiRequired: 0, uiRequired: 16 } }); assert.equal(result.uiRequired, 16); });
test("FOCUS03-18", async () => { const result = await runP6bLifecycle({ operations: fullOperations(), config: fullConfig }); assert.deepEqual([result.apiRequired, result.uiRequired], [16, 16]); });
test("FOCUS03-19", async () => { const { result } = await focus03Run(); assert.equal(result.apiCases.length, 0); });
test("FOCUS03-20", async () => { const runId = "f0300020"; await primitive("runLifecycleWithDurableTerminal")({ runId, mode: "FOCUSED_UIE2E03", operations: makeOperations({ snapshot: async () => ({ observations: { token: "focus03-secret" } }), runApi: async () => ({ cases: [] }), runUi: async () => ({ cases: focus03Ledger(), observerCounters: { observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 } }) }).operations, config: focus03Config }); assert.equal(JSON.stringify(await primitive("loadFinalTerminal")(runId)).includes("focus03-secret"), false); });
const focus12Config = { mode: "FOCUSED_UIE2E12", apiRequired: 0, uiRequired: 12, focusedUiOnly: true, focusedUiCaseLimit: 12, finalizeOnUiFailure: true };
const focus13Config = { mode: "FOCUSED_UIE2E13", apiRequired: 0, uiRequired: 13, focusedUiOnly: true, focusedUiCaseLimit: 13, finalizeOnUiFailure: true };
const focus13Ledger = (failedAt = null) => Array.from({ length: 13 }, (_, index) => ({ caseId: `UIE2E-${String(index + 1).padStart(2, "0")}`, result: failedAt === index + 1 ? "FAIL" : "PASS" }));
const focus13Run = async (overrides = {}) => { const { calls, operations } = makeOperations({runApi:async()=>({cases:[]}),runUi:async()=>({cases:focus13Ledger(),observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}}),...overrides}); return {calls,result:await runP6bLifecycle({operations,config:focus13Config})}; };
test("FOCUS13-01",()=>assert.equal(primitive("parseRunnerMode")(["node","runner","--focused-uie2e13"]),"FOCUSED_UIE2E13"));
test("FOCUS13-02",()=>assert.equal(primitive("focusedUiE2e13ModeConfig")().mode,"FOCUSED_UIE2E13"));
test("FOCUS13-03",()=>assert.equal(primitive("focusedUiE2e13ModeConfig")().uiRequired,13));
test("FOCUS13-04",async()=>assert.equal((await focus13Run()).result.uiCases[0].caseId,"UIE2E-01"));
test("FOCUS13-05",async()=>assert.equal((await focus13Run()).result.uiCases[11].caseId,"UIE2E-12"));
test("FOCUS13-06",async()=>assert.equal((await focus13Run()).result.uiCases[12].caseId,"UIE2E-13"));
test("FOCUS13-07",async()=>assert.equal((await focus13Run()).result.uiCases.some(x=>x.caseId==="UIE2E-14"),false));
test("FOCUS13-08",async()=>assert.equal((await focus13Run()).result.uiCases.some(x=>x.caseId==="UIE2E-15"),false));
test("FOCUS13-09",async()=>assert.equal((await focus13Run()).result.uiCases.some(x=>x.caseId==="UIE2E-16"),false));
test("FOCUS13-10",async()=>assert.deepEqual([(await focus13Run()).result.uiExecuted,(await focus13Run()).result.uiPassed,(await focus13Run()).result.uiFailed],[13,13,0]));
test("FOCUS13-11",async()=>{const {calls,result}=await focus13Run({runUi:async()=>({cases:focus13Ledger(13),observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})});assert.equal(result.firstFailureCase,"UIE2E-13");assert.equal(calls.includes("runFinal"),true);});
test("FOCUS13-12",async()=>assert.equal((await focus13Run()).result.apiCases.length,0));
test("FOCUS13-13",()=>assert.equal(primitive("focusedUiE2e12ModeConfig")().uiRequired,12));
const focus14Config = { mode: "FOCUSED_UIE2E14", apiRequired: 0, uiRequired: 14, focusedUiOnly: true, focusedUiCaseLimit: 14, finalizeOnUiFailure: true };
const focus14Ledger = (failedAt = null) => Array.from({ length: 14 }, (_, index) => ({ caseId: `UIE2E-${String(index + 1).padStart(2, "0")}`, result: failedAt === index + 1 ? "FAIL" : "PASS" }));
const focus14Run = async (overrides = {}) => { const { calls, operations } = makeOperations({ runApi: async () => ({ cases: [] }), runUi: async () => ({ cases: focus14Ledger(), observerCounters: { observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 } }), ...overrides }); if (!overrides.runFinal) operations.runFinal = async () => { calls.push("runFinal"); return { observations: { postCleanup: { canonicalExpectedCount: 24, canonicalObservedCount: 24, ownedRemainingCount: 0, unexpectedNonCanonicalCount: 0, finalDataGate: "PASS" } } }; }; return { calls, result: await runP6bLifecycle({ operations, config: focus14Config }) }; };
test("FOCUS14-01",()=>assert.equal(primitive("parseRunnerMode")(["node","runner","--focused-uie2e14"]),"FOCUSED_UIE2E14"));
test("FOCUS14-02",()=>assert.equal(primitive("focusedUiE2e14ModeConfig")().mode,"FOCUSED_UIE2E14"));
test("FOCUS14-03",()=>assert.equal(primitive("focusedUiE2e14ModeConfig")().uiRequired,14));
test("FOCUS14-04",async()=>assert.equal((await focus14Run()).result.uiCases[0].caseId,"UIE2E-01"));
test("FOCUS14-05",async()=>assert.equal((await focus14Run()).result.uiCases[12].caseId,"UIE2E-13"));
test("FOCUS14-06",async()=>assert.equal((await focus14Run()).result.uiCases[13].caseId,"UIE2E-14"));
test("FOCUS14-07",async()=>assert.equal((await focus14Run()).result.uiCases.some(x=>x.caseId==="UIE2E-15"),false));
test("FOCUS14-08",async()=>assert.equal((await focus14Run()).result.uiCases.some(x=>x.caseId==="UIE2E-16"),false));
test("FOCUS14-09",async()=>assert.deepEqual([(await focus14Run()).result.uiExecuted,(await focus14Run()).result.uiPassed,(await focus14Run()).result.uiFailed],[14,14,0]));
test("FOCUS14-10",async()=>{const {calls,result}=await focus14Run({runUi:async()=>({cases:focus14Ledger(14),observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})});assert.equal(result.firstFailureCase,"UIE2E-14");assert.equal(calls.includes("runFinal"),true);});
test("FOCUS14-11",async()=>assert.equal((await focus14Run()).calls.filter(x=>x==="runFinal").length,1));
test("FOCUS14-12",async()=>{const {calls,result}=await focus14Run({runUi:async()=>{throw caseError("UIE2E-14");}});assert.equal(result.acceptanceResult,"BLOCKED");assert.equal(calls.filter(x=>x==="runFinal").length,1);});
test("FOCUS14-13",async()=>{const {calls,result}=await focus14Run({runUi:async()=>({cases:[await primitive("runUiCaseWithLiveness")({caseId:"UIE2E-14",action:()=>new Promise(()=>{}),timeoutMs:5})],observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})});assert.equal(result.acceptanceResult,"BLOCKED");assert.equal(calls.filter(x=>x==="runFinal").length,1);});
test("FOCUS14-14",async()=>assert.equal((await focus14Run()).calls.filter(x=>x==="runFinal").length,1));
test("FOCUS14-15",async()=>assert.equal((await focus14Run()).result.observations.postCleanup.ownedRemainingCount,0));
test("FOCUS14-16",async()=>assert.equal((await focus14Run()).result.observations.postCleanup.finalDataGate,"PASS"));
test("FOCUS14-17",async()=>assert.deepEqual((await focus14Run()).calls.slice(-4),["cleanupBrowser","stopAstro","stopSupabase","verifyCleanup"]));
test("FOCUS14-18",async()=>{const runId="f1400018";await primitive("runLifecycleWithDurableTerminal")({runId,mode:"FOCUSED_UIE2E14",operations:makeOperations({runApi:async()=>({cases:[]}),runUi:async()=>({cases:focus14Ledger(),observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})}).operations,config:focus14Config});assert.equal((await primitive("loadFinalTerminal")(runId)).mode,"FOCUSED_UIE2E14");});
test("FOCUS14-19",async()=>assert.deepEqual([(await focus14Run()).result.observerPendingPromises,(await focus14Run()).result.observerStaleListeners,(await focus14Run()).result.observerUnhandledRejections],[0,0,0]));
test("FOCUS14-20",async()=>{const progress=primitive("createUiProgressState")({runId:"f1400020",mode:"FOCUSED_UIE2E14"});for(const caseId of focus14Ledger().map((x)=>x.caseId))await primitive("runUiCaseWithLiveness")({caseId,action:async()=>({}),progress});assert.equal(progress.snapshot().uiLastCompletedCase,"UIE2E-14");});
test("FOCUS14-21",()=>assert.equal(primitive("focusedUiModeConfig")().uiRequired,2));
test("FOCUS14-22",()=>assert.equal(primitive("focusedUiE2e03ModeConfig")().uiRequired,3));
test("FOCUS14-23",()=>assert.equal(primitive("focusedUiE2e12ModeConfig")().uiRequired,12));
test("FOCUS14-24",()=>assert.equal(primitive("focusedUiE2e13ModeConfig")().uiRequired,13));
test("FOCUS14-25",async()=>assert.equal((await runP6bLifecycle({operations:fullOperations(),config:{mode:"UI_ONLY",apiRequired:0,uiRequired:16}})).uiRequired,16));
test("FOCUS14-26",async()=>assert.deepEqual([(await runP6bLifecycle({operations:fullOperations(),config:fullConfig})).apiRequired,(await runP6bLifecycle({operations:fullOperations(),config:fullConfig})).uiRequired],[16,16]));
test("FOCUS14-27",async()=>assert.equal((await focus14Run()).result.apiCases.length,0));
test("FOCUS14-28",async()=>{const runId="f1400028";await primitive("runLifecycleWithDurableTerminal")({runId,mode:"FOCUSED_UIE2E14",operations:makeOperations({snapshot:async()=>({observations:{token:"focus14-secret"}}),runApi:async()=>({cases:[]}),runUi:async()=>({cases:focus14Ledger(),observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})}).operations,config:focus14Config});assert.equal(JSON.stringify(await primitive("loadFinalTerminal")(runId)).includes("focus14-secret"),false);});

const focus15Config = { mode: "FOCUSED_UIE2E15", apiRequired: 0, uiRequired: 15, focusedUiOnly: true, focusedUiCaseLimit: 15, finalizeOnUiFailure: true };
const focus15Ledger = (failedAt = null) => Array.from({ length: 15 }, (_, index) => ({ caseId: `UIE2E-${String(index + 1).padStart(2, "0")}`, result: failedAt === index + 1 ? "FAIL" : "PASS" }));
const focus15Run = async (overrides = {}) => { const { calls, operations } = makeOperations({ runApi: async () => ({ cases: [] }), runUi: async () => ({ cases: focus15Ledger(), observerCounters: { observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 } }), ...overrides }); if (!overrides.runFinal) operations.runFinal = async () => { calls.push("runFinal"); return { observations: { postCleanup: { canonicalExpectedCount: 24, canonicalObservedCount: 24, ownedRemainingCount: 0, unexpectedNonCanonicalCount: 0, finalDataGate: "PASS" } } }; }; return { calls, result: await runP6bLifecycle({ operations, config: focus15Config }) }; };
test("FOCUS15-01",()=>assert.equal(primitive("parseRunnerMode")(["node","runner","--focused-uie2e15"]),"FOCUSED_UIE2E15"));
test("FOCUS15-02",()=>assert.equal(primitive("focusedUiE2e15ModeConfig")().mode,"FOCUSED_UIE2E15"));
test("FOCUS15-03",()=>assert.equal(primitive("focusedUiE2e15ModeConfig")().uiRequired,15));
test("FOCUS15-04",async()=>assert.equal((await focus15Run()).result.uiCases[0].caseId,"UIE2E-01"));
test("FOCUS15-05",async()=>assert.equal((await focus15Run()).result.uiCases[13].caseId,"UIE2E-14"));
test("FOCUS15-06",async()=>assert.equal((await focus15Run()).result.uiCases[14].caseId,"UIE2E-15"));
test("FOCUS15-07",async()=>assert.equal((await focus15Run()).result.uiCases.some(x=>x.caseId==="UIE2E-16"),false));
test("FOCUS15-08",async()=>assert.deepEqual([(await focus15Run()).result.uiExecuted,(await focus15Run()).result.uiPassed,(await focus15Run()).result.uiFailed],[15,15,0]));
test("FOCUS15-09",async()=>{const {calls,result}=await focus15Run({runUi:async()=>({cases:focus15Ledger(15),observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})});assert.equal(result.firstFailureCase,"UIE2E-15");assert.equal(result.uiCases.some(x=>x.caseId==="UIE2E-16"),false);assert.equal(calls.filter(x=>x==="runFinal").length,1);});
test("FOCUS15-10",async()=>assert.equal((await focus15Run({runUi:async()=>({cases:focus15Ledger(15),observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})})).calls.filter(x=>x==="runFinal").length,1));
test("FOCUS15-11",async()=>assert.equal((await focus15Run({runUi:async()=>{throw caseError("UIE2E-15");}})).calls.filter(x=>x==="runFinal").length,1));
test("FOCUS15-12",async()=>assert.equal((await focus15Run({runUi:async()=>({cases:[await primitive("runUiCaseWithLiveness")({caseId:"UIE2E-15",action:()=>new Promise(()=>{}),timeoutMs:5})],observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})})).calls.filter(x=>x==="runFinal").length,1));
test("FOCUS15-13",async()=>assert.equal((await focus15Run()).calls.filter(x=>x==="runFinal").length,1));
test("FOCUS15-14",async()=>assert.equal((await focus15Run()).result.observations.postCleanup.ownedRemainingCount,0));
test("FOCUS15-15",async()=>assert.equal((await focus15Run()).result.observations.postCleanup.finalDataGate,"PASS"));
test("FOCUS15-16",async()=>assert.deepEqual((await focus15Run()).calls.slice(-4),["cleanupBrowser","stopAstro","stopSupabase","verifyCleanup"]));
test("FOCUS15-17",async()=>{const runId="f1500017";await primitive("runLifecycleWithDurableTerminal")({runId,mode:"FOCUSED_UIE2E15",operations:makeOperations({runApi:async()=>({cases:[]}),runUi:async()=>({cases:focus15Ledger(),observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})}).operations,config:focus15Config});assert.equal((await primitive("loadFinalTerminal")(runId)).mode,"FOCUSED_UIE2E15");});
test("FOCUS15-18",async()=>assert.deepEqual([(await focus15Run()).result.observerPendingPromises,(await focus15Run()).result.observerStaleListeners,(await focus15Run()).result.observerUnhandledRejections],[0,0,0]));
test("FOCUS15-19",async()=>{const progress=primitive("createUiProgressState")({runId:"f1500019",mode:"FOCUSED_UIE2E15"});for(const caseId of focus15Ledger().map((x)=>x.caseId))await primitive("runUiCaseWithLiveness")({caseId,action:async()=>({}),progress});assert.equal(progress.snapshot().uiLastCompletedCase,"UIE2E-15");});
test("FOCUS15-20",()=>assert.equal(primitive("focusedUiModeConfig")().uiRequired,2));
test("FOCUS15-21",()=>assert.equal(primitive("focusedUiE2e03ModeConfig")().uiRequired,3));
test("FOCUS15-22",()=>assert.equal(primitive("focusedUiE2e12ModeConfig")().uiRequired,12));
test("FOCUS15-23",()=>assert.equal(primitive("focusedUiE2e13ModeConfig")().uiRequired,13));
test("FOCUS15-24",()=>assert.equal(primitive("focusedUiE2e14ModeConfig")().uiRequired,14));
test("FOCUS15-25",async()=>assert.equal((await runP6bLifecycle({operations:fullOperations(),config:{mode:"UI_ONLY",apiRequired:0,uiRequired:16}})).uiRequired,16));
test("FOCUS15-26",async()=>assert.deepEqual([(await runP6bLifecycle({operations:fullOperations(),config:fullConfig})).apiRequired,(await runP6bLifecycle({operations:fullOperations(),config:fullConfig})).uiRequired],[16,16]));
test("FOCUS15-27",async()=>assert.equal((await focus15Run()).result.apiCases.length,0));
test("FOCUS15-28",async()=>{const runId="f1500028";await primitive("runLifecycleWithDurableTerminal")({runId,mode:"FOCUSED_UIE2E15",operations:makeOperations({snapshot:async()=>({observations:{token:"focus15-secret"}}),runApi:async()=>({cases:[]}),runUi:async()=>({cases:focus15Ledger(),observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})}).operations,config:focus15Config});assert.equal(JSON.stringify(await primitive("loadFinalTerminal")(runId)).includes("focus15-secret"),false);});
const focus12Ledger = (failedAt = null) => Array.from({ length: 12 }, (_, index) => ({ caseId: `UIE2E-${String(index + 1).padStart(2, "0")}`, result: failedAt === index + 1 ? "FAIL" : "PASS", expected: "focused UI12 contract", observed: "safe" }));
const focus12Run = async (overrides = {}) => { const { calls, operations } = makeOperations({ runApi: async () => ({ cases: [] }), runUi: async () => ({ cases: focus12Ledger(), observerCounters: { observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 } }), ...overrides }); if (!overrides.runFinal) operations.runFinal = async () => { calls.push("runFinal"); return { observations: { postCleanup: { canonicalExpectedCount: 24, canonicalObservedCount: 24, ownedRemainingCount: 0, unexpectedNonCanonicalCount: 0, finalDataGate: "PASS" } } }; }; return { calls, result: await runP6bLifecycle({ operations, config: focus12Config }) }; };
test("FOCUS12-01",()=>assert.equal(primitive("parseRunnerMode")(["node","runner","--focused-uie2e12"]),"FOCUSED_UIE2E12"));
test("FOCUS12-02",()=>assert.equal(primitive("focusedUiE2e12ModeConfig")().mode,"FOCUSED_UIE2E12"));
test("FOCUS12-03",()=>assert.equal(primitive("focusedUiE2e12ModeConfig")().uiRequired,12));
test("FOCUS12-04",async()=>assert.equal((await focus12Run()).result.uiCases[0].caseId,"UIE2E-01"));
test("FOCUS12-05",async()=>assert.equal((await focus12Run()).result.uiCases.at(-1).caseId,"UIE2E-12"));
test("FOCUS12-06",async()=>assert.equal((await focus12Run()).result.uiCases.some((x)=>x.caseId==="UIE2E-13"),false));
test("FOCUS12-07",async()=>assert.equal((await focus12Run()).result.uiCases.some((x)=>x.caseId==="UIE2E-14"),false));
test("FOCUS12-08",async()=>assert.equal((await focus12Run()).result.uiCases.some((x)=>x.caseId==="UIE2E-15"),false));
test("FOCUS12-09",async()=>assert.equal((await focus12Run()).result.uiCases.some((x)=>x.caseId==="UIE2E-16"),false));
test("FOCUS12-10",async()=>assert.deepEqual([(await focus12Run()).result.uiExecuted,(await focus12Run()).result.uiPassed,(await focus12Run()).result.uiFailed],[12,12,0]));
test("FOCUS12-11",async()=>{const {calls,result}=await focus12Run({runUi:async()=>({cases:focus12Ledger(12),observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})});assert.equal(result.firstFailureCase,"UIE2E-12");assert.equal(result.uiCases.some((x)=>x.caseId==="UIE2E-13"),false);assert.equal(calls.includes("runFinal"),true);});
test("FOCUS12-12",async()=>{const {calls,result}=await focus12Run({runUi:async()=>{const e=new Error("UI12 unexpected");e.caseId="UIE2E-12";throw e;}});assert.equal(result.firstFailureCase,"UIE2E-12");assert.equal(calls.includes("runFinal"),true);});
test("FOCUS12-13",async()=>assert.equal((await focus12Run()).calls.includes("runFinal"),true));
test("FOCUS12-14",async()=>assert.equal((await focus12Run()).result.observations.postCleanup.ownedRemainingCount,0));
test("FOCUS12-15",async()=>assert.equal((await focus12Run()).result.observations.postCleanup.finalDataGate,"PASS"));
test("FOCUS12-16",async()=>assert.deepEqual((await focus12Run()).calls.slice(-4),["cleanupBrowser","stopAstro","stopSupabase","verifyCleanup"]));
test("FOCUS12-17",async()=>{const runId="f1200017";await primitive("runLifecycleWithDurableTerminal")({runId,mode:"FOCUSED_UIE2E12",operations:makeOperations({runApi:async()=>({cases:[]}),runUi:async()=>({cases:focus12Ledger(),observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})}).operations,config:focus12Config});assert.equal((await primitive("loadFinalTerminal")(runId)).mode,"FOCUSED_UIE2E12");});
test("FOCUS12-18",async()=>assert.deepEqual([(await focus12Run()).result.observerPendingPromises,(await focus12Run()).result.observerStaleListeners,(await focus12Run()).result.observerUnhandledRejections],[0,0,0]));
test("FOCUS12-19",async()=>{const progress=primitive("createUiProgressState")({runId:"f1200019",mode:"FOCUSED_UIE2E12"});for(const caseId of focus12Ledger().map((x)=>x.caseId))await primitive("runUiCaseWithLiveness")({caseId,action:async()=>({}),progress});assert.equal(progress.snapshot().uiLastCompletedCase,"UIE2E-12");});
test("FOCUS12-20",()=>assert.equal(primitive("focusedUiModeConfig")().uiRequired,2));
test("FOCUS12-21",()=>assert.equal(primitive("focusedUiE2e03ModeConfig")().uiRequired,3));
test("FOCUS12-22",async()=>assert.equal((await runP6bLifecycle({operations:fullOperations(),config:{mode:"UI_ONLY",apiRequired:0,uiRequired:16}})).uiRequired,16));
test("FOCUS12-23",async()=>assert.deepEqual([(await runP6bLifecycle({operations:fullOperations(),config:fullConfig})).apiRequired,(await runP6bLifecycle({operations:fullOperations(),config:fullConfig})).uiRequired],[16,16]));
test("FOCUS12-24",async()=>assert.equal((await focus12Run()).result.apiCases.length,0));
test("FOCUS12-25",async()=>{const runId="f1200025";await primitive("runLifecycleWithDurableTerminal")({runId,mode:"FOCUSED_UIE2E12",operations:makeOperations({snapshot:async()=>({observations:{token:"focus12-secret"}}),runApi:async()=>({cases:[]}),runUi:async()=>({cases:focus12Ledger(),observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})}).operations,config:focus12Config});assert.equal(JSON.stringify(await primitive("loadFinalTerminal")(runId)).includes("focus12-secret"),false);});
const archiveLocatorPage = () => { const calls=[]; return { calls, getByRole: (role, options) => { calls.push({role,options}); const names=["归档","已归档 (0)"]; const matches=names.filter((name)=>options.exact?name===options.name:name.includes(options.name)); if(matches.length!==1) throw new Error(`strict collision: ${matches.join(",")}`); return { accessibleName:matches[0] }; } }; };
test("STRICTLOC-01",()=>{const page=archiveLocatorPage();assert.throws(()=>page.getByRole("button",{name:"归档"}),/strict collision/);});
test("STRICTLOC-02",()=>{const page=archiveLocatorPage();assert.equal(primitive("archiveMutationLocator")(page).accessibleName,"归档");});
test("STRICTLOC-03",()=>{const page=archiveLocatorPage();assert.notEqual(primitive("archiveMutationLocator")(page).accessibleName,"已归档 (0)");});
test("STRICTLOC-04",()=>{const page=archiveLocatorPage();primitive("archiveMutationLocator")(page);assert.deepEqual(page.calls[0],{role:"button",options:{name:"归档",exact:true}});});
test("STRICTLOC-05",()=>{assert.equal(/\.first\(|\.last\(|\.nth\(/.test(primitive("archiveMutationLocator").toString()),false);});
test("STRICTLOC-06",()=>{const page=archiveLocatorPage();assert.equal(primitive("mutationActionLocator")(page,"归档").accessibleName,"归档");assert.equal(page.calls[0].options.exact,true);});
const caseError = (caseId="UIE2E-14") => { const error=new Error("locator.click strict mode violation"); error.caseId=caseId; return error; };
const caseErrorRun = async (caseId="UIE2E-14") => { const {calls,operations}=makeOperations({runApi:async()=>({cases:[]}),runUi:async()=>{throw caseError(caseId);},runFinal:async()=>{calls.push("runFinal");return {observations:{postCleanup:{finalDataGate:"PASS",canonicalExpectedCount:24,canonicalObservedCount:24,ownedRemainingCount:0}}};}}); const result=await runP6bLifecycle({operations,config:{mode:"UI_ONLY",apiRequired:0,uiRequired:16}}); return {calls,result}; };
test("CASEERR-01",async()=>{const {result}=await caseErrorRun();assert.equal(result.acceptanceResult,"BLOCKED");});
test("CASEERR-02",async()=>{const {result}=await caseErrorRun();assert.deepEqual([result.firstFailureCase,result.firstFailureStage],["UIE2E-14","runUi"]);});
test("CASEERR-03",async()=>{const {calls}=await caseErrorRun();assert.equal(calls.includes("runFinal"),true);});
test("CASEERR-04",async()=>{const {result}=await caseErrorRun();assert.equal(result.observations.postCleanup.finalDataGate,"PASS");});
test("CASEERR-05",async()=>{const {calls}=await caseErrorRun();assert.deepEqual(calls.slice(-4),["cleanupBrowser","stopAstro","stopSupabase","verifyCleanup"]);});
test("CASEERR-06",async()=>{const runId="ce000006";await primitive("runLifecycleWithDurableTerminal")({runId,mode:"UI_ONLY",operations:makeOperations({runApi:async()=>({cases:[]}),runUi:async()=>{throw caseError();},runFinal:async()=>({})}).operations,config:{mode:"UI_ONLY",apiRequired:0,uiRequired:16}});assert.notEqual((await primitive("loadFinalTerminal")(runId)).status,"NOT_FOUND");});
test("CASEERR-07",async()=>{const runId="ce000007";const result=await primitive("runLifecycleWithDurableTerminal")({runId,mode:"UI_ONLY",operations:makeOperations({runApi:async()=>({cases:[]}),runUi:async()=>{throw caseError();},runFinal:async()=>({})}).operations,config:{mode:"UI_ONLY",apiRequired:0,uiRequired:16}});assert.equal((await primitive("loadFinalTerminal")(runId)).runId,result.runId);});
test("CASEERR-08",async()=>{const {result}=await caseErrorRun();assert.deepEqual([result.observerPendingPromises,result.observerStaleListeners,result.observerUnhandledRejections],[0,0,0]);});
test("CASEERR-09",async()=>{const runId="ce000009";await primitive("runLifecycleWithDurableTerminal")({runId,mode:"UI_ONLY",operations:makeOperations({runApi:async()=>({cases:[]}),runUi:async()=>{throw caseError();},runFinal:async()=>({})}).operations,config:{mode:"UI_ONLY",apiRequired:0,uiRequired:16}});assert.equal((await primitive("loadFinalTerminal")(runId)).progress.RUN_ID,runId);});
test("CASEERR-10",async()=>{const {result}=await caseErrorRun();assert.equal(JSON.stringify(result).includes("strict mode violation"),false);});
test("CASEERR-11",async()=>{const {result}=await caseErrorRun();assert.notEqual(result.acceptanceResult,"PASS");});
test("CASEERR-12",async()=>{const {result}=await focus03Run();assert.equal(result.acceptanceResult,"PASS");});
test("CASEERR-13",async()=>{const {result}=await focus03Run({runUi:async()=>({cases:focus03Ledger(3),observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})});assert.equal(result.firstFailureCase,"UIE2E-03");});
test("CASEERR-14",async()=>{const result=await primitive("runUiCaseWithLiveness")({caseId:"UIE2E-14",action:()=>new Promise(()=>{}),timeoutMs:5});assert.equal(result.failureClassification,"RUNNER_UI_CASE_LIVENESS_TIMEOUT");});
test("CASEERR-15",async()=>{const {result}=await caseErrorRun("UIE2E-14");assert.equal(result.mode,"UI_ONLY");});
test("CASEERR-16",async()=>{const {result}=await caseErrorRun("UIE2E-04");assert.equal(result.firstFailureCase,"UIE2E-04");});
test("BROWSERAUTH-02", async () => {
  const session = await primitive("createRealBrowserSession")({ supabaseUrl: "http://127.0.0.1:54321", anonKey: "local-anon", actor: { email: "moderator@example.test", password: "real-password", role: "moderator" }, clientFactory: () => ({ auth: { signInWithPassword: async () => ({ data: { session: { access_token: "genuine-token", refresh_token: "genuine-refresh", user: { id: "actor-1" } } }, error: null }) } }) });
  assert.equal(session.actorRole, "moderator"); assert.equal(session.session.access_token, "genuine-token");
});
test("BROWSERAUTH-03", async () => {
  const clientFactory = (role) => () => ({ auth: { signInWithPassword: async () => ({ data: { session: { access_token: `${role}-token`, refresh_token: `${role}-refresh`, user: { id: role } } }, error: null }) } });
  const staff = await primitive("createRealBrowserSession")({ supabaseUrl: "http://127.0.0.1:54321", anonKey: "local", actor: { email: "staff@test", password: "x", role: "moderator" }, clientFactory: clientFactory("staff") });
  const user = await primitive("createRealBrowserSession")({ supabaseUrl: "http://127.0.0.1:54321", anonKey: "local", actor: { email: "user@test", password: "x", role: "user" }, clientFactory: clientFactory("user") });
  assert.notEqual(staff.session.user.id, user.session.user.id); assert.notEqual(staff.actorRole, user.actorRole);
});
test("BROWSERAUTH-04", async () => {
  await assert.rejects(() => primitive("createRealBrowserSession")({ supabaseUrl: "http://127.0.0.1:54321", anonKey: "local", actor: { email: "staff@test", password: "x", role: "moderator", moderator: true }, clientFactory: () => ({ auth: { signInWithPassword: async () => ({ data: { session: null }, error: null }) } }) }));
});
test("BROWSERAUTH-05", async () => {
  await assert.rejects(() => primitive("createRealBrowserSession")({ supabaseUrl: "https://example.supabase.co", anonKey: "local", actor: { email: "staff@test", password: "x", role: "moderator" } }));
});
test("BROWSERAUTH-06", () => {
  const evidence = primitive("browserAuthEvidence")({ actorRole: "moderator", session: { access_token: "genuine-token", refresh_token: "genuine-refresh" } });
  assert.equal(JSON.stringify(evidence).includes("genuine-token"), false); assert.equal(evidence.realLocalAuth, true);
});
// RUNNER2J: these exercise the UIE2E-02 acceptance boundary itself, not the
// slug correlator in isolation. A regression in any precedence branch must
// make at least one of these controlled, zero-runtime cases fail.
const uiCorr = (overrides = {}) => primitive("evaluateUiE2e02")({
  session: { browserSessionEstablished: true, browserSessionActor: "moderator", browserSessionLocal: true, browserSessionUserIdMatchesExpected: true, browserSessionRoleMatchesExpected: true },
  network: { deviceLoadRequestObserved: true, deviceLoadMethod: "GET", deviceLoadPath: "/api/admin/devices", deviceLoadResponseObserved: true, deviceLoadStatus: 200, deviceLoadProductBrowserOriginated: true },
  load: { loading: false, errorStateVisible: false, emptyStateVisible: false, cardsPresent: true, apiRowCount: 3 },
  dbSlugs: ["a", "b", "c"], apiSlugs: ["a", "b", "c"], domSlugs: ["a", "b", "c"], ...overrides,
});
test("UICORR-13", () => { assert.equal(uiCorr({ network: { deviceLoadRequestObserved: true, deviceLoadMethod: "GET", deviceLoadPath: "/api/admin/devices", deviceLoadResponseObserved: true, deviceLoadStatus: 401 } }).failureClassification, "RUNNER_UIE2E02_DEVICE_LOAD_AUTH_FAILURE"); });
test("UICORR-14", () => { assert.equal(uiCorr({ network: { deviceLoadRequestObserved: true, deviceLoadMethod: "GET", deviceLoadPath: "/api/admin/devices", deviceLoadResponseObserved: true, deviceLoadStatus: 403 } }).failureClassification, "RUNNER_UIE2E02_DEVICE_LOAD_AUTHORIZATION_FAILURE"); });
test("UICORR-15", () => { assert.equal(uiCorr({ domSlugs: ["a", "b"] }).failureClassification, "RUNNER_UIE2E02_API_TO_DOM_MATERIALIZATION_FAILURE"); });
test("UICORR-16", () => { assert.equal(uiCorr({ apiSlugs: ["a", "b"], domSlugs: ["a", "b"] }).failureClassification, "RUNNER_UIE2E02_DB_TO_API_CORRELATION_FAILURE"); });
test("UICORR-17", () => { assert.equal(uiCorr({ apiSlugs: ["c", "a", "b"], domSlugs: ["b", "c", "a"] }).result, "PASS"); });
test("UICORR-18", () => { const result = uiCorr({ load: { loading: false, errorStateVisible: true, emptyStateVisible: false, cardsPresent: true, apiRowCount: 3 } }); assert.deepEqual([result.loadState, result.failureClassification], ["LOAD_ERROR", "RUNNER_UIE2E02_DEVICE_LOAD_SETTLE_DEFECT"]); });
test("UICORR-19", () => { assert.equal(uiCorr({ load: { loading: false, errorStateVisible: false, emptyStateVisible: true, cardsPresent: false, apiRowCount: 3 } }).failureClassification, "RUNNER_UIE2E02_DEVICE_LOAD_SETTLE_DEFECT"); });
test("UICORR-20", () => { assert.equal(uiCorr({ session: { browserSessionEstablished: true, browserSessionActor: "moderator", browserSessionLocal: true, browserSessionUserIdMatchesExpected: false, browserSessionRoleMatchesExpected: true } }).failureClassification, "RUNNER_UIE2E02_BROWSER_SESSION_IDENTITY_MISMATCH"); });
test("UICORR-21", () => { const result = uiCorr({ session: { browserSessionEstablished: true, browserSessionActor: "moderator", browserSessionLocal: true, browserSessionUserIdMatchesExpected: true, browserSessionRoleMatchesExpected: true, access_token: "token", refresh_token: "refresh", password: "password" }, network: { deviceLoadRequestObserved: true, deviceLoadResponseObserved: true, deviceLoadStatus: 200, authorization: "Bearer token" } }); assert.equal(/token|refresh|password|Bearer/.test(JSON.stringify(result)), false); });
test("UICORR-22", () => { const result = uiCorr({ domSlugs: ["a", "b", "wrong"] }); assert.deepEqual([result.dbCount, result.apiCount, result.domCount, result.result], [3, 3, 3, "FAIL"]); });
test("UICORR-23", () => { assert.equal(uiCorr().result, "PASS"); });
test("UICORR-24", () => { const result = uiCorr({ dbSlugs: ["a", "b", "c", "d"], apiSlugs: ["a", "b"], domSlugs: ["a", "b"] }); assert.equal(result.dbApiMissingCount, 2); assert.equal(result.dbSlugSet.length, 4); });
test("UICORR-25", async () => { let listener; const page = { on: (_event, fn) => { listener = fn; }, off: () => { listener = null; } }; const observed = await primitive("observeDeviceLoad")({ page, baseUrl: "http://127.0.0.1:56000", action: async () => listener({ url: () => "http://127.0.0.1:56000/api/admin/devices", request: () => ({ method: () => "GET" }), status: () => 200, json: async () => ({ devices: [{ slug: "a" }] }) }) }); assert.deepEqual([observed.deviceLoadProductBrowserOriginated, observed.apiSlugs], [true, ["a"]]); });
test("UICORR-26", () => { const result = uiCorr({ load: { loading: false, errorStateVisible: false, emptyStateVisible: false, cardsPresent: false, apiRowCount: 3 } }); assert.equal(result.loadState, "LOADING"); });
test("UICORR-27", () => { const result = uiCorr({ dbSlugs: ["a", "a", "b"], apiSlugs: ["a", "b"], domSlugs: ["a", "b"] }); assert.equal(result.result, "FAIL"); });
test("UICORR-28", () => { assert.equal(uiCorr({ dbSlugs: ["c", "b", "a"], apiSlugs: ["a", "c", "b"], domSlugs: ["b", "a", "c"] }).result, "PASS"); });
test("UICORR-29", () => { assert.equal(uiCorr({ network: { deviceLoadRequestObserved: false } }).failureClassification, "RUNNER_UIE2E02_DEVICE_LOAD_REQUEST_NOT_OBSERVED"); });
test("UIWIRE-01", async () => {
  const calls = []; const lifecycle = await primitive("startBrowserLifecycle")({ chromiumImpl: { launch: async () => ({ newContext: async () => ({ addInitScript: async () => calls.push("script"), newPage: async () => ({}) }) }) }, session: { access_token: "token", refresh_token: "refresh" }, supabaseUrl: "http://127.0.0.1:54321" });
  assert.equal(lifecycle.started, true); assert.equal(calls.length, 1);
});
test("UIWIRE-02", async () => {
  const calls = []; const browser = { close: async () => calls.push("browser") }; const context = { close: async () => calls.push("context") }; const page = { close: async () => calls.push("page") };
  const closed = await primitive("closeBrowserLifecycle")({ browser, context, page }); assert.equal(closed, true); assert.deepEqual(calls, ["page", "context", "browser"]);
});
test("UIWIRE-03", () => {
  const observer = primitive("createBrowserNetworkObserver")({ baseUrl: "http://127.0.0.1:56001" }); observer.begin("UIE2E-03"); observer.observe({ url: () => "http://127.0.0.1:56001/api/admin/devices", status: () => 201, request: () => ({ method: () => "POST", headers: () => ({ authorization: "Bearer forbidden" }) }) });
  const evidence = observer.end(); assert.deepEqual(evidence, [{ caseId: "UIE2E-03", method: "POST", pathname: "/api/admin/devices", status: 201 }]); assert.equal(JSON.stringify(evidence).includes("Bearer"), false);
});
test("UIWIRE-04", () => { assert.throws(() => primitive("assertUiDbVerification")({ network: [{ status: 201 }], dbVerified: false })); });
test("UIWIRE-05", () => { assert.equal(primitive("draftSlugCaseEvidence")({ slugControlPresent: false }).result, "PASS_WITH_FROZEN_UX_CONTRACT"); });
test("UIWIRE-06", () => { assert.throws(() => primitive("assertServerRejectionEvidence")({ network: [{ status: 200 }], falseSuccess: false })); });
test("ZERORUNTIMEUI-01", async () => { const result = await runP6bLifecycle({ operations: fullOperations(), config: fullConfig }); assert.deepEqual(result.uiCases.map((entry) => entry.caseId), Array.from({ length: 16 }, (_, index) => `UIE2E-${String(index + 1).padStart(2, "0")}`)); });
test("ZERORUNTIMEUI-02", async () => { const { calls, operations } = makeOperations({ runApi: async () => ({ cases: [] }), runUi: async () => ({ cases: [{ caseId: "UIE2E-01", result: "FAIL" }] }) }); const result = await runP6bLifecycle({ operations, config: { mode: "UI_ONLY", apiRequired: 0, uiRequired: 16 } }); assert.equal(result.firstFailureCase, "UIE2E-01"); assert.equal(calls.filter((name) => name === "runFinal").length, 1); });
test("ZERORUNTIMEUI-03", async () => { const result = await runP6bLifecycle({ operations: fullOperations(), config: fullConfig }); assert.equal(result.browserStartCount, 1); assert.deepEqual([result.uiExecuted, result.uiPassed, result.uiFailed], [16, 16, 0]); });
test("ZERORUNTIMEUI-04", () => { const observer = primitive("createBrowserNetworkObserver")({ baseUrl: "http://127.0.0.1:56001" }); observer.begin("UIE2E-13"); observer.observe({ url: () => "http://127.0.0.1:56001/api/admin/devices", status: () => 200, request: () => ({ method: () => "PATCH" }) }); assert.equal(observer.end().filter((entry) => entry.method === "PATCH").length, 1); });
test("ZERORUNTIMEUI-05", () => { const tracker = primitive("createInFlightTracker")(); assert.equal(tracker.enter("device:a"), true); assert.equal(tracker.enter("device:b"), true); assert.equal(tracker.enter("device:a"), false); });
test("ZERORUNTIMEUI-06", () => { assert.throws(() => primitive("assertServerRejectionEvidence")({ network: [{ status: 409 }], falseSuccess: true })); });

const ownedRuntime = { url: "http://127.0.0.1:54321", anonKey: "owned-anon", publicUrl: "http://127.0.0.1:54321", publicAnonKey: "owned-anon", cloudflareIncludeProcessEnv: true };
const runtimeGate = (overrides = {}) => primitive("verifyOwnedLocalRuntime")({ spawn: ownedRuntime, owned: ownedRuntime, statuses: { unauth: 401, nonstaff: 403, moderator: 200, admin: 200 }, astroOutput: "different Astro message", remoteConnections: 0, ...overrides });
test("RUNTIMEGATE-01", async () => { const result = await runtimeGate(); assert.equal(result.observations.runtimeVerification.result, "PASS"); });
test("RUNTIMEGATE-02", async () => { await assert.rejects(() => runtimeGate({ spawn: { ...ownedRuntime, url: "http://127.0.0.1:54322" }, astroOutput: "Using secrets defined in process.env" })); });
test("RUNTIMEGATE-03", async () => { await assert.rejects(() => runtimeGate({ statuses: { unauth: 401, nonstaff: 401, moderator: 200, admin: 200 } })); });
test("RUNTIMEGATE-04", async () => { await assert.rejects(() => runtimeGate({ statuses: { unauth: 401, nonstaff: 403, moderator: 500, admin: 200 } })); });
test("RUNTIMEGATE-05", async () => { await assert.rejects(() => runtimeGate({ statuses: { unauth: 401, nonstaff: 403, moderator: 200, admin: 403 } })); });
test("RUNTIMEGATE-06", async () => { await assert.rejects(() => runtimeGate({ remoteConnections: 1 })); });
test("RUNTIMEGATE-07", async () => { await assert.rejects(() => runtimeGate({ spawn: { ...ownedRuntime, publicUrl: "https://example.supabase.co" }, astroOutput: "Using secrets defined in process.env" })); });
test("RUNTIMEGATE-08", async () => { const result = await runtimeGate(); const retained = JSON.stringify(result.observations.runtimeVerification); assert.equal(retained.includes("owned-anon"), false); assert.deepEqual(result.observations.runtimeVerification.statuses, { unauth: 401, nonstaff: 403, moderator: 200, admin: 200 }); });
test("RUNTIMEGATE-09", async () => { const { calls, operations } = makeOperations({ verifyRuntime: async () => { throw new Error("runtime gate failed"); } }); const result = await runP6bLifecycle({ operations, config: { mode: "UI_ONLY", apiRequired: 0, uiRequired: 16 } }); assert.equal(result.firstFailureStage, "verifyRuntime"); assert.equal(calls.includes("startBrowser"), false); });
test("RUNTIMEGATE-10", async () => { const { calls, operations } = makeOperations({ runApi: async () => ({ cases: [] }) }); const result = await runP6bLifecycle({ operations, config: { mode: "UI_ONLY", apiRequired: 0, uiRequired: 16 } }); assert.equal(result.acceptanceResult, "PASS"); assert.equal(calls.includes("startBrowser"), true); });

function responsePage() { const listeners = new Set(); return { on: (_event, fn) => listeners.add(fn), off: (_event, fn) => listeners.delete(fn), emit: (response) => { for (const fn of listeners) fn(response); }, listenerCount: () => listeners.size }; }
const fakeResponse = (method = "PATCH", status = 200, pathname = "/api/admin/devices") => ({ url: () => `http://127.0.0.1:56001${pathname}`, status: () => status, request: () => ({ method: () => method }) });
test("MUTOBS-01", async () => { const page = responsePage(); const observer = primitive("createBrowserNetworkObserver")({ baseUrl: "http://127.0.0.1:56001" }); const result = await primitive("observeUiMutation")({ page, observer, caseId: "UIE2E-03", method: "POST", action: async () => page.emit(fakeResponse("POST")) }); assert.equal(result.network.length, 1); assert.equal(page.listenerCount(), 0); });
test("MUTOBS-02", async () => { const page = responsePage(); const observer = primitive("createBrowserNetworkObserver")({ baseUrl: "http://127.0.0.1:56001" }); await assert.rejects(() => primitive("observeUiMutation")({ page, observer, caseId: "X", method: "PATCH", action: async () => { throw new Error("action failed"); }, timeoutMs: 5 }), /action failed/); await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal(page.listenerCount(), 0); });
test("MUTOBS-03", async () => { const page = responsePage(); const observer = primitive("createBrowserNetworkObserver")({ baseUrl: "http://127.0.0.1:56001" }); await assert.rejects(() => primitive("observeUiMutation")({ page, observer, caseId: "X", method: "PATCH", action: async () => Promise.reject(new Error("async action failed")), timeoutMs: 5 }), /async action failed/); assert.equal(page.listenerCount(), 0); });
test("MUTOBS-04", async () => { const page = responsePage(); const observer = primitive("createBrowserNetworkObserver")({ baseUrl: "http://127.0.0.1:56001" }); await assert.rejects(() => primitive("observeUiMutation")({ page, observer, caseId: "X", method: "PATCH", action: async () => { throw new Error("primary action failure"); }, timeoutMs: 1 }), /primary action failure/); });
test("MUTOBS-05", async () => { const page = responsePage(); const observer = primitive("createBrowserNetworkObserver")({ baseUrl: "http://127.0.0.1:56001" }); await assert.rejects(() => primitive("observeUiMutation")({ page, observer, caseId: "X", method: "PATCH", action: async () => {}, timeoutMs: 1 }), /response timeout/); assert.equal(page.listenerCount(), 0); });
test("MUTOBS-06", async () => { const page = responsePage(); await assert.rejects(() => primitive("observeUiMutation")({ page, observer: primitive("createBrowserNetworkObserver")({ baseUrl: "http://127.0.0.1:56001" }), caseId: "X", method: "PATCH", action: async () => { throw new Error("fail"); } })); assert.equal(page.listenerCount(), 0); });
test("MUTOBS-07", async () => { const page = responsePage(); await assert.rejects(() => primitive("observeUiMutation")({ page, observer: primitive("createBrowserNetworkObserver")({ baseUrl: "http://127.0.0.1:56001" }), caseId: "X", method: "PATCH", action: async () => {}, timeoutMs: 1 })); assert.equal(page.listenerCount(), 0); });
test("MUTOBS-08", async () => { const page = responsePage(); const observer = primitive("createBrowserNetworkObserver")({ baseUrl: "http://127.0.0.1:56001" }); await primitive("observeUiMutation")({ page, observer, caseId: "X", method: "PATCH", action: async () => page.emit(fakeResponse()) }); page.emit(fakeResponse()); assert.equal(observer.end().length, 1); });
test("MUTOBS-09", async () => { const page = responsePage(); const observer = primitive("createBrowserNetworkObserver")({ baseUrl: "http://127.0.0.1:56001" }); await primitive("observeUiMutation")({ page, observer, caseId: "UIE2E-13", method: "PATCH", action: async () => page.emit(fakeResponse()) }); assert.equal(observer.end().filter((entry) => entry.method === "PATCH").length, 1); });
test("MUTOBS-10", async () => { const page = responsePage(); const observer = primitive("createBrowserNetworkObserver")({ baseUrl: "http://127.0.0.1:56001" }); const result = await primitive("observeUiMutation")({ page, observer, caseId: "X", method: "PATCH", action: async () => page.emit(fakeResponse()) }); assert.equal(JSON.stringify(result).includes("authorization"), false); });
test("MUTOBS-11", async () => { const page = responsePage(); const result = await primitive("observeUiMutation")({ page, observer: primitive("createBrowserNetworkObserver")({ baseUrl: "http://127.0.0.1:56001" }), caseId: "X", mutationExpected: false, action: async () => {} }); assert.deepEqual(result.network, []); assert.equal(page.listenerCount(), 0); });
test("MUTOBS-12", async () => { const page = responsePage(); const observer = primitive("createBrowserNetworkObserver")({ baseUrl: "http://127.0.0.1:56001" }); await assert.rejects(() => primitive("observeUiMutation")({ page, observer, caseId: "X", method: "PATCH", action: async () => { throw new Error("case failure"); } }), /case failure/); assert.equal(page.listenerCount(), 0); });
const deleteBoundary = (overrides = {}) => primitive("evaluatePermanentDeleteBoundary")({ archived: true, deleteControlPresent: true, confirmationOpen: true, expectedId: "owned-12", confirmationDeviceId: "owned-12", observerArmed: true, request: { method: "DELETE", pathname: "/api/admin/devices", body: { id: "owned-12", confirmPermanentDelete: true } }, response: { observed: true, status: 200 }, rowAbsent: true, ...overrides });
test("DEL12-01",()=>assert.equal(deleteBoundary({archived:false}).failureClassification,"RUNNER_DELETE_ARCHIVE_PREREQUISITE_FAILURE"));
test("DEL12-02",()=>assert.equal(deleteBoundary().archiveVerified,true));
test("DEL12-03",()=>assert.equal(deleteBoundary({deleteControlPresent:false}).failureClassification,"RUNNER_DELETE_CONTROL_NOT_PRESENT"));
test("DEL12-04",()=>assert.equal(deleteBoundary({confirmationOpen:false}).failureClassification,"RUNNER_DELETE_CONFIRMATION_NOT_OPEN"));
test("DEL12-05",()=>assert.equal(deleteBoundary({confirmationDeviceId:"other"}).failureClassification,"RUNNER_DELETE_CONFIRMATION_IDENTITY_MISMATCH"));
test("DEL12-06",()=>assert.equal(deleteBoundary({request:null}).failureClassification,"RUNNER_DELETE_REQUEST_NOT_EMITTED"));
test("DEL12-07",()=>assert.equal(deleteBoundary().confirmActionMatched,true));
test("DEL12-08",()=>assert.equal(deleteBoundary().requestMatched,true));
test("DEL12-09",()=>assert.equal(deleteBoundary({request:{method:"DELETE",pathname:"/api/admin/devices",body:{id:"other",confirmPermanentDelete:true}}}).failureClassification,"RUNNER_DELETE_REQUEST_MATCHER_FAILURE"));
test("DEL12-10",()=>assert.equal(deleteBoundary({request:{method:"DELETE",pathname:"/api/admin/devices",body:{id:"owned-12"}}}).failureClassification,"RUNNER_DELETE_REQUEST_MATCHER_FAILURE"));
test("DEL12-11",()=>assert.equal(deleteBoundary({request:{method:"DELETE",pathname:"/api/admin/devices",body:{id:"owned-12",confirmPermanentDelete:false}}}).failureClassification,"RUNNER_DELETE_REQUEST_MATCHER_FAILURE"));
test("DEL12-12",()=>assert.equal(deleteBoundary({request:{method:"PATCH",pathname:"/api/admin/devices",body:{id:"owned-12",confirmPermanentDelete:true}}}).failureClassification,"RUNNER_DELETE_REQUEST_MATCHER_FAILURE"));
test("DEL12-13",()=>assert.equal(deleteBoundary({response:{observed:false,status:null}}).failureClassification,"RUNNER_DELETE_RESPONSE_TIMEOUT"));
test("DEL12-14",()=>assert.equal(deleteBoundary({request:null}).requestObserved,false));
test("DEL12-15",()=>assert.equal(deleteBoundary({response:{observed:true,status:409}}).failureClassification,"RUNNER_DELETE_HTTP_REJECTION"));
test("DEL12-16",()=>assert.equal(deleteBoundary({rowAbsent:false}).failureClassification,"RUNNER_DELETE_DB_REMOVAL_FAILURE"));
test("DEL12-17",()=>assert.equal(deleteBoundary().result,"PASS"));
test("DEL12-18",()=>assert.equal(deleteBoundary({observerArmed:false}).failureClassification,"RUNNER_DELETE_OBSERVER_ARMING_ORDER_FAILURE"));
test("DEL12-19",()=>assert.equal(deleteBoundary({request:{method:"DELETE",pathname:"/api/admin/devices",body:{id:"other",confirmPermanentDelete:true}}}).requestDiagnostic.retained,true));
test("DEL12-20",()=>assert.equal(JSON.stringify(deleteBoundary({request:{method:"DELETE",pathname:"/api/admin/devices",body:{id:"owned-12",confirmPermanentDelete:true},authorization:"secret"}})).includes("secret"),false));
const race13 = (overrides = {}) => primitive("evaluateSameDeviceRace")({ fixtureId: "race-13", firstActionDeviceId: "race-13", secondActionDeviceId: "race-13", actionAttempts: 2, observerArmedBeforeFirstAction: true, raceHoldEstablished: true, overlapProven: true, matchingRequests: [{ method: "PATCH", pathname: "/api/admin/devices", id: "race-13", status: 200 }], nonmatchingMutationRequestCount: 0, dbEffectCount: 1, ...overrides });
test("RACE13T-01",()=>assert.equal(race13().raceFixtureIdentityMatchesExpected,true));
test("RACE13T-02",()=>assert.equal(race13().sameDeviceActionAttemptCount,2));
test("RACE13T-03",()=>assert.equal(race13().raceObserverArmedBeforeFirstAction,true));
test("RACE13T-04",()=>assert.equal(race13().totalMatchingMutationRequestCount,1));
test("RACE13T-05",()=>assert.equal(race13().guardSuppressionObserved,true));
test("RACE13T-06",()=>assert.equal(race13({matchingRequests:[]}).failureClassification,"RUNNER_RACE_FIRST_REQUEST_NOT_EMITTED"));
test("RACE13T-07",()=>assert.equal(race13({matchingRequests:[{method:"PATCH",pathname:"/api/admin/devices",id:"race-13",status:200},{method:"PATCH",pathname:"/api/admin/devices",id:"race-13",status:200}]}).failureClassification,"RUNNER_RACE_DUPLICATE_MUTATION_DISPATCH"));
test("RACE13T-08",()=>assert.equal(race13({matchingRequests:[{method:"PATCH",pathname:"/api/admin/devices",id:"other",status:200}]}).failureClassification,"RUNNER_RACE_FIXTURE_IDENTITY_MISMATCH"));
test("RACE13T-09",()=>assert.equal(race13().result,"PASS"));
test("RACE13T-10",()=>assert.equal(race13({dbEffectCount:2}).failureClassification,"RUNNER_RACE_DB_EFFECT_COUNT_FAILURE"));
test("RACE13T-11",()=>assert.equal(race13({raceHoldEstablished:false}).failureClassification,"RUNNER_RACE_HOLD_NOT_ESTABLISHED"));
test("RACE13T-12",()=>assert.equal(race13({overlapProven:false}).failureClassification,"RUNNER_RACE_OVERLAP_NOT_PROVEN"));
test("RACE13T-13",()=>assert.equal(race13({matchingRequests:[],nonmatchingMutationRequestCount:1}).failureClassification,"RUNNER_RACE_FIRST_REQUEST_NOT_EMITTED"));
test("RACE13T-14",()=>assert.equal(JSON.stringify(race13({authorization:"secret"})).includes("secret"),false));
const controlledUiFailureRun = async (caseId = "UIE2E-13", overrides = {}) => { const { calls, operations } = makeOperations({ runApi: async () => ({ cases: [] }), runUi: async () => ({ cases: [{ caseId, result: "FAIL", failureClassification: "CONTROLLED" }], observerCounters: { observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 } }), runFinal: async () => { calls.push("runFinal"); return { observations: { postCleanup: { finalDataGate: "BLOCKED" } } }; }, ...overrides }); return { calls, result: await runP6bLifecycle({ operations, config: { mode: "UI_ONLY", apiRequired: 0, uiRequired: 16 } }) }; };
test("RUNFINAL-01",async()=>assert.equal((await focus12Run()).calls.filter(x=>x==="runFinal").length,1));
test("RUNFINAL-02",async()=>assert.equal((await controlledUiFailureRun()).calls.filter(x=>x==="runFinal").length,1));
test("RUNFINAL-03",async()=>assert.equal((await caseErrorRun()).calls.filter(x=>x==="runFinal").length,1));
test("RUNFINAL-04",async()=>assert.equal((await controlledUiFailureRun("UIE2E-13",{runUi:async()=>({cases:[await primitive("runUiCaseWithLiveness")({caseId:"UIE2E-13",action:()=>new Promise(()=>{}),timeoutMs:5})],observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})})).calls.filter(x=>x==="runFinal").length,1));
test("RUNFINAL-05",async()=>assert.equal((await controlledUiFailureRun("UIE2E-13",{runFinal:async()=>{throw new Error("final fail")}})).result.firstFailureStage,"runFinal"));
test("RUNFINAL-06",async()=>assert.equal((await controlledUiFailureRun()).result.acceptanceResult,"BLOCKED"));
test("RUNFINAL-07",async()=>assert.equal((await controlledUiFailureRun()).result.firstFailureCase,"UIE2E-13"));
test("RUNFINAL-08",async()=>assert.equal((await controlledUiFailureRun()).result.observations.postCleanup.finalDataGate,"BLOCKED"));
test("RUNFINAL-09",async()=>assert.deepEqual((await controlledUiFailureRun()).calls.slice(-4),["cleanupBrowser","stopAstro","stopSupabase","verifyCleanup"]));
test("RUNFINAL-10",async()=>{const runId="a1f00010";const {operations}=makeOperations({runApi:async()=>({cases:[]}),runUi:async()=>({cases:[{caseId:"UIE2E-13",result:"FAIL"}],observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})});await primitive("runLifecycleWithDurableTerminal")({runId,mode:"UI_ONLY",operations,config:{mode:"UI_ONLY",apiRequired:0,uiRequired:16}});assert.notEqual((await primitive("loadFinalTerminal")(runId)).status,"NOT_FOUND");});
test("RUNFINAL-11",async()=>assert.equal((await controlledUiFailureRun()).calls.filter(x=>x==="runFinal").length,1));
test("RUNFINAL-12",async()=>assert.equal((await runP6bLifecycle({operations:fullOperations({runUi:async()=>({cases:[{caseId:"UIE2E-13",result:"FAIL"}],observerCounters:{observerPendingPromises:0,observerStaleListeners:0,observerUnhandledRejections:0}})}),config:fullConfig})).acceptanceResult,"BLOCKED"));
const probeActors={nonstaff:{},moderator:{},admin:{}};
const probeRun=(responses={})=>primitive("probeOwnedRuntime")({ endpoint:"http://127.0.0.1:56001/api/admin/devices", actors:probeActors, tokenFor:async(actor)=>`${actor}-token`, request:async(_url,{actor})=>{const value=responses[actor]??{status:actor==="unauthenticated"?401:actor==="nonstaff"?403:200}; if(value instanceof Error)throw value; return value;} });
test("VRPROBE-01",async()=>{const e=await captureFailure(()=>probeRun({nonstaff:{status:401}}));assert.deepEqual([e.observations.runtimeProbes.firstFailureActor,e.observations.runtimeProbes.firstFailureStage,e.observations.runtimeProbes.probes[1].expectedStatus,e.observations.runtimeProbes.probes[1].status],["NONSTAFF","HTTP_STATUS",403,401]);});
test("VRPROBE-02",async()=>{const e=await captureFailure(()=>probeRun({moderator:Object.assign(new Error("ECONNREFUSED"),{code:"ECONNREFUSED"})}));assert.equal(e.observations.runtimeProbes.firstFailureStage,"FETCH_CONNECT");});
test("VRPROBE-03",async()=>{const e=await captureFailure(()=>probeRun({admin:Object.assign(new Error("timeout"),{name:"AbortError"})}));assert.deepEqual([e.observations.runtimeProbes.firstFailureActor,e.observations.runtimeProbes.firstFailureStage],["ADMIN","FETCH_TIMEOUT"]);});
test("VRPROBE-04",async()=>{const e=await captureFailure(()=>primitive("probeOwnedRuntime")({endpoint:"bad",actors:probeActors,tokenFor:async()=>"x",request:async()=>({status:200})}));assert.equal(e.observations.runtimeProbes.firstFailureStage,"REQUEST_BUILD");});
test("VRPROBE-05",async()=>{const e=await captureFailure(()=>probeRun({moderator:{status:200,parseError:true}}));assert.deepEqual([e.observations.runtimeProbes.firstFailureActor,e.observations.runtimeProbes.probes[2].status],["MODERATOR",200]);});
test("VRPROBE-06",async()=>{const e=await captureFailure(()=>probeRun({nonstaff:{status:401}}));assert.equal(e.observations.runtimeProbes.firstFailureActor,"NONSTAFF");});
test("VRPROBE-07",async()=>{const e=await captureFailure(()=>probeRun({nonstaff:{status:401}}));assert.equal(e.observations.runtimeProbes.probes[2].result,"NOT_RUN");});
test("VRPROBE-08",async()=>{const r=await probeRun();assert.deepEqual(r.probes.map(x=>x.status),[401,403,200,200]);});
test("VRPROBE-09",async()=>{const r=await probeRun();assert.equal(JSON.stringify(r).includes("-token"),false);});
test("VRPROBE-10",async()=>{const {calls,operations}=makeOperations({verifyRuntime:async()=>{const e=new Error("fail");e.observations={runtimeProbes:{firstFailureActor:"NONSTAFF"}};throw e;}});const r=await runP6bLifecycle({operations,config:{mode:"UI_ONLY",apiRequired:0,uiRequired:16}});assert.equal(calls.includes("startBrowser"),false);assert.equal(r.observations.runtimeProbes.firstFailureActor,"NONSTAFF");});

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

const apiLedger = (count = 16, failedAt = null) => Array.from({ length: count }, (_, index) => ({ caseId: `APIINT-${String(index + 1).padStart(2, "0")}`, result: failedAt === index + 1 ? "FAIL" : "PASS", expected: "local API contract", observed: "safe" }));
const uiLedger = (count = 16, failedAt = null) => Array.from({ length: count }, (_, index) => ({ caseId: `UIE2E-${String(index + 1).padStart(2, "0")}`, result: failedAt === index + 1 ? "FAIL" : "PASS", expected: "local UI contract", observed: "safe" }));
const fullConfig = { mode: "FULL", apiRequired: 16, uiRequired: 16, browserRequired: true };
const fullOperations = (overrides = {}) => makeOperations({ runApi: async () => ({ cases: apiLedger() }), runUi: async () => ({ cases: uiLedger(), observerCounters: { observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 } }), ...overrides }).operations;

test("FULLCOV-01", async () => { const result = await runP6bLifecycle({ operations: makeOperations().operations, config: { mode: "SMOKE", apiRequired: 2, uiRequired: 0, browserRequired: false } }); assert.deepEqual([result.apiRequired, result.uiRequired], [2, 0]); });
test("FULLCOV-02", async () => { const result = await runP6bLifecycle({ operations: fullOperations(), config: fullConfig }); assert.deepEqual([result.apiRequired, result.uiRequired], [16, 16]); });
test("FULLCOV-03", async () => { const result = await runP6bLifecycle({ operations: fullOperations({ runApi: async () => ({ cases: apiLedger(2) }) }), config: fullConfig }); assert.equal(result.acceptanceResult, "BLOCKED"); });
test("FULLCOV-04", async () => { const result = await runP6bLifecycle({ operations: fullOperations({ startBrowser: async () => ({ started: false }) }), config: fullConfig }); assert.equal(result.acceptanceResult, "BLOCKED"); });
test("FULLCOV-05", async () => { const result = await runP6bLifecycle({ operations: fullOperations({ runApi: async () => ({ cases: apiLedger(15) }) }), config: fullConfig }); assert.equal(result.firstFailureCase, "APIINT-16"); });
test("FULLCOV-06", async () => { const result = await runP6bLifecycle({ operations: fullOperations({ runUi: async () => ({ cases: uiLedger(15) }) }), config: fullConfig }); assert.equal(result.firstFailureCase, "UIE2E-16"); });
test("FULLCOV-07", async () => { const calls = []; const operations = fullOperations({ runApi: async () => ({ cases: apiLedger(16, 1) }), startBrowser: async () => { calls.push("browser"); } }); const result = await runP6bLifecycle({ operations, config: fullConfig }); assert.equal(result.firstFailureCase, "APIINT-01"); assert.equal(calls.length, 0); });
test("FULLCOV-08", async () => { const calls = []; const operations = fullOperations({ runUi: async () => ({ cases: uiLedger(16, 1) }), cleanupBrowser: async () => { calls.push("cleanup"); } }); const result = await runP6bLifecycle({ operations, config: fullConfig }); assert.equal(result.firstFailureCase, "UIE2E-01"); assert.deepEqual(calls, ["cleanup"]); });
test("FULLCOV-09", async () => { const result = await runP6bLifecycle({ operations: fullOperations(), config: fullConfig }); assert.equal(result.apiCases.length, 16); });
test("FULLCOV-10", async () => { const result = await runP6bLifecycle({ operations: fullOperations(), config: fullConfig }); assert.equal(result.uiCases.length, 16); });
test("APIENGINE-01", async () => { const result = await runP6bLifecycle({ operations: fullOperations(), config: fullConfig }); assert.deepEqual(result.apiCases.map((entry) => entry.caseId), apiLedger().map((entry) => entry.caseId)); });
test("APIENGINE-02", async () => { const result = await runP6bLifecycle({ operations: fullOperations({ runApi: async () => ({ cases: apiLedger(16, 3) }) }), config: fullConfig }); assert.equal(result.firstFailureCase, "APIINT-03"); });
test("APIENGINE-03", async () => { const result = await runP6bLifecycle({ operations: fullOperations({ runApi: async () => ({ cases: apiLedger(15) }) }), config: fullConfig }); assert.equal(result.apiExecuted, 15); });
test("APIENGINE-04", async () => { assert.equal(typeof primitive("createDisposableTracker"), "function"); });
test("APIENGINE-05", async () => { const tracker = primitive("createDisposableTracker")("abcd1234"); assert.throws(() => tracker.track({ id: "canonical", slug: "canonical-device", owned: false })); });
test("APIENGINE-06", async () => { const result = await runP6bLifecycle({ operations: fullOperations(), config: fullConfig }); assert.deepEqual([result.apiExecuted, result.apiPassed, result.apiFailed], [16, 16, 0]); });
test("UIENGINE-01", async () => { const result = await runP6bLifecycle({ operations: fullOperations(), config: fullConfig }); assert.deepEqual(result.uiCases.map((entry) => entry.caseId), uiLedger().map((entry) => entry.caseId)); });
test("UIENGINE-02", async () => { const calls = []; const operations = fullOperations({ runApi: async () => ({ cases: apiLedger(15) }), startBrowser: async () => { calls.push("browser"); } }); await runP6bLifecycle({ operations, config: fullConfig }); assert.deepEqual(calls, []); });
test("UIENGINE-03", async () => { const result = await runP6bLifecycle({ operations: fullOperations({ startBrowser: async () => ({ started: false }) }), config: fullConfig }); assert.equal(result.browserStartCount, 0); });
test("UIENGINE-04", async () => { const result = await runP6bLifecycle({ operations: fullOperations({ runUi: async () => ({ cases: uiLedger(16, 2) }) }), config: fullConfig }); assert.equal(result.firstFailureCase, "UIE2E-02"); });
test("UIENGINE-05", async () => { const result = await runP6bLifecycle({ operations: fullOperations(), config: fullConfig }); assert.equal(Array.isArray(result.uiCases[0].network), true); });
test("UIENGINE-06", async () => { const entry = { ...uiLedger()[12], mutationCount: 2 }; assert.equal(entry.mutationCount === 1, false); });
test("UIENGINE-07", async () => { const tracker = primitive("createInFlightTracker")(); assert.equal(tracker.enter("device:a"), true); assert.equal(tracker.enter("device:b"), true); });
test("UIENGINE-08", async () => { const entry = { ...uiLedger()[14], observed: "error", uiReportedSuccess: true }; assert.equal(entry.uiReportedSuccess && entry.observed === "error", true); });
test("APIWIRE-01", async () => { assert.equal(typeof primitive("createRealApiAdapter"), "function"); });
test("APIWIRE-02", async () => { const adapter = primitive("createRealApiAdapter")({ baseUrl: "http://127.0.0.1:56000", request: async () => new Response(JSON.stringify({ ok: true }), { status: 201 }), database: { get: async () => null }, tracker: primitive("createDisposableTracker")("abcd1234") }); const result = await adapter.request({ method: "POST", path: "/api/admin/devices", actor: "moderator", token: "local-test-token", body: { name: "safe" } }); assert.deepEqual(result.network, { method: "POST", path: "/api/admin/devices", status: 201, actor: "moderator" }); });
test("APIWIRE-03", async () => { const adapter = primitive("createRealApiAdapter")({ baseUrl: "http://127.0.0.1:56000", request: async () => new Response("not-json", { status: 500 }), database: { get: async () => null }, tracker: primitive("createDisposableTracker")("abcd1234") }); await assert.rejects(() => adapter.request({ method: "GET", path: "/api/admin/devices", actor: "unauthenticated" })); });
const granularLedger = (failedSubcase = null) => [...apiLedger(14), { caseId: "APIINT-15", result: failedSubcase ? "FAIL" : "PASS", expected: "three hard-delete guards", observed: failedSubcase ? "subassertion failed" : "PASS", subAssertions: ["A", "B", "C"].map((suffix) => ({ caseId: `APIINT-15${suffix}`, result: failedSubcase === suffix ? "FAIL" : "PASS", expected: "safe delete contract", observed: "safe" })) }, apiLedger().at(-1)];
test("APIGRAN-01", async () => { const result = await runP6bLifecycle({ operations: fullOperations({ runApi: async () => ({ cases: granularLedger() }) }), config: fullConfig }); assert.equal(result.apiCases.filter((entry) => entry.caseId === "APIINT-15").length, 1); });
test("APIGRAN-02", async () => { const result = await runP6bLifecycle({ operations: fullOperations({ runApi: async () => ({ cases: granularLedger() }) }), config: fullConfig }); assert.equal(result.apiCases[14].subAssertions.every((entry) => entry.result === "PASS"), true); });
test("APIGRAN-03", async () => { const result = await runP6bLifecycle({ operations: fullOperations({ runApi: async () => ({ cases: granularLedger("A") }) }), config: fullConfig }); assert.deepEqual([result.firstFailureCase, result.firstFailureSubcase], ["APIINT-15", "APIINT-15A"]); });
test("APIGRAN-04", async () => { const result = await runP6bLifecycle({ operations: fullOperations({ runApi: async () => ({ cases: granularLedger("B") }) }), config: fullConfig }); assert.equal(result.firstFailureSubcase, "APIINT-15B"); });
test("APIGRAN-05", async () => { const result = await runP6bLifecycle({ operations: fullOperations({ runApi: async () => ({ cases: granularLedger("C") }) }), config: fullConfig }); assert.equal(result.firstFailureSubcase, "APIINT-15C"); });
test("APIGRAN-06", async () => { const result = await runP6bLifecycle({ operations: fullOperations({ runApi: async () => ({ cases: granularLedger() }) }), config: fullConfig }); assert.equal(result.apiExecuted, 16); });
test("APIGRAN-07", async () => { const result = await runP6bLifecycle({ operations: fullOperations({ runApi: async () => ({ cases: granularLedger() }) }), config: fullConfig }); assert.deepEqual([result.apiPassed, result.apiFailed], [16, 0]); });
test("APIGRAN-08", async () => { const result = await runP6bLifecycle({ operations: fullOperations({ runApi: async () => ({ cases: granularLedger() }) }), config: fullConfig }); assert.equal(result.apiCases[14].subAssertions.length, 3); });
test("APIGRAN-09", async () => { const cases = [...granularLedger(), granularLedger()[14]]; const result = await runP6bLifecycle({ operations: fullOperations({ runApi: async () => ({ cases }) }), config: fullConfig }); assert.equal(result.acceptanceResult, "BLOCKED"); });
test("APIGRAN-10", async () => { const cases = granularLedger().filter((entry) => entry.caseId !== "APIINT-15"); const result = await runP6bLifecycle({ operations: fullOperations({ runApi: async () => ({ cases }) }), config: fullConfig }); assert.equal(result.firstFailureCase, "APIINT-15"); });
const canonicalIds = Array.from({ length: 24 }, (_, index) => `canonical-${index}`);
const cleanupHarness = (ids = ["owned-a", "owned-b", "owned-c"], finalIds = canonicalIds) => ({ ids: new Set(ids), async remove(id) { this.ids.delete(id); return { error: null }; }, async readAllIds() { return [...finalIds, ...this.ids]; } });
test("FINALCLEAN-01", async () => { const db = cleanupHarness(); const result = await primitive("finalizeDisposableDevices")({ db, ownedIds: ["owned-a", "owned-b", "owned-c"], canonicalIds }); assert.equal(result.runOwnedDisposableRemaining, 0); });
test("FINALCLEAN-02", async () => { const db = cleanupHarness(["owned-a"]); const result = await primitive("finalizeDisposableDevices")({ db, ownedIds: ["owned-a"], canonicalIds }); assert.equal(result.canonicalDeviceCount, 24); });
test("FINALCLEAN-03", async () => { const db = cleanupHarness(); await assert.rejects(() => primitive("finalizeDisposableDevices")({ db, ownedIds: ["canonical-0"], canonicalIds })); });
test("FINALCLEAN-04", async () => { const db = cleanupHarness([], canonicalIds); const result = await primitive("finalizeDisposableDevices")({ db, ownedIds: [], canonicalIds }); assert.equal(result.canonicalIdentityRestored, true); });
test("FINALCLEAN-05", async () => { const db = cleanupHarness([], canonicalIds.slice(0, 23)); await assert.rejects(() => primitive("finalizeDisposableDevices")({ db, ownedIds: [], canonicalIds })); });
test("FINALCLEAN-06", async () => { const db = cleanupHarness(["owned-a"]); await assert.rejects(() => primitive("finalizeDisposableDevices")({ db, ownedIds: [], canonicalIds })); });
test("FINALCLEAN-07", async () => { const altered = [...canonicalIds.slice(0, 23), "owned-a"]; const db = cleanupHarness([], altered); await assert.rejects(() => primitive("finalizeDisposableDevices")({ db, ownedIds: [], canonicalIds })); });
test("FINALCLEAN-08", async () => { const db = cleanupHarness(); db.remove = async () => ({ error: new Error("delete failed") }); await assert.rejects(() => primitive("finalizeDisposableDevices")({ db, ownedIds: ["owned-a"], canonicalIds })); });

async function captureFailure(action) { try { await action(); } catch (error) { return error; } throw new Error("Expected operation to fail."); }
const forensicFailure = async ({ finalIds, ownedIds = [] }) => captureFailure(() => primitive("finalizeDisposableDevices")({ db: cleanupHarness([], finalIds), ownedIds, canonicalIds }));

test("READBACK-01", async () => { const error = await forensicFailure({ finalIds: canonicalIds.slice(1) }); assert.equal(error.observations.postCleanup.canonicalMissingCount, 1); assert.deepEqual(error.observations.postCleanup.canonicalMissingIds, ["canonical-0"]); });
test("READBACK-02", async () => { const db = cleanupHarness(["owned-a"], canonicalIds.slice(1)); db.remove = async () => ({ error: null }); const error = await captureFailure(() => primitive("finalizeDisposableDevices")({ db, ownedIds: ["owned-a"], canonicalIds })); assert.equal(error.observations.postCleanup.canonicalMissingCount, 1); assert.deepEqual(error.observations.postCleanup.ownedRemainingIds, ["owned-a"]); });
test("READBACK-03", async () => { const error = await forensicFailure({ finalIds: [...canonicalIds, "unexpected-a"] }); assert.equal(error.observations.postCleanup.unexpectedNonCanonicalCount, 1); assert.deepEqual(error.observations.postCleanup.unexpectedNonCanonicalIds, ["unexpected-a"]); });
test("READBACK-04", async () => { const result = await primitive("finalizeDisposableDevices")({ db: cleanupHarness([], canonicalIds), ownedIds: [], canonicalIds }); assert.equal(result.postCleanup.canonicalIdentityMatches, true); assert.equal(result.postCleanup.disposableCleanupMatches, true); assert.equal(result.postCleanup.finalDataGate, "PASS"); });
test("READBACK-05", async () => { const error = await forensicFailure({ finalIds: [...canonicalIds.slice(1), "unexpected-a"] }); const postCleanup = error.observations.postCleanup; assert.equal(postCleanup.totalDeviceCount, 24); assert.equal(postCleanup.canonicalMissingCount, 1); assert.equal(postCleanup.unexpectedNonCanonicalCount, 1); });
test("READBACK-06", async () => { const extra = Array.from({ length: 9 }, (_, index) => `unexpected-${index}`); const error = await forensicFailure({ finalIds: [...canonicalIds, ...extra] }); const postCleanup = error.observations.postCleanup; assert.equal(postCleanup.unexpectedNonCanonicalCount, 9); assert.equal(postCleanup.unexpectedNonCanonicalIds.length, 8); assert.equal(postCleanup.unexpectedNonCanonicalIdsTruncated, true); });
test("READBACK-07", async () => { const { operations } = makeOperations({ runFinal: async () => primitive("finalizeDisposableDevices")({ db: cleanupHarness([], canonicalIds.slice(1)), ownedIds: [], canonicalIds }) }); const result = await runP6bLifecycle({ operations, config: { mode: "API_ONLY", apiRequired: 16, uiRequired: 0 } }); assert.equal(result.firstFailureStage, "runFinal"); assert.equal(result.observations.postCleanup.canonicalMissingCount, 1); });
test("READBACK-08", async () => { const { operations } = makeOperations({ runFinal: async () => { const error = await forensicFailure({ finalIds: canonicalIds.slice(1) }); error.observations.postCleanup.secretToken = "not-for-terminal"; throw error; } }); const result = await runP6bLifecycle({ operations, config: { mode: "API_ONLY", apiRequired: 16, uiRequired: 0 } }); assert.equal(JSON.stringify(result.observations).includes("not-for-terminal"), false); });
test("FORENSICS-A", async () => { const result = await primitive("finalizeDisposableDevices")({ db: cleanupHarness([], canonicalIds), ownedIds: [], canonicalIds }); assert.equal(result.postCleanup.finalDataGate, "PASS"); });
test("FORENSICS-B", async () => { const db = cleanupHarness(["owned-a"], canonicalIds.slice(1)); db.remove = async () => ({ error: null }); const error = await captureFailure(() => primitive("finalizeDisposableDevices")({ db, ownedIds: ["owned-a"], canonicalIds })); assert.equal(error.observations.postCleanup.canonicalMissingCount, 1); assert.equal(error.observations.postCleanup.ownedRemainingCount, 1); });
test("FORENSICS-C", async () => { const db = cleanupHarness(["owned-a"], canonicalIds); db.remove = async () => ({ error: null }); const error = await captureFailure(() => primitive("finalizeDisposableDevices")({ db, ownedIds: ["owned-a"], canonicalIds })); assert.equal(error.observations.postCleanup.canonicalMissingCount, 0); assert.equal(error.observations.postCleanup.ownedRemainingCount, 1); });
test("FORENSICS-D", async () => { const error = await forensicFailure({ finalIds: [...canonicalIds.slice(1), "unexpected-a"] }); assert.equal(error.observations.postCleanup.totalDeviceCount, 24); assert.equal(error.observations.postCleanup.canonicalMissingCount, 1); assert.equal(error.observations.postCleanup.unexpectedNonCanonicalCount, 1); });
test("FORENSICS-E", async () => { const postCleanup = { totalDeviceCount: 24, canonicalExpectedCount: 24, canonicalObservedCount: 24, canonicalMissingCount: 0, canonicalUnexpectedCount: 0, ownedExpectedCleanupCount: 0, ownedRemainingCount: 0, unexpectedNonCanonicalCount: 0, canonicalIdentityMatches: true, disposableCleanupMatches: true, finalDataGate: "BLOCKED" }; const { operations } = makeOperations({ runFinal: async () => { const error = new Error("stale gate"); error.observations = primitive("postCleanupEvidence")(postCleanup); throw error; } }); const result = await runP6bLifecycle({ operations, config: { mode: "API_ONLY", apiRequired: 16, uiRequired: 0 } }); assert.equal(result.observations.postCleanup.finalDataGate, "BLOCKED"); assert.equal(result.observations.postCleanup.canonicalIdentityMatches, true); });
test("READBACK-09", async () => { const db = cleanupHarness(["owned-a"], canonicalIds); db.remove = async () => ({ error: new Error("delete failed") }); const error = await captureFailure(() => primitive("finalizeDisposableDevices")({ db, ownedIds: ["owned-a"], canonicalIds })); assert.equal(error.observations.postCleanup.ownedRemainingCount, 1); assert.equal(error.observations.postCleanup.deleteErrorCount, 1); });
const deleteError = { code: "42501", message: "permission denied for table devices", details: "DELETE is not permitted", hint: "Use an authorized cleanup path", status: 403 };
const deleteAttemptFailure = async (responses, ownedIds = responses.map((_, index) => `owned-${index}`)) => { const db = cleanupHarness(ownedIds, canonicalIds); let index = 0; db.remove = async () => responses[index++]; return captureFailure(() => primitive("finalizeDisposableDevices")({ db, ownedIds, canonicalIds })); };
test("DELERR-01", async () => { const error = await deleteAttemptFailure([{ error: deleteError }]); assert.equal(error.observations.postCleanup.deleteAttempts[0].errorCode, "42501"); });
test("DELERR-02", async () => { const error = await deleteAttemptFailure([{ error: deleteError }]); assert.equal(error.observations.postCleanup.deleteAttempts[0].errorMessage, "permission denied for table devices"); });
test("DELERR-03", async () => { const error = await deleteAttemptFailure([{ error: deleteError }]); assert.equal(error.observations.postCleanup.deleteAttempts[0].errorDetails, "DELETE is not permitted"); });
test("DELERR-04", async () => { const error = await deleteAttemptFailure([{ error: deleteError }]); assert.equal(error.observations.postCleanup.deleteAttempts[0].errorHint, "Use an authorized cleanup path"); });
test("DELERR-05", async () => { const error = await deleteAttemptFailure([{ error: deleteError }]); assert.equal(error.observations.postCleanup.deleteAttempts[0].httpStatus, 403); });
test("DELERR-06", async () => { const error = await deleteAttemptFailure([{ error: deleteError }, { error: { ...deleteError, code: "PGRST116" } }]); assert.deepEqual(error.observations.postCleanup.deleteAttempts.map((entry) => entry.errorCode), ["42501", "PGRST116"]); });
test("DELERR-07", async () => { const error = await deleteAttemptFailure([{ error: null }, { error: deleteError }]); assert.deepEqual(error.observations.postCleanup.deleteAttempts.map((entry) => entry.result), ["PASS", "FAIL"]); });
test("DELERR-08", async () => { const error = await deleteAttemptFailure([{ error: deleteError }]); const attempt = error.observations.postCleanup.deleteAttempts[0]; assert.equal(attempt.ownedId, "owned-0"); assert.equal(JSON.stringify(attempt).includes("authorization"), false); });
test("DELERR-09", async () => { const error = await deleteAttemptFailure([{ error: deleteError }]); const { operations } = makeOperations({ runFinal: async () => { throw error; } }); const result = await runP6bLifecycle({ operations, config: { mode: "API_ONLY", apiRequired: 16, uiRequired: 0 } }); assert.equal(result.firstFailureStage, "runFinal"); assert.equal(result.observations.postCleanup.deleteAttempts[0].result, "FAIL"); });
test("DELERR-10", async () => { const error = await deleteAttemptFailure([{ error: { ...deleteError, message: "Bearer local-secret-token" } }]); const { operations } = makeOperations({ runFinal: async () => { throw error; } }); const result = await runP6bLifecycle({ operations, config: { mode: "API_ONLY", apiRequired: 16, uiRequired: 0 } }); assert.equal(JSON.stringify(result.observations).includes("local-secret-token"), false); });
test("DELMAP-01", async () => { const error = await deleteAttemptFailure([{ error: deleteError }]); assert.equal(error.observations.postCleanup.deleteAttempts[0].errorClassification, "SQLSTATE_42501_PERMISSION_DENIED"); });
test("DELMAP-02", async () => { const error = await deleteAttemptFailure([{ error: { code: "42501", message: "new row violates row-level security policy" } }]); assert.equal(error.observations.postCleanup.deleteAttempts[0].errorClassification, "RLS_DENIAL"); });
test("DELMAP-03", async () => { const error = await deleteAttemptFailure([{ error: { code: "PGRST116", message: "query result contract error" } }]); assert.equal(error.observations.postCleanup.deleteAttempts[0].errorClassification, "POSTGREST_QUERY_CONTRACT_ERROR"); });
test("DELMAP-04", async () => { const error = await deleteAttemptFailure([{ error: null, count: 0 }]); assert.equal(error.observations.postCleanup.deleteAttempts[0].errorClassification, "PASS_ZERO_ROWS"); });
test("DELMAP-05", async () => { const result = await primitive("finalizeDisposableDevices")({ db: { async remove() { return { error: null, count: 1 }; }, async readAllIds() { return canonicalIds; } }, ownedIds: ["owned-0"], canonicalIds }); assert.equal(result.postCleanup.deleteAttempts[0].errorClassification, "PASS_ROWS_AFFECTED"); });
test("DELMAP-06", async () => { const error = await deleteAttemptFailure([{ error: { message: "unexpected database fault" } }]); assert.equal(error.observations.postCleanup.deleteAttempts[0].errorClassification, "GENERIC_DELETE_ERROR"); });
const cleanupCanonicalUuid = "00000000-0000-4000-8000-000000000001";
const cleanupOwnedUuids = ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000102"];
const localCleanup = (overrides = {}) => primitive("cleanupOwnedDevicesWithLocalPostgres")({ ownedPostgres: "a".repeat(12), ownedIds: cleanupOwnedUuids, canonicalIds: [cleanupCanonicalUuid], execute: async () => ({ stdout: "0\n" }), ...overrides });
test("DELCLEAN-01", async () => { let input; await localCleanup({ execute: async (value) => { input = value; return { stdout: "0\n" }; } }); assert.equal(input.sql.includes(cleanupCanonicalUuid), false); assert.equal(cleanupOwnedUuids.every((id) => input.sql.includes(id)), true); });
test("DELCLEAN-02", async () => { let called = false; await assert.rejects(() => localCleanup({ ownedIds: [cleanupCanonicalUuid], execute: async () => { called = true; return { stdout: "0\n" }; } })); assert.equal(called, false); });
test("DELCLEAN-03", async () => { await assert.rejects(() => localCleanup({ ownedIds: ["not-a-uuid"] })); });
test("DELCLEAN-04", async () => { const result = await localCleanup(); assert.equal(result.every((attempt) => attempt.result === "PASS"), true); });
test("DELCLEAN-05", async () => { await assert.rejects(() => localCleanup({ execute: async () => ({ stdout: "1\n" }) })); });
test("DELCLEAN-06", async () => { let input; await localCleanup({ sql: "delete from public.devices", execute: async (value) => { input = value; return { stdout: "0\n" }; } }); assert.equal(input.sql.includes("delete from public.devices"), true); assert.equal(input.sql.includes("delete from public.devices;"), false); });
test("DELCLEAN-07", async () => { await assert.rejects(() => localCleanup({ ownedPostgres: "remote-postgres.example.test" })); });
test("DELCLEAN-08", async () => { let directDeleteCalled = false; const { operations } = makeOperations({ runFinal: async () => primitive("finalizeDisposableDevices")({ db: { async remove() { directDeleteCalled = true; throw new Error("direct delete must not run"); }, async readAllIds() { return [cleanupCanonicalUuid, ...cleanupOwnedUuids]; } }, ownedIds: cleanupOwnedUuids, canonicalIds: [cleanupCanonicalUuid], cleanupOwned: async () => localCleanup({ execute: async () => { throw new Error("transaction failed"); } }) }) }); const result = await runP6bLifecycle({ operations, config: { mode: "API_ONLY", apiRequired: 16, uiRequired: 0 } }); assert.equal(result.acceptanceResult, "BLOCKED"); assert.equal(directDeleteCalled, false); });
test("CLEANPROOF-01", async () => { const canonical = Array.from({ length: 24 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`); const owned = ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000102"]; const rows = new Set([...canonical, ...owned]); const result = await primitive("finalizeDisposableDevices")({ db: { async readAllIds() { return [...rows]; } }, ownedIds: owned, canonicalIds: canonical, cleanupOwned: ({ ownedIds, canonicalIds }) => primitive("cleanupOwnedDevicesWithLocalPostgres")({ ownedPostgres: "a".repeat(12), ownedIds, canonicalIds, execute: async () => { owned.forEach((id) => rows.delete(id)); return { stdout: "0\n" }; } }) }); assert.deepEqual([result.postCleanup.totalDeviceCount, result.postCleanup.ownedRemainingCount, result.postCleanup.unexpectedNonCanonicalCount, result.postCleanup.finalDataGate], [24, 0, 0, "PASS"]); });
test("CLEANPROOF-02", async () => { await assert.rejects(() => localCleanup({ ownedIds: [cleanupCanonicalUuid] })); });
const pgFailure = (execute) => captureFailure(() => localCleanup({ execute }));
test("PGFORENSIC-01", async () => { const error = await pgFailure(async () => { const failure = new Error("psql exited 2"); failure.processExitCode = 2; throw failure; }); assert.equal(error.observations.trustedCleanup.processExitCode, 2); });
test("PGFORENSIC-02", async () => { const error = await pgFailure(async () => { const failure = new Error("psql exited 1"); failure.stderr = "ERROR: permission denied"; failure.processExitCode = 1; throw failure; }); assert.equal(error.observations.trustedCleanup.stderrText, "ERROR: permission denied"); });
test("PGFORENSIC-03", async () => { const error = await pgFailure(async () => ({ stdout: "BEGIN\nDELETE 2\n0\nCOMMIT\nEXTRA\n" })); assert.equal(error.observations.trustedCleanup.stdoutClassification, "MULTI_STATEMENT_PSQL_OUTPUT"); });
test("PGFORENSIC-04", async () => { const error = await pgFailure(async () => { const failure = new Error("delete failed"); failure.failurePhase = "DELETE_EXECUTION"; throw failure; }); assert.equal(error.observations.trustedCleanup.failurePhase, "DELETE_EXECUTION"); });
test("PGFORENSIC-05", async () => { const error = await pgFailure(async () => { const failure = new Error("timed out"); failure.timedOut = true; throw failure; }); assert.equal(error.observations.trustedCleanup.timedOut, true); assert.equal(error.observations.trustedCleanup.failurePhase, "TIMEOUT"); });
test("PGFORENSIC-06", async () => { const error = await pgFailure(async () => { const failure = new Error("syntax error"); failure.code = "42601"; throw failure; }); assert.equal(error.observations.trustedCleanup.errorCode, "42601"); });
test("PGFORENSIC-07", async () => { const error = await pgFailure(async () => ({ stdout: "1\n" })); assert.equal(error.observations.trustedCleanup.postVerifyRemainingCount, 1); assert.equal(error.observations.trustedCleanup.failurePhase, "POST_DELETE_VERIFY"); });
test("PGFORENSIC-08", async () => { const error = await pgFailure(async () => ({ stdout: "unparseable psql output\n" })); assert.equal(error.observations.trustedCleanup.failurePhase, "OUTPUT_PARSE"); });
test("PGFORENSIC-09", async () => { let called = false; const error = await captureFailure(() => localCleanup({ ownedIds: [cleanupCanonicalUuid], execute: async () => { called = true; return { stdout: "0\n" }; } })); assert.equal(error.observations.trustedCleanup.failurePhase, "CANONICAL_OVERLAP_GUARD"); assert.equal(called, false); });
test("PGFORENSIC-10", async () => { const error = await pgFailure(async () => { const failure = new Error("postgres://secret-password@host"); failure.stderr = "password=secret-password"; throw failure; }); const { operations } = makeOperations({ runFinal: async () => { throw error; } }); const result = await runP6bLifecycle({ operations, config: { mode: "API_ONLY", apiRequired: 16, uiRequired: 0 } }); assert.equal(JSON.stringify(result.observations).includes("secret-password"), false); });
test("PGPARSE-01", async () => { const result = await localCleanup({ execute: async () => ({ stdout: "BEGIN\nDELETE 2\n0\nCOMMIT\n", processExitCode: 0 }) }); assert.deepEqual([result.trustedCleanup.deletedRowCount, result.trustedCleanup.postVerifyRemainingCount, result.trustedCleanup.transactionCommitted, result.trustedCleanup.result], [2, 0, true, "PASS"]); });
test("C5TERM-01", async () => { const result = await runP6bLifecycle({ operations: makeOperations().operations, config: { mode: "API_ONLY", apiRequired: 16, uiRequired: 0 } }); assert.deepEqual([result.observations.P6B_RUNNER2C5_API_REQUIRED, result.observations.P6B_RUNNER2C5_API_EXECUTED, result.observations.P6B_RUNNER2C5_API_PASSED, result.observations.P6B_RUNNER2C5_API_FAILED], [16, 16, 16, 0]); });
test("C5TERM-02", async () => { const observations = primitive("postCleanupEvidence")({ totalDeviceCount: 24, canonicalExpectedCount: 24, canonicalObservedCount: 24, canonicalMissingCount: 0, ownedRemainingCount: 0, unexpectedNonCanonicalCount: 0, canonicalIdentityMatches: true, finalDataGate: "PASS", trustedCleanup: { canonicalOverlapCount: 0, postVerifyRemainingCount: 0, transactionCommitted: true, result: "PASS" } }); assert.deepEqual([observations.P6B_RUNNER2C5_TRUSTED_PG_CLEANUP, observations.P6B_RUNNER2C5_TRUSTED_PG_POSTVERIFY_REMAINING, observations.P6B_RUNNER2C5_TRUSTED_PG_TRANSACTION_COMMITTED], ["PASS", 0, true]); });
const observerEvidenceRun = async (counters = {}, overrides = {}) => runP6bLifecycle({ operations: fullOperations({ runUi: async () => ({ cases: uiLedger(), observerCounters: counters }), ...overrides }), config: fullConfig });
test("OBSEVID-01", async () => { const result = await observerEvidenceRun({ observerStaleListeners: 0, observerUnhandledRejections: 0 }); assert.equal(result.finalEvidenceGate, "BLOCKED"); });
test("OBSEVID-02", async () => { const result = await observerEvidenceRun({ observerPendingPromises: 0, observerUnhandledRejections: 0 }); assert.equal(result.finalEvidenceGate, "BLOCKED"); });
test("OBSEVID-03", async () => { const result = await observerEvidenceRun({ observerPendingPromises: 0, observerStaleListeners: 0 }); assert.equal(result.finalEvidenceGate, "BLOCKED"); });
test("OBSEVID-04", async () => { const result = await observerEvidenceRun({ observerPendingPromises: 1, observerStaleListeners: 0, observerUnhandledRejections: 0 }); assert.equal(result.finalEvidenceGate, "BLOCKED"); });
test("OBSEVID-05", async () => { const result = await observerEvidenceRun({ observerPendingPromises: 0, observerStaleListeners: 1, observerUnhandledRejections: 0 }); assert.equal(result.finalEvidenceGate, "BLOCKED"); });
test("OBSEVID-06", async () => { const result = await observerEvidenceRun({ observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 1 }); assert.equal(result.finalEvidenceGate, "BLOCKED"); });
test("OBSEVID-07", async () => { const result = await observerEvidenceRun({ observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 }); assert.equal(result.finalEvidenceGate, "PASS"); });
test("OBSEVID-08", async () => { const result = await observerEvidenceRun({ observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 }, { runUi: async () => ({ cases: uiLedger(16, 2), observerCounters: { observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 } }) }); assert.deepEqual([result.observerPendingPromises, result.observerStaleListeners, result.observerUnhandledRejections], [0, 0, 0]); });
test("OBSEVID-09", async () => { const result = await observerEvidenceRun({ observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 }, { cleanupBrowser: async () => { throw new Error("cleanup"); } }); assert.deepEqual([result.observerPendingPromises, result.observerStaleListeners, result.observerUnhandledRejections], [0, 0, 0]); });
test("OBSEVID-10", () => { const tracker = primitive("createObserverLifecycleTracker")(); tracker.settlePromise("missing"); tracker.removeListener("missing"); assert.deepEqual(Object.values(tracker.snapshot()), [0, 0, 0]); });
test("OBSEVID-11", () => { const tracker = primitive("createObserverLifecycleTracker")(); tracker.addListener("response"); tracker.removeListener("response"); assert.equal(tracker.snapshot().observerStaleListeners, 0); });
test("OBSEVID-12", () => { const tracker = primitive("createObserverLifecycleTracker")(); tracker.beginPromise("load"); tracker.settlePromise("load"); assert.equal(tracker.snapshot().observerPendingPromises, 0); });
test("OBSEVID-13", async () => { const tracker = primitive("createObserverLifecycleTracker")(); let listener; const page = { on: (_event, fn) => { listener = fn; }, off: () => { listener = null; } }; await assert.rejects(() => primitive("observeDeviceLoad")({ page, baseUrl: "http://127.0.0.1:56000", observerLifecycle: tracker, action: async () => { throw new Error("action failed"); } })); assert.deepEqual([listener, ...Object.values(tracker.snapshot())], [null, 0, 0, 0]); });
test("OBSEVID-14", async () => { const runId = "e1d2c3b4"; await primitive("writeFinalTerminal")(runId, { observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 }); const saved = await primitive("loadFinalTerminal")(runId); assert.deepEqual([saved.observerPendingPromises, saved.observerStaleListeners, saved.observerUnhandledRejections], [0, 0, 0]); });
test("OBSEVID-15", async () => { const result = await observerEvidenceRun({ observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 }); assert.equal(/token|password|authorization/i.test(JSON.stringify({ ...result, observations: undefined })), false); });
test("OBSEVID-16", () => { assert.equal(primitive("classifyObserverCounterEvidence")({ runId: "bad836a8" }), "PRE_SCHEMA_NOT_RECORDED"); });

// RUNNER2L: these liveness tests intentionally use only synthetic promises and
// filesystem evidence; they must never launch a runtime or browser.
const settlesWithin = async (promise, ms = 25) => Promise.race([promise.then(() => true, () => true), new Promise((resolve) => setTimeout(() => resolve(false), ms))]);
test("LIVETERM-01", async () => { const progress = primitive("createUiProgressState")({ runId: "a1b2c3d4", mode: "UI_ONLY" }); const result = await primitive("runUiCaseWithLiveness")({ caseId: "UIE2E-03", action: () => new Promise(() => {}), timeoutMs: 5, progress }); assert.equal(result.result, "FAIL"); assert.equal(result.failureClassification, "RUNNER_UI_CASE_LIVENESS_TIMEOUT"); });
test("LIVETERM-02", async () => { const page = { on() {}, off() {} }; assert.equal(await settlesWithin(primitive("observeDeviceLoad")({ page, baseUrl: "http://127.0.0.1:56000", action: () => new Promise(() => {}), timeoutMs: 5 })), true); });
test("LIVETERM-03", async () => { const progress = primitive("createUiProgressState")({ runId: "a1b2c3d4", mode: "UI_ONLY" }); const result = await primitive("runUiCaseWithLiveness")({ caseId: "UIE2E-13", action: async () => { throw new Error("fixture signal omitted"); }, progress }); assert.equal(result.result, "FAIL"); });
test("LIVETERM-04", async () => { const progress = primitive("createUiProgressState")({ runId: "a1b2c3d4", mode: "UI_ONLY" }); const result = await primitive("runUiCaseWithLiveness")({ caseId: "UIE2E-14", action: () => new Promise(() => {}), timeoutMs: 5, progress }); assert.equal(result.result, "FAIL"); });
test("LIVETERM-05", async () => { const progress = primitive("createUiProgressState")({ runId: "a1b2c3d4", mode: "UI_ONLY" }); await primitive("runUiCaseWithLiveness")({ caseId: "UIE2E-03", action: () => new Promise(() => {}), timeoutMs: 5, progress }); assert.deepEqual([progress.snapshot().uiCurrentCase, progress.snapshot().uiCurrentCasePhase, Number.isInteger(progress.snapshot().uiLastProgressSequence)], ["UIE2E-03", "CASE_FAIL", true]); });
test("LIVETERM-06", async () => { const result = await primitive("runLifecycleWithDurableTerminal")({ runId: "a1b2c3d4", mode: "UI_ONLY", operations: fullOperations({ runUi: async () => ({ cases: [await primitive("runUiCaseWithLiveness")({ caseId: "UIE2E-03", action: () => new Promise(() => {}), timeoutMs: 5 })], observerCounters: { observerPendingPromises: 0, observerStaleListeners: 0, observerUnhandledRejections: 0 } }) }), config: { mode: "UI_ONLY", apiRequired: 0, uiRequired: 16 } }); assert.equal((await primitive("loadFinalTerminal")("a1b2c3d4")).acceptanceResult, "BLOCKED"); assert.equal(result.acceptanceResult, "BLOCKED"); });
test("LIVETERM-07", async () => { const terminal = await primitive("loadFinalTerminal")("a1b2c3d4"); assert.deepEqual([terminal.observerPendingPromises, terminal.observerStaleListeners, terminal.observerUnhandledRejections], [0, 0, 0]); });
test("LIVETERM-08", async () => { await primitive("writeProgressCheckpoint")("b1b2c3d4", { mode: "UI_ONLY", progressSequence: 1, lifecycleStage: "runUi" }); assert.equal((await primitive("loadProgressCheckpoint")("b1b2c3d4")).progressSequence, 1); });
test("LIVETERM-09", async () => { const progress = await primitive("loadProgressCheckpoint")("b1b2c3d4"); assert.equal(progress.acceptanceResult === "PASS", false); });
test("LIVETERM-10", async () => { const progress = primitive("createUiProgressState")({ runId: "a1b2c3d4", mode: "UI_ONLY" }); const result = await primitive("runUiCaseWithLiveness")({ caseId: "UIE2E-16", action: async () => ({ ok: true }), progress }); assert.equal(result.result, "PASS"); assert.equal(progress.snapshot().watchdogActive, false); });
test("LIVETERM-11", async () => { const progress = primitive("createUiProgressState")({ runId: "a1b2c3d4", mode: "UI_ONLY" }); await primitive("runUiCaseWithLiveness")({ caseId: "UIE2E-15", action: () => new Promise(() => {}), timeoutMs: 5, progress }); assert.equal(progress.snapshot().watchdogActive, false); });
test("LIVETERM-12", () => { assert.equal(/unhandledRejection/.test(primitive("runUiCaseWithLiveness").toString()), false); });
test("LIVETERM-13", async () => { const progress = primitive("createUiProgressState")({ runId: "a1b2c3d4", mode: "UI_ONLY" }); const result = await primitive("runUiCaseWithLiveness")({ caseId: "UIE2E-03", action: () => new Promise(() => {}), timeoutMs: 5, progress }); assert.equal(result.caseId, "UIE2E-03"); });
test("LIVETERM-14", async () => { const progress = primitive("createUiProgressState")({ runId: "a1b2c3d4", mode: "UI_ONLY" }); const result = await primitive("runUiCaseWithLiveness")({ caseId: "UIE2E-13", action: () => new Promise(() => {}), timeoutMs: 5, progress }); assert.equal(result.caseId, "UIE2E-13"); });
test("LIVETERM-15", async () => { const progress = primitive("createUiProgressState")({ runId: "a1b2c3d4", mode: "UI_ONLY" }); const result = await primitive("runUiCaseWithLiveness")({ caseId: "UIE2E-15", action: () => new Promise(() => {}), timeoutMs: 5, progress }); assert.equal(result.caseId, "UIE2E-15"); });
test("LIVETERM-16", async () => { const checkpoint = await primitive("loadProgressCheckpoint")("b1b2c3d4"); assert.equal(/token|password|authorization/i.test(JSON.stringify(checkpoint)), false); });

test("UI03FORM-01", () => { assert.equal(primitive("evaluateCreateFormState")({ formCount: 0 }).failureClassification, "RUNNER_UIE2E03_CREATE_FORM_NOT_OPENED"); });
test("UI03FORM-02", () => { assert.equal(primitive("evaluateCreateFormState")({ formCount: 1, createHeading: false }).failureClassification, "RUNNER_UIE2E03_CREATE_FORM_READINESS"); });
test("UI03FORM-03", () => { assert.equal(primitive("deviceCreateFormContract")().fields.brandKey.label, "品牌代码"); });
test("UI03FORM-04", () => { const contract = primitive("deviceCreateFormContract")(); assert.equal(contract.fields.brandKey.selector, 'form.admin-news-form >> label:has-text("品牌代码") input'); });
test("UI03FORM-05", () => { assert.equal(primitive("evaluateCreateFormState")({ formCount: 1, createHeading: true, scopedBrandKeyCount: 1 }).result, "PASS"); });
test("UI03FORM-06", () => { assert.equal(primitive("evaluateCreateFormState")({ formCount: 1, createHeading: true, scopedBrandKeyCount: 1, outsideBrandKeyCount: 1 }).result, "PASS"); });
test("UI03FORM-07", () => { assert.equal(primitive("evaluateCreateFormState")({ formCount: 1, createHeading: true, scopedBrandKeyCount: 1 }).phase, "CREATE_FILL"); });
test("UI03FORM-08", async () => { const result = await primitive("runUiCaseWithLiveness")({ caseId: "UIE2E-03", action: () => new Promise(() => {}), timeoutMs: 5 }); assert.equal(result.failureClassification, "RUNNER_UI_CASE_LIVENESS_TIMEOUT"); });
test("UI03FORM-09", () => { assert.equal(primitive("evaluateCreateFormState")({ formCount: 1, createHeading: true, scopedBrandKeyCount: 0 }).failureClassification, "RUNNER_UIE2E03_BRANDKEY_FIELD_CONTRACT"); });
test("UI03FORM-10", () => { assert.equal(primitive("evaluateCreateFormState")({ formCount: 1, createHeading: true, scopedBrandKeyCount: 1, requiredFieldsFilled: false }).canSubmit, false); });
test("UI03FORM-11", () => { assert.equal(primitive("deviceCreateFormContract")().fields.name.label, "设备名称"); });
test("UI03FORM-12", () => { assert.equal(primitive("evaluateCreateFormState")({ formCount: 1, createHeading: true, scopedBrandKeyCount: 1 }).fixtureRegistered, false); });
test("UI03FORM-13", () => { assert.equal(primitive("evaluateCreateFormState")({ formCount: 0, caseId: "UIE2E-03" }).caseId, "UIE2E-03"); });
test("UI03FORM-14", () => { assert.equal(/token|password|authorization/i.test(JSON.stringify(primitive("deviceCreateFormContract")())), false); });
test("UI03FORM-15", () => { assert.notEqual(primitive("deviceCreateFormContract")().fields.brandKey.label, "brandKey"); });
test("UI03FORM-16", () => { assert.equal(primitive("evaluateUiE2e02")({ session: { browserSessionEstablished: true, browserSessionLocal: true, browserSessionActor: "moderator", browserSessionUserIdMatchesExpected: true, browserSessionRoleMatchesExpected: true }, network: { deviceLoadRequestObserved: true, deviceLoadMethod: "GET", deviceLoadPath: "/api/admin/devices", deviceLoadResponseObserved: true, deviceLoadStatus: 200, deviceLoadProductBrowserOriginated: true }, load: { cardsPresent: true }, dbSlugs: ["x"], apiSlugs: ["x"], domSlugs: ["x"] }).result, "PASS"); });

// RUNNER2AC: UIE2E-14 must retain an independent, secret-safe boundary record
// for each device rather than collapsing a real-browser failure to a generic error.
const diff14 = (overrides = {}) => primitive("evaluateDifferentDeviceIndependence")({
  deviceAId: "device-a", deviceBId: "device-b", deviceAIdentityMatchesExpected: true, deviceBIdentityMatchesExpected: true,
  observerArmedBeforeAAction: true, deviceAActionAttempted: true,
  deviceARequest: { method: "PATCH", pathname: "/api/admin/devices", id: "device-a", status: 200 },
  deviceAHoldEstablished: true, deviceAStillInflightBeforeB: true, deviceBActionControlAvailable: true, deviceBActionAttempted: true,
  deviceBRequest: { method: "PATCH", pathname: "/api/admin/devices", id: "device-b", status: 200 }, deviceBDbEffectCount: 1,
  deviceAHoldReleased: true, nonmatchingMutationRequestCount: 0, ...overrides,
});
test("DIFF14T-01",()=>assert.equal(diff14().deviceAIdentityMatchesExpected,true));
test("DIFF14T-02",()=>assert.equal(diff14().deviceBIdentityMatchesExpected,true));
test("DIFF14T-03",()=>assert.equal(diff14({deviceBId:"device-a"}).failureClassification,"RUNNER_DIFF_DEVICE_IDENTITIES_NOT_DISTINCT"));
test("DIFF14T-04",()=>assert.equal(diff14({observerArmedBeforeAAction:false}).failureClassification,"RUNNER_DIFF_DEVICE_OBSERVER_NOT_ARMED"));
test("DIFF14T-05",()=>assert.equal(diff14().deviceAActionAttempted,true));
test("DIFF14T-06",()=>assert.equal(diff14({deviceARequest:null}).failureClassification,"RUNNER_DEVICE_A_REQUEST_NOT_EMITTED"));
test("DIFF14T-07",()=>assert.equal(diff14({deviceAHoldEstablished:false}).failureClassification,"RUNNER_DEVICE_A_HOLD_NOT_ESTABLISHED"));
test("DIFF14T-08",()=>assert.equal(diff14({deviceAStillInflightBeforeB:false}).failureClassification,"RUNNER_DEVICE_A_HOLD_NOT_ESTABLISHED"));
test("DIFF14T-09",()=>assert.equal(diff14().deviceBActionControlAvailable,true));
test("DIFF14T-10",()=>assert.equal(diff14().deviceBActionAttempted,true));
test("DIFF14T-11",()=>assert.equal(diff14({deviceBRequest:null}).failureClassification,"RUNNER_DEVICE_B_REQUEST_NOT_EMITTED"));
test("DIFF14T-12",()=>assert.equal(diff14({deviceBRequest:{method:"PATCH",pathname:"/api/admin/devices",id:"wrong",status:200}}).failureClassification,"RUNNER_DEVICE_B_REQUEST_MATCHER_FAILURE"));
test("DIFF14T-13",()=>assert.equal(diff14({deviceBRequest:{method:"PATCH",pathname:"/api/admin/devices",id:"device-a",status:200}}).failureClassification,"RUNNER_DEVICE_B_REQUEST_MATCHER_FAILURE"));
test("DIFF14T-14",()=>assert.equal(diff14().deviceBRequestMatched,true));
test("DIFF14T-15",()=>assert.equal(diff14({deviceBRequest:{method:"POST",pathname:"/api/admin/devices",id:"device-b",status:200}}).failureClassification,"RUNNER_DEVICE_B_REQUEST_MATCHER_FAILURE"));
test("DIFF14T-16",()=>assert.equal(diff14().result,"PASS"));
test("DIFF14T-17",()=>assert.equal(diff14({deviceBDbEffectCount:0}).failureClassification,"RUNNER_DEVICE_B_DB_EFFECT_FAILURE"));
test("DIFF14T-18",()=>assert.equal(diff14({deviceAHoldReleased:false}).deviceAHoldReleased,false));
test("DIFF14T-19",()=>assert.equal(diff14({nonmatchingMutationRequestCount:1}).boundedNonmatchingMutationRequestCount,1));
test("DIFF14T-20",()=>assert.equal(/token|password|authorization/i.test(JSON.stringify(diff14({authorization:"secret"}))),false));

// RUNNER2AF: UIE2E-15 must use the displayed create-form contract and retain
// bounded rejection evidence without exposing request credentials or raw errors.
const rej15 = (overrides = {}) => primitive("evaluateUiE2e15Rejection")({
  fixtureReady: true, pageReady: true, formOpened: true, formReady: true,
  brandControlAvailable: true, requiredFieldsReady: true, observerArmedBeforeAction: true,
  actionAttempted: true, request: { method: "POST", pathname: "/api/admin/devices", slug: "p6b-rejection-fixture" },
  response: { observed: true, status: 409 }, expectedSlug: "p6b-rejection-fixture",
  falseSuccessObserved: false, internalErrorLeakObserved: false, unexpectedDbEffectCount: 0,
  recoveryObserved: true, ...overrides,
});
test("REJ15T-01",()=>assert.equal(rej15().result,"PASS"));
test("REJ15T-02",()=>assert.equal(rej15({fixtureReady:false}).failureClassification,"RUNNER_REJECTION_FIXTURE_NOT_READY"));
test("REJ15T-03",()=>assert.equal(rej15({pageReady:false}).failureClassification,"RUNNER_REJECTION_PAGE_NOT_READY"));
test("REJ15T-04",()=>assert.equal(rej15({formOpened:false}).failureClassification,"RUNNER_REJECTION_FORM_NOT_OPENED"));
test("REJ15T-05",()=>assert.equal(rej15({formReady:false}).failureClassification,"RUNNER_REJECTION_FORM_NOT_READY"));
test("REJ15T-06",()=>assert.equal(rej15({brandControlAvailable:false}).failureClassification,"RUNNER_REJECTION_BRAND_CONTROL_NOT_AVAILABLE"));
test("REJ15T-07",()=>assert.equal(rej15({requiredFieldsReady:false}).failureClassification,"RUNNER_REJECTION_REQUIRED_FIELD_NOT_AVAILABLE"));
test("REJ15T-08",()=>assert.equal(rej15({actionAttempted:false}).failureClassification,"RUNNER_REJECTION_ACTION_FAILURE"));
test("REJ15T-09",()=>assert.equal(rej15({request:null}).failureClassification,"RUNNER_REJECTION_REQUEST_NOT_EMITTED"));
test("REJ15T-10",()=>assert.equal(rej15({request:{method:"POST",pathname:"/api/admin/devices",slug:"wrong"}}).failureClassification,"RUNNER_REJECTION_REQUEST_NOT_MATCHED"));
test("REJ15T-11",()=>assert.equal(rej15({response:{observed:false,status:null}}).failureClassification,"RUNNER_REJECTION_RESPONSE_TIMEOUT"));
test("REJ15T-12",()=>assert.equal(rej15({response:{observed:true,status:200}}).failureClassification,"RUNNER_REJECTION_EXPECTED_NON2XX_NOT_OBSERVED"));
test("REJ15T-13",()=>assert.equal(rej15({falseSuccessObserved:true}).failureClassification,"PRODUCT_REJECTION_FALSE_SUCCESS_DEFECT"));
test("REJ15T-14",()=>assert.equal(rej15({internalErrorLeakObserved:true}).failureClassification,"PRODUCT_REJECTION_INTERNAL_ERROR_LEAK_DEFECT"));
test("REJ15T-15",()=>assert.equal(rej15({unexpectedDbEffectCount:1}).failureClassification,"PRODUCT_REJECTION_DB_EFFECT_DEFECT"));
test("REJ15T-16",()=>assert.equal(rej15({recoveryObserved:false}).failureClassification,"PRODUCT_REJECTION_RECOVERY_DEFECT"));
test("REJ15T-17",()=>assert.equal(rej15({observerArmedBeforeAction:false}).failureClassification,"RUNNER_REJECTION_ACTION_FAILURE"));
test("REJ15T-18",()=>assert.equal(rej15().requestSlugMatchesExpected,true));
test("REJ15T-19",()=>assert.equal(rej15().responseStatus,409));
test("REJ15T-20",()=>assert.equal(/token|password|authorization|23505|postgres/i.test(JSON.stringify(rej15({authorization:"secret",password:"secret",raw:"23505 postgres"}))),false));
test("REJ15MODEL-01",()=>{const result=rej15({fixtureId:"fixture-id",fixtureLifecycleReady:true,brandAccessibleLabel:"品牌代码",rawDbErrorLeakObserved:false,stackLeakObserved:false,secretLeakObserved:false,inflightGuardCleared:true});for(const name of ["rejectionFixtureId","rejectionFixtureIdentityMatchesExpected","rejectionFixtureLifecycleReady","rejectionPageLoaded","rejectionFormOpenAttempted","rejectionFormObserved","rejectionFormHeadingObserved","rejectionFormReady","rejectionBrandControlObserved","rejectionBrandAccessibleLabel","rejectionRequiredFieldsReady","rejectionObserverArmedBeforeAction","rejectionActionAttempted","rejectionRequestObserved","rejectionRequestMethod","rejectionRequestPath","rejectionRequestIdMatchesExpected","rejectionRequestMatched","rejectionResponseObserved","rejectionResponseStatus","rejectionExpectedNon2xxObserved","rejectionFalseSuccessObserved","rejectionRawDbErrorLeakObserved","rejectionStackLeakObserved","rejectionSecretLeakObserved","rejectionUnexpectedDbEffectCount","rejectionRecoveryObserved","rejectionInflightGuardCleared"])assert.equal(Object.hasOwn(result,name),true);assert.equal(result.rejectionBrandAccessibleLabel,"品牌代码");});

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
