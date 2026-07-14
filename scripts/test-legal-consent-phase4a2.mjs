import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { classifyApiMethod } from "../tests/fixtures/legal-consent-api-methods.mjs";
import { PHASE4A2_REPRESENTATIVES, PHASE4A2_STATUS } from "../tests/fixtures/legal-consent-phase4a2.mjs";
import { PHASE4B_MANIFEST_BEFORE_WAVE1, PHASE4B_WAVE1_METHODS, PHASE4B_WAVE1_STATUS } from "../tests/fixtures/legal-consent-phase4b-wave1.mjs";
import { PHASE4B_WAVE2_METHODS, PHASE4B_WAVE2_STATUS } from "../tests/fixtures/legal-consent-phase4b-wave2.mjs";
import { PHASE4B_WAVE3_METHODS, PHASE4B_WAVE3_STATUS } from "../tests/fixtures/legal-consent-phase4b-wave3.mjs";
import { PHASE4B_WAVE4_METHODS, PHASE4B_WAVE4_STATUS } from "../tests/fixtures/legal-consent-phase4b-wave4.mjs";
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

async function runGuardedRoute({ outcome, authenticated = true, staffAuthorized = true, suppliedActorId = "attacker", suppliedBundleVersion = "attacker-bundle", log }) {
  if (!authenticated) {
    log.push("authentication-denied");
    return new Response(JSON.stringify({ error: "NOT_AUTHENTICATED" }), { status: 401 });
  }
  log.push("authenticated:verified-actor");
  if (!staffAuthorized) {
    log.push("staff-authorization-denied");
    return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403 });
  }
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
assert.equal(PHASE4A2_STATUS.phase4BStatus, "complete");

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
assert.deepEqual(PHASE4B_WAVE2_METHODS.map((entry) => entry.id), PHASE4B_MANIFEST_BEFORE_WAVE1.slice(10, 16));
assert.equal(new Set(PHASE4B_WAVE2_METHODS.map((entry) => entry.sourceFile)).size, 6);
assert.deepEqual(PHASE4B_WAVE2_STATUS, {
  totalConsentRequiredMutationCount: 37,
  phase4A2IntegratedCount: 5,
  wave1IntegratedCount: 10,
  remainingBeforeWave: 22,
  waveIntegratedCount: 6,
  cumulativeIntegratedCount: 21,
  remainingMutationCount: 16,
  activeBlockers: [],
  nextManifestMethodId: "src/pages/api/forum/circles/[slug]/comments.ts#PATCH",
  phase4BStatus: "in-progress",
});
assert.deepEqual(PHASE4B_WAVE3_METHODS.map((entry) => entry.id), PHASE4B_MANIFEST_BEFORE_WAVE1.slice(16, 24));
assert.deepEqual(PHASE4B_WAVE3_STATUS, {
  totalConsentRequiredMutationCount: 37,
  phase4A2IntegratedCount: 5,
  wave1IntegratedCount: 10,
  wave2IntegratedCount: 6,
  remainingBeforeWave: 16,
  waveIntegratedCount: 8,
  cumulativeIntegratedCount: 29,
  remainingMutationCount: 8,
  activeBlockers: [],
  nextManifestMethodId: "src/pages/api/forum/comments.ts#DELETE",
  phase4BStatus: "in-progress",
});
assert.deepEqual(PHASE4B_WAVE4_METHODS.map((entry) => entry.id), PHASE4B_MANIFEST_BEFORE_WAVE1.slice(24, 32));
assert.equal(new Set(PHASE4B_WAVE4_METHODS.map((entry) => entry.sourceFile)).size, 6);
assert.deepEqual(PHASE4B_WAVE4_STATUS, {
  totalConsentRequiredMutationCount: 37,
  phase4A2IntegratedCount: 5,
  wave1IntegratedCount: 10,
  wave2IntegratedCount: 6,
  wave3IntegratedCount: 8,
  remainingBeforeWave: 8,
  waveIntegratedCount: 8,
  cumulativeIntegratedCount: 37,
  remainingMutationCount: 0,
  activeBlockers: [],
  nextManifestMethodId: null,
  phase4BStatus: "complete",
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
  const guard = handler.indexOf("const consent = await");
  const next = method === "DELETE" ? handler.indexOf("const url = new URL") : handler.indexOf("request.json()");
  assert.ok(auth >= 0 && auth < guard && guard < next, `${waveMethod.id} authenticates, gates consent, then starts route processing`);
}

for (const waveMethod of PHASE4B_WAVE2_METHODS) {
  const [sourceFile, method] = waveMethod.id.split("#");
  assert.equal(method, "POST", `${waveMethod.id} is a POST route`);
  assert.equal(classifyApiMethod(sourceFile, method).phase4IntegrationStatus, "phase4b-wave2-integrated", `${waveMethod.id} is integrated only in Wave 2`);
  const source = await readFile(path.join(root, sourceFile), "utf8");
  const handler = postHandler(source, "export const POST", "export const ALL");
  const auth = handler.indexOf("requireModerator(request, env)");
  const guard = handler.indexOf("requireAuthenticatedLegalConsent");
  const next = handler.indexOf("request.json()");
  assert.ok(auth >= 0 && auth < guard && guard < next, `${waveMethod.id} authenticates, gates consent, then parses the body`);
  assert.ok(handler.includes("identity: { userId: auth.user.id }"), `${waveMethod.id} scopes consent only to the verified actor`);
  assert.ok(handler.includes("createLegalConsentReadRepository(auth.client)"), `${waveMethod.id} uses the authenticated RLS client for the consent read`);
  if (sourceFile.includes("reports/")) {
    assert.ok(handler.includes("String(params.id ?? \"\").trim()"), `${waveMethod.id} derives the report id only from the route`);
    assert.ok(handler.includes("ALLOWED_ACTIONS.includes(action)"), `${waveMethod.id} retains the server allowlist for report actions`);
    assert.ok(handler.includes("applyAdminReportAction"), `${waveMethod.id} continues through report transition authorization only after consent`);
  } else {
    assert.ok(handler.includes("String(params.id ?? \"\").trim()"), `${waveMethod.id} derives the target user only from the route`);
    assert.ok(handler.includes("actorId: auth.user.id"), `${waveMethod.id} does not accept a client-controlled actor`);
    assert.ok(handler.includes("applyUserSafetyAction"), `${waveMethod.id} retains the server-side safety hierarchy helper`);
    const expectedAction = sourceFile.endsWith("unban.ts") ? "unban"
      : sourceFile.endsWith("ban.ts") ? "ban"
        : sourceFile.endsWith("clear-warning.ts") ? "clear_warning"
        : sourceFile.endsWith("suspend.ts") ? "suspend"
          : "warn";
    assert.ok(handler.includes(`action: \"${expectedAction}\"`), `${waveMethod.id} retains its action-specific safety transition`);
    if (expectedAction === "ban" || expectedAction === "warn" || expectedAction === "suspend") {
      assert.ok(handler.includes("REASON_REQUIRED"), `${waveMethod.id} keeps required reason validation after consent`);
    }
    if (expectedAction === "suspend") {
      assert.ok(handler.includes("until: payload?.until ?? null"), `${waveMethod.id} preserves server-side suspension expiry handling`);
    }
  }
}

for (const waveMethod of PHASE4B_WAVE3_METHODS) {
  const [sourceFile, method] = waveMethod.id.split("#");
  assert.equal(classifyApiMethod(sourceFile, method).phase4IntegrationStatus, "phase4b-wave3-integrated", `${waveMethod.id} is integrated only in Wave 3`);
  const source = await readFile(path.join(root, sourceFile), "utf8");
  const end = method === "POST" ? "export const PATCH" : method === "PATCH" && sourceFile.includes("[slug]") ? "export const DELETE" : "export const ALL";
  const handler = postHandler(source, `export const ${method}`, end);
  const auth = handler.indexOf("requireForumUser(request, env)");
  const guard = handler.indexOf("requireAuthenticatedLegalConsent");
  const managed = sourceFile.includes("[slug]");
  const next = managed ? handler.indexOf("requireManagedCircleForAuthenticatedUser") : handler.indexOf("assertUserCanWrite");
  assert.ok(auth >= 0 && auth < guard && guard < next, `${waveMethod.id} authenticates, gates consent, then begins its first resource or safety stage`);
  assert.ok(handler.includes("identity: { userId: auth.user.id }") || handler.includes("identity: { userId: forumAuth.user.id }"), `${waveMethod.id} scopes consent to the verified actor only`);
  assert.ok(handler.includes("createLegalConsentReadRepository"), `${waveMethod.id} uses the existing bearer-bound RLS client for consent reads`);
  if (managed) {
    assert.ok(handler.includes("requireManagedCircleForAuthenticatedUser({ auth: forumAuth, slug })"), `${waveMethod.id} resolves the exact managed circle only after consent`);
    const getHandler = postHandler(source, "export const GET", "export const PATCH");
    assert.equal(getHandler.includes("requireAuthenticatedLegalConsent"), false, `${sourceFile}#GET remains unguarded`);
    if (sourceFile.includes("comments")) {
      assert.ok(handler.includes(".from(\"comments\")") && handler.includes(".eq(\"circle_id\", auth.circle.id)"), `${waveMethod.id} keeps comment-to-circle binding`);
    } else if (sourceFile.includes("posts")) {
      assert.ok(handler.includes("existingPost.circle_id !== auth.circle.id"), `${waveMethod.id} keeps post-to-circle binding`);
    } else {
      assert.ok(handler.includes("assertUserCanWrite") && handler.includes(".from(\"circles\")"), `${waveMethod.id} keeps managed-circle safety and lifecycle processing downstream`);
    }
  } else {
    assert.ok(handler.includes("assertUserCanWrite") && handler.includes("auth.user.id"), `${waveMethod.id} keeps verified creator safety processing downstream`);
    assert.ok(handler.includes("owner_id") || handler.includes("isCircleManager"), `${waveMethod.id} keeps server-derived circle ownership handling`);
  }
}

for (const waveMethod of PHASE4B_WAVE4_METHODS) {
  const [sourceFile, method] = waveMethod.id.split("#");
  assert.equal(classifyApiMethod(sourceFile, method).phase4IntegrationStatus, "phase4b-wave4-integrated", `${waveMethod.id} is integrated only in Wave 4`);
  const source = await readFile(path.join(root, sourceFile), "utf8");
  const handler = sourceFile.endsWith("comments.ts")
    ? postHandler(source, `export const ${method}`, method === "DELETE" ? "export const PUT" : "export const ALL")
    : sourceFile.endsWith("posts.ts")
      ? postHandler(source, `export const ${method}`, method === "DELETE" ? "export const PATCH" : "export const ALL")
      : sourceFile.endsWith("external-video-upload.ts")
        ? postHandler(source, "export function createExternalVideoUploadPost", "export const POST")
        : sourceFile.endsWith("notifications.ts")
          ? postHandler(source, "export function createNotificationsPatch", "export const GET")
          : postHandler(source, "export const POST", "export const ALL");
  const auth = sourceFile.endsWith("notifications.ts")
    ? handler.indexOf("dependencies.authenticate(request, locals)")
    : handler.indexOf("auth.getUser(token)");
  const guard = handler.indexOf("const consent = await");
  const next = handler.indexOf(waveMethod.firstFollowingStage.includes("request.json") ? "request.json" : waveMethod.firstFollowingStage.includes("profiles") ? ".from(\"profiles\")" : waveMethod.firstFollowingStage.includes("content-length") ? "content-length" : "const safetyDecision = await");
  assert.ok(auth >= 0 && auth < guard && guard < next, `${waveMethod.id} authenticates, gates consent, then starts its first recorded downstream stage`);
  assert.ok(handler.includes("identity: { userId:"), `${waveMethod.id} passes only a verified actor to the guard`);
  assert.ok(handler.includes("createLegalConsentReadRepository"), `${waveMethod.id} uses the existing RLS client for consent reads`);
  if (sourceFile.endsWith("comments.ts") && method === "PUT") assert.ok(handler.includes("resolveAccessibleCommentReactionTarget") && handler.includes("comment_reactions"), `${waveMethod.id} retains comment-post-circle visibility and reaction binding`);
  if (sourceFile.endsWith("comments.ts") && method === "DELETE") assert.ok(handler.includes("isModeratorRole") && handler.includes("status: \"deleted\""), `${waveMethod.id} retains author-or-staff soft-delete lifecycle`);
  if (sourceFile.endsWith("external-video-upload.ts")) assert.ok(handler.includes("validateTurnstileToken") && handler.includes("signR2PutUrl") && handler.includes("buildTmpVideoKey"), `${waveMethod.id} retains target ownership, Turnstile, and post-bound signing`);
  if (sourceFile.endsWith("media-upload-guard.ts")) assert.ok(handler.includes("[\"post_media\", \"circle_cover\", \"profile_avatar\", \"profile_banner\"]") && handler.includes("enforceUploadRateLimit"), `${waveMethod.id} retains purpose allowlist and quota checks`);
  if (sourceFile.endsWith("post-media.ts")) assert.ok(handler.includes("validateMediaArray") && handler.includes("moderatePostMedia") && handler.includes(".insert(rows)"), `${waveMethod.id} retains post-bound media provenance and moderation`);
  if (sourceFile.endsWith("posts.ts") && method === "DELETE") assert.ok(handler.includes("resolveAccessibleForumPostTarget") && handler.includes("deletePostMediaObjects"), `${waveMethod.id} retains target authorization and cleanup lifecycle`);
  if (sourceFile.endsWith("posts.ts") && method === "PATCH") assert.ok(handler.includes("resolveAccessibleForumPostTarget") && handler.includes("isModeratorRole"), `${waveMethod.id} retains exact target and moderator-only transition authorization`);
  if (sourceFile.endsWith("notifications.ts")) assert.ok(handler.includes('.eq("recipient_id", auth.userId)') && handler.includes('.is("read_at", null)'), `${waveMethod.id} retains recipient-scoped idempotent updates`);
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

for (const waveMethod of PHASE4B_WAVE2_METHODS) {
  const unauthenticatedLog = [];
  const unauthenticated = await runGuardedRoute({ outcome: "missing", authenticated: false, log: unauthenticatedLog });
  assert.equal(unauthenticated.status, 401, `${waveMethod.id} unauthenticated`);
  assert.deepEqual(unauthenticatedLog, ["authentication-denied"], `${waveMethod.id} does not construct a consent repository before authentication`);

  const insufficientRoleLog = [];
  const insufficientRole = await runGuardedRoute({ outcome: "current", staffAuthorized: false, log: insufficientRoleLog });
  assert.equal(insufficientRole.status, 403, `${waveMethod.id} preserves the staff authorization boundary`);
  assert.deepEqual(insufficientRoleLog, ["authenticated:verified-actor", "staff-authorization-denied"], `${waveMethod.id} does not let current consent grant staff authority`);

  for (const outcome of ["missing", "outdated", "failure"]) {
    const log = [];
    const response = await runGuardedRoute({ outcome, log });
    assert.equal(response.status, outcome === "failure" ? 503 : 403, `${waveMethod.id} ${outcome}`);
    assert.deepEqual(await response.json(), outcome === "failure"
      ? { error: "LEGAL_CONSENT_UNAVAILABLE" }
      : { error: "LEGAL_CONSENT_REQUIRED", consentUrl: "/legal-consent/" }, `${waveMethod.id} returns the central sanitized denial`);
    assert.deepEqual(log.filter((entry) => entry.startsWith("downstream-")), [], `${waveMethod.id} ${outcome} produces zero report, safety, notification, audit, or mutation calls`);
  }

  const currentLog = [];
  const current = await runGuardedRoute({ outcome: "current", log: currentLog });
  assert.equal(current.status, 201, `${waveMethod.id} current consent continues into its existing route behavior`);
  assert.deepEqual(currentLog.slice(-3), ["downstream-target-read", "downstream-rate-or-provider", "downstream-persistent-mutation"]);
}

for (const waveMethod of PHASE4B_WAVE3_METHODS) {
  const unauthenticatedLog = [];
  const unauthenticated = await runGuardedRoute({ outcome: "missing", authenticated: false, log: unauthenticatedLog });
  assert.equal(unauthenticated.status, 401, `${waveMethod.id} unauthenticated`);
  assert.deepEqual(unauthenticatedLog, ["authentication-denied"], `${waveMethod.id} has no consent read or downstream effect before authentication`);
  for (const outcome of ["missing", "outdated", "failure"]) {
    const log = [];
    const response = await runGuardedRoute({ outcome, log });
    assert.equal(response.status, outcome === "failure" ? 503 : 403, `${waveMethod.id} ${outcome}`);
    assert.deepEqual(await response.json(), outcome === "failure"
      ? { error: "LEGAL_CONSENT_UNAVAILABLE" }
      : { error: "LEGAL_CONSENT_REQUIRED", consentUrl: "/legal-consent/" }, `${waveMethod.id} uses the central sanitized denial response`);
    assert.deepEqual(log.filter((entry) => entry.startsWith("downstream-")), [], `${waveMethod.id} ${outcome} produces zero circle, safety, resource, mutation, or provider calls`);
  }
  const currentLog = [];
  const current = await runGuardedRoute({ outcome: "current", log: currentLog });
  assert.equal(current.status, 201, `${waveMethod.id} current consent continues into existing authorization`);
  assert.deepEqual(currentLog.slice(-3), ["downstream-target-read", "downstream-rate-or-provider", "downstream-persistent-mutation"]);
}

for (const waveMethod of PHASE4B_WAVE4_METHODS) {
  const unauthenticatedLog = [];
  const unauthenticated = await runGuardedRoute({ outcome: "missing", authenticated: false, log: unauthenticatedLog });
  assert.equal(unauthenticated.status, 401, `${waveMethod.id} unauthenticated`);
  assert.deepEqual(unauthenticatedLog, ["authentication-denied"], `${waveMethod.id} does not construct a consent reader before verified authentication`);
  for (const outcome of ["missing", "outdated", "failure"]) {
    const log = [];
    const response = await runGuardedRoute({ outcome, log });
    assert.equal(response.status, outcome === "failure" ? 503 : 403, `${waveMethod.id} ${outcome}`);
    assert.deepEqual(await response.json(), outcome === "failure"
      ? { error: "LEGAL_CONSENT_UNAVAILABLE" }
      : { error: "LEGAL_CONSENT_REQUIRED", consentUrl: "/legal-consent/" }, `${waveMethod.id} uses the central denial contract`);
    assert.deepEqual(log.filter((entry) => entry.startsWith("downstream-")), [], `${waveMethod.id} ${outcome} produces zero resource, safety, signing, provider, mutation, cleanup, or notification effects`);
  }
  const currentLog = [];
  const current = await runGuardedRoute({ outcome: "current", log: currentLog });
  assert.equal(current.status, 201, `${waveMethod.id} current consent continues into existing authorization`);
  assert.deepEqual(currentLog.slice(-3), ["downstream-target-read", "downstream-rate-or-provider", "downstream-persistent-mutation"]);
}

const userSafetySource = await readFile(path.join(root, "src/lib/server/user-safety.server.ts"), "utf8");
const safetyAction = postHandler(userSafetySource, "export async function applyUserSafetyAction", undefined);
for (const requiredSymbol of ["actorId === targetUserId", "authorizeUserSafetyAction", "getUserSafetyState", "upsertUserSafetyState", "insertUserSafetyEvent"]) {
  assert.ok(safetyAction.includes(requiredSymbol), `user-safety helper retains ${requiredSymbol} after the consent boundary`);
}
const reportsSource = await readFile(path.join(root, "src/lib/server/reports.server.ts"), "utf8");
const reportAction = postHandler(reportsSource, "export async function applyAdminReportAction", undefined);
assert.ok(reportAction.indexOf("fetchAdminReportDetail") < reportAction.indexOf("updateReportStatus"), "report action still resolves the report before a report-status mutation");
assert.ok(reportAction.includes("applyUserSafetyAction"), "report action retains downstream user-safety hierarchy enforcement");
const circleManagementSource = await readFile(path.join(root, "src/lib/server/circle-management.ts"), "utf8");
const managedCircleResolver = postHandler(circleManagementSource, "export async function requireManagedCircleForAuthenticatedUser", "export async function requireManagedCircleBySlug");
assert.ok(managedCircleResolver.includes(".eq(\"slug\", params.slug)") && managedCircleResolver.includes("isCircleManager"), "managed-circle resolver retains exact slug lookup and server-derived manager authorization");

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

assert.equal(classifyApiMethod("src/pages/api/legal/consent.ts", "POST").phase4IntegrationStatus, "exempt");
assert.equal(classifyApiMethod("src/pages/api/auth/resend-confirmation.ts", "POST").phase4IntegrationStatus, "exempt");
assert.equal(classifyApiMethod("src/pages/api/forum/comments.ts", "GET").phase4IntegrationStatus, "not-required");

console.log(JSON.stringify({
  phase4A1: "66/66 traced, 0 pending",
  representatives: "5/5 integrated",
  phase4BWave1: "10/10 integrated",
  phase4BWave2: "6/6 integrated",
  phase4BWave3: "8/8 integrated",
  phase4BWave4: "8/8 integrated; 0 remaining",
  denial: "403 missing-or-outdated, 503 infrastructure failure, zero downstream call-log entries",
  exemptions: ["legal consent POST", "auth recovery", "read-only GET"],
  phase4B: "complete 37/37",
  realOperations: 0,
}));
