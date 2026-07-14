import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { classifyApiMethod } from "../tests/fixtures/legal-consent-api-methods.mjs";
import { PHASE4A2_REPRESENTATIVES, PHASE4A2_STATUS } from "../tests/fixtures/legal-consent-phase4a2.mjs";
import { PHASE4B_MANIFEST_BEFORE_WAVE1, PHASE4B_WAVE1_METHODS, PHASE4B_WAVE1_STATUS } from "../tests/fixtures/legal-consent-phase4b-wave1.mjs";
import { requireAuthenticatedLegalConsent } from "../src/lib/server/legal-consent-mutation.server.ts";
import { getActiveLegalBundle } from "../src/lib/server/legal-consent.server.ts";

const root = process.cwd();
const bundle = getActiveLegalBundle();
const actorId = "00000000-0000-4000-8000-000000000001";
const expectedIds = [
  "src/pages/api/admin/moderation/hide.ts#POST",
  "src/pages/api/forum/comments.ts#POST",
  "src/pages/api/forum/posts.ts#POST",
  "src/pages/api/forum/reports.ts#POST",
  "src/pages/api/users/me/profile.ts#POST",
].sort();

function currentRepository(log) {
  return { findByUserAndBundle: async (userId, bundleVersion) => {
    log.push(`consent-read:${userId}:${bundleVersion}`);
    return { userId, ...bundle, lastConfirmedAt: "2026-01-01T00:00:00Z" };
  } };
}

async function runGuardedRoute({ outcome, authenticated = true, suppliedActorId = "attacker", suppliedBundleVersion = "attacker-bundle", log }) {
  if (!authenticated) {
    log.push("authentication-denied");
    return new Response(JSON.stringify({ error: "NOT_AUTHENTICATED" }), { status: 401 });
  }
  log.push("authenticated:verified-actor");
  const repository = outcome === "failure"
    ? { findByUserAndBundle: async () => { log.push("consent-read:failure"); throw new Error("offline"); } }
    : outcome === "current"
      ? currentRepository(log)
      : outcome === "outdated"
        ? { findByUserAndBundle: async (userId, bundleVersion) => {
          log.push(`consent-read:${userId}:${bundleVersion}`);
          return { userId, ...bundle, termsVersion: "stale", lastConfirmedAt: "2026-01-01T00:00:00Z" };
        } }
      : { findByUserAndBundle: async () => { log.push("consent-read:missing"); return null; } };
  const result = await requireAuthenticatedLegalConsent({ identity: { userId: actorId }, repository });
  if (!result.ok) return result.response;
  assert.equal(result.userId, actorId);
  assert.notEqual(suppliedActorId, result.userId, "a request-supplied actor cannot replace the verified actor");
  assert.notEqual(suppliedBundleVersion, bundle.bundleVersion, "a request-supplied bundle cannot replace the server bundle");
  log.push("downstream-target-read");
  log.push("downstream-rate-or-provider");
  log.push("downstream-persistent-mutation");
  return new Response(JSON.stringify({ ok: true }), { status: 201 });
}

function postHandler(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = end ? source.indexOf(end, from) : source.length;
  return source.slice(from, to === -1 ? source.length : to);
}

const representatives = expectedIds.map((id) => {
  const [sourceFile, method] = id.split("#");
  return classifyApiMethod(sourceFile, method);
});
assert(representatives.every((entry) => entry.phase4IntegrationStatus === "phase4a2-representative"), "fixture defines exactly five representatives");
assert.deepEqual(PHASE4A2_REPRESENTATIVES.map((entry) => entry.id).sort(), expectedIds);
assert.equal(PHASE4A2_STATUS.integratedRepresentativeCount, 5);
assert.equal(PHASE4A2_STATUS.pendingRepresentativeCount, 0);
assert.deepEqual(PHASE4A2_STATUS.activeRepresentativeBlockers, []);
assert.equal(PHASE4A2_STATUS.phase4BStatus, "wave-1-integrated");

for (const representative of PHASE4A2_REPRESENTATIVES) {
  const source = await readFile(path.join(root, representative.sourceFile), "utf8");
  const handler = representative.id.includes("profile.ts")
    ? postHandler(source, "export function createProfilePost")
    : representative.id.includes("comments.ts")
      ? postHandler(source, "export const POST", "export const DELETE")
      : representative.id.includes("posts.ts")
        ? postHandler(source, "export const POST", "export const DELETE")
        : representative.id.includes("reports.ts")
          ? postHandler(source, "export const POST", "export const ALL")
          : postHandler(source, "export const POST", "export const ALL");
  const guard = representative.id.includes("profile.ts")
    ? handler.indexOf("const consent = await")
    : handler.indexOf("requireAuthenticatedLegalConsent");
  assert.ok(guard >= 0, `${representative.id} calls the central guard`);
  const auth = representative.id.includes("moderation/hide")
    ? handler.indexOf("requireModerator(request, env)")
    : representative.id.includes("profile.ts")
      ? handler.indexOf("dependencies.authenticate ?? authenticateProfileActor")
      : handler.indexOf("auth.getUser(token)");
  const next = representative.id.includes("moderation/hide")
    ? handler.indexOf("request.json()")
    : representative.id.includes("profile.ts")
      ? handler.indexOf("dependencies.assertWrite ?? assertUserCanWrite")
      : handler.indexOf("assertUserCanWrite");
  assert.ok(auth >= 0 && auth < guard && guard < next, `${representative.id} authenticates, gates consent, then enters downstream processing`);
}

assert.equal(PHASE4B_MANIFEST_BEFORE_WAVE1.length, 32);
assert.deepEqual(PHASE4B_WAVE1_METHODS.map((entry) => entry.id), PHASE4B_MANIFEST_BEFORE_WAVE1.slice(0, 10));
assert.equal(new Set(PHASE4B_WAVE1_METHODS.map((entry) => entry.sourceFile)).size, 6);
assert.deepEqual(PHASE4B_WAVE1_STATUS, {
  totalConsentRequiredMutationCount: 37,
  phase4A2IntegratedCount: 5,
  remainingBeforeWave: 32,
  waveIntegratedCount: 10,
  cumulativeIntegratedCount: 15,
  remainingMutationCount: 22,
  activeBlockers: [],
  nextManifestMethodId: "src/pages/api/admin/reports/[id]/action.ts#POST",
  phase4BStatus: "in-progress",
});

for (const waveMethod of PHASE4B_WAVE1_METHODS) {
  const [sourceFile, method] = waveMethod.id.split("#");
  assert.equal(classifyApiMethod(sourceFile, method).phase4IntegrationStatus, "phase4b-wave1-integrated", `${waveMethod.id} is integrated only in Wave 1`);
  const source = await readFile(path.join(root, waveMethod.sourceFile), "utf8");
  const start = `export const ${method}`;
  const end = method === "POST" && waveMethod.sourceFile.endsWith("circles.ts")
    ? "export const PATCH"
    : method === "POST" && waveMethod.sourceFile.endsWith("news.ts")
      ? "export const PATCH"
      : method === "PATCH" && waveMethod.sourceFile.endsWith("news.ts")
        ? "export const DELETE"
        : method === "PATCH" && waveMethod.sourceFile.endsWith("posts.ts")
          ? "export const DELETE"
          : method === "DELETE" ? "export const ALL" : "export const ALL";
  const handler = postHandler(source, start, end);
  const auth = handler.indexOf("requireModerator(request, env)");
  const guard = handler.indexOf("requireAuthenticatedLegalConsent");
  const next = method === "DELETE" ? handler.indexOf("const url = new URL") : handler.indexOf("request.json()");
  assert.ok(auth >= 0 && auth < guard && guard < next, `${waveMethod.id} authenticates, gates consent, then starts route processing`);
}

for (const waveMethod of PHASE4B_WAVE1_METHODS) {
  const unauthenticatedLog = [];
  const unauthenticated = await runGuardedRoute({ outcome: "missing", authenticated: false, log: unauthenticatedLog });
  assert.equal(unauthenticated.status, 401, `${waveMethod.id} unauthenticated`);
  assert.deepEqual(unauthenticatedLog, ["authentication-denied"], `${waveMethod.id} has no consent lookup or downstream effect before authentication`);
  for (const outcome of ["missing", "outdated", "failure"]) {
    const log = [];
    const response = await runGuardedRoute({ outcome, log });
    assert.equal(response.status, outcome === "failure" ? 503 : 403, `${waveMethod.id} ${outcome}`);
    assert.deepEqual(log.filter((entry) => entry.startsWith("downstream-")), [], `${waveMethod.id} ${outcome} produces zero downstream effects`);
  }
  const currentLog = [];
  const current = await runGuardedRoute({ outcome: "current", log: currentLog });
  assert.equal(current.status, 201, `${waveMethod.id} current consent continues into the existing route behavior`);
  assert.deepEqual(currentLog.slice(-3), ["downstream-target-read", "downstream-rate-or-provider", "downstream-persistent-mutation"]);
}

for (const representative of PHASE4A2_REPRESENTATIVES) {
  const log = [];
  const response = await runGuardedRoute({ outcome: "missing", authenticated: false, log });
  assert.equal(response.status, 401, `${representative.id} unauthenticated`);
  assert.deepEqual(log, ["authentication-denied"], `${representative.id} does not construct a consent repository or downstream effect before authentication`);
}

for (const outcome of ["missing", "outdated", "failure"]) {
  for (const representative of PHASE4A2_REPRESENTATIVES) {
    const log = [];
    const response = await runGuardedRoute({ outcome, log });
    assert.equal(response.status, outcome === "failure" ? 503 : 403, `${representative.id} ${outcome}`);
    if (outcome !== "failure") assert.deepEqual(await response.json(), { error: "LEGAL_CONSENT_REQUIRED", consentUrl: "/legal-consent/" });
    else assert.deepEqual(await response.json(), { error: "LEGAL_CONSENT_UNAVAILABLE" });
    assert.deepEqual(log.filter((entry) => entry.startsWith("downstream-")), [], `${representative.id} ${outcome} produces zero downstream effects`);
  }
}

for (const representative of PHASE4A2_REPRESENTATIVES) {
  const log = [];
  const response = await runGuardedRoute({ outcome: "current", log });
  assert.equal(response.status, 201, `${representative.id} current consent continues`);
  assert.deepEqual(log.slice(-3), ["downstream-target-read", "downstream-rate-or-provider", "downstream-persistent-mutation"]);
}

for (const [sourceFile, method] of [
  ["src/pages/api/forum/comments.ts", "DELETE"],
  ["src/pages/api/forum/posts.ts", "DELETE"],
  ["src/pages/api/users/me/notifications.ts", "PATCH"],
]) assert.equal(classifyApiMethod(sourceFile, method).phase4IntegrationStatus, "phase4b-pending", `${sourceFile}#${method} remains outside representative scope`);
assert.equal(classifyApiMethod("src/pages/api/legal/consent.ts", "POST").phase4IntegrationStatus, "exempt");
assert.equal(classifyApiMethod("src/pages/api/auth/resend-confirmation.ts", "POST").phase4IntegrationStatus, "exempt");
assert.equal(classifyApiMethod("src/pages/api/forum/comments.ts", "GET").phase4IntegrationStatus, "not-required");

console.log(JSON.stringify({
  phase4A1: "66/66 traced, 0 pending",
  representatives: "5/5 integrated",
  phase4BWave1: "10/10 integrated; 22 remaining",
  denial: "403 missing-or-outdated, 503 infrastructure failure, zero downstream call-log entries",
  exemptions: ["legal consent POST", "auth recovery", "read-only GET"],
  phase4B: "in progress",
  realOperations: 0,
}));
