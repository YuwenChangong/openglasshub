const READY = "OPENGLASS_HUB_PUBLIC_BETA_P6B_DEVICE_ADMIN_LOCAL_E2E_READY";
const BLOCKED = "OPENGLASS_HUB_PUBLIC_BETA_P6B_BLOCKED";
const isLocal = (value) => typeof value === "string" && ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
const redact = (value) => JSON.parse(JSON.stringify(value, (key, item) => typeof item === "string" && /(jwt|token|anon.?key|service.?key|password)/i.test(`${key} ${item}`) ? "[REDACTED]" : item));

export async function runP6bLifecycle({ operations, evidence = [], config = { apiRequired: 16, uiRequired: 16 }, runId = "p6b" }) {
  const observations = {};
  const result = { runId, acceptanceResult: "PASS", cleanupResult: "PASS", firstFailureStage: null, firstFailureCase: null, apiPassed: 0, apiRequired: config.apiRequired, uiPassed: 0, uiRequired: config.uiRequired, finalEvidenceGate: "PENDING", supabaseStartCount: 0, astroStartCount: 0, browserStartCount: 0, remoteConnectionCount: 0, astroStopped: false, supabaseCleaned: false, preexistingStatePreserved: false };
  const retain = (value) => { if (value?.observations && typeof value.observations === "object") Object.assign(observations, redact(value.observations)); return value; };
  const step = async (name) => { try { const value = retain(await operations[name]()); evidence.push(redact({ stage: name, value })); return value; } catch (error) { retain(error); evidence.push(redact({ stage: name, failureObservations: error.observations })); result.firstFailureStage ??= name; result.firstFailureCase ??= error.caseId ?? null; throw error; } };
  try {
    const setupStages = ["snapshot", "allocateRuntimeConfig", "mirror", "startSupabase", "verifyOwnership", "prepareDatabase", "createAuthFixtures", "assignFixtureRoles", "verifyFixtureRoles"];
    if (!config.helperOnly) setupStages.push("startAstro");
    for (const name of setupStages) { await step(name); if (name === "startSupabase") result.supabaseStartCount++; if (name === "startAstro") result.astroStartCount++; }
    if (config.helperOnly) { await step("runFinal"); result.finalEvidenceGate = "PASS"; }
    else {
    const runtime = await step("verifyRuntime");
    if (!isLocal(runtime.supabaseUrl) || !isLocal(runtime.publicSupabaseUrl) || !runtime.anonKeyPresent || !runtime.publicAnonKeyPresent) throw new Error("P6B_LOCAL_RUNTIME_ENV_CONTRACT_REGRESSION");
    const api = await step("runApi"); result.apiPassed = api.passed;
    if (api.passed !== result.apiRequired) { result.firstFailureCase ??= api.firstFailureCase; throw new Error("API_FAILED"); }
    if (result.uiRequired) { await step("startBrowser"); result.browserStartCount++; const ui = await step("runUi"); result.uiPassed = ui.passed; if (ui.passed !== result.uiRequired) { result.firstFailureCase ??= ui.firstFailureCase; throw new Error("UI_FAILED"); } }
    await step("runFinal"); result.finalEvidenceGate = "PASS";
    }
  } catch (error) { result.acceptanceResult = "BLOCKED"; evidence.push(redact({ stage: "failure", message: error.message })); }
  finally {
    for (const [name, property] of [["cleanupBrowser"], ["stopAstro", "astroStopped"], ["stopSupabase", "supabaseCleaned"]]) try { await step(name); if (property) result[property] = true; } catch { result.cleanupResult = "BLOCKED"; }
    try { const cleanup = await step("verifyCleanup"); result.preexistingStatePreserved = !!cleanup.preexistingStatePreserved; if (!result.preexistingStatePreserved) result.cleanupResult = "BLOCKED"; } catch { result.cleanupResult = "BLOCKED"; }
  }
  Object.assign(observations, { P6B_RUNNER1B_SUPABASE_START_COUNT: result.supabaseStartCount, P6B_RUNNER1B_ASTRO_START_COUNT: result.astroStartCount, P6B_RUNNER1B_BROWSER_START_COUNT: result.browserStartCount, P6B_RUNNER1B_ASTRO_STOPPED: result.astroStopped, P6B_RUNNER1B_SUPABASE_CLEANED: result.supabaseCleaned, P6B_RUNNER1B_PREEXISTING_RUNTIME_STATE_PRESERVED: result.preexistingStatePreserved });
  return redact({ ...result, observations, terminal: result.acceptanceResult === "PASS" && result.cleanupResult === "PASS" && result.finalEvidenceGate === "PASS" ? READY : BLOCKED });
}
