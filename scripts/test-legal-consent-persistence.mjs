import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { LEGAL_POLICY } from "../src/lib/legal-policy.ts";
import {
  buildSafeConsentResponse,
  getActiveLegalBundle,
  getCurrentConsentStatus,
  recordCurrentLegalConsent,
  requireCurrentLegalConsent,
} from "../src/lib/server/legal-consent.server.ts";
import {
  handleLegalConsentGet,
  handleLegalConsentPost,
} from "../src/lib/server/legal-consent-api.server.ts";

const root = process.cwd();
const userId = "00000000-0000-0000-0000-000000000001";
const otherUserId = "00000000-0000-0000-0000-000000000002";

function activeRecord(overrides = {}) {
  return {
    userId,
    bundleVersion: LEGAL_POLICY.bundleVersion,
    termsVersion: LEGAL_POLICY.termsVersion,
    privacyVersion: LEGAL_POLICY.privacyVersion,
    guidelinesVersion: LEGAL_POLICY.guidelinesVersion,
    minimumAge: LEGAL_POLICY.minimumAge,
    lastConfirmedAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

function request(body, options = {}) {
  return new Request("https://unit.test/api/legal/consent", {
    method: "POST",
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    body,
  });
}

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function responseJson(response) {
  return { status: response.status, body: await response.json() };
}

async function main() {
  const migration = await read("supabase/migrations/20260712_legal_policy_acceptances.sql");
  const route = await read("src/pages/api/legal/consent.ts");
  const repository = await read("src/lib/server/legal-consent-repository.server.ts");

  assert.equal(LEGAL_POLICY.minimumAge, 16);
  assert.equal(getActiveLegalBundle().bundleVersion, LEGAL_POLICY.bundleVersion);
  assert.match(migration, /create table if not exists public\.legal_policy_acceptances/i);
  for (const column of [
    "user_id", "bundle_version", "terms_version", "privacy_version", "guidelines_version", "minimum_age",
    "accepted_at", "first_acceptance_source", "last_confirmed_at", "last_confirmation_source",
    "confirmation_count", "created_at", "updated_at",
  ]) {
    assert.match(migration, new RegExp(`\\b${column}\\b`, "i"), `missing ${column}`);
  }
  assert.match(migration, /references auth\.users\(id\)/i);
  assert.match(migration, /unique \(user_id, bundle_version\)/i);
  assert.match(migration, /default now\(\)/i);
  assert.match(migration, /confirmation_count > 0/i);
  assert.match(migration, /in \('registration', 'login', 'policy_update', 'legacy_account_gate', 'authenticated_callback'\)/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table public\.legal_policy_acceptances from anon, authenticated/i);
  assert.match(migration, /for select[\s\S]*to authenticated[\s\S]*user_id = auth\.uid\(\)/i);
  assert.doesNotMatch(migration, /for (?:insert|update|delete)[\s\S]{0,120}to authenticated/i);
  assert.match(migration, /grant execute on function public\.record_current_legal_policy_acceptance[\s\S]*to service_role/i);
  assert.match(migration, /revoke all on function public\.record_current_legal_policy_acceptance[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /confirmation_count = public\.legal_policy_acceptances\.confirmation_count \+ 1/i);
  assert.match(migration, /last_confirmed_at = now\(\)/i);
  assert.match(migration, /legal_policy_acceptances_bundle_last_confirmed_idx/i);
  assert.doesNotMatch(migration, /\b(?:email|password|token|cookie|session|ip_address|user_agent)\b/i);

  const currentStatus = await getCurrentConsentStatus({
    async findByUserAndBundle(foundUserId, bundleVersion) {
      assert.equal(foundUserId, userId);
      assert.equal(bundleVersion, LEGAL_POLICY.bundleVersion);
      return activeRecord();
    },
  }, userId);
  assert.equal(currentStatus.current, true);
  assert.deepEqual(buildSafeConsentResponse(currentStatus), {
    current: true,
    bundleVersion: LEGAL_POLICY.bundleVersion,
    minimumAge: 16,
    consentUrl: "/legal-consent/",
  });
  assert.equal("lastConfirmedAt" in buildSafeConsentResponse(currentStatus), false);

  const outdatedStatus = await getCurrentConsentStatus({
    async findByUserAndBundle() {
      return activeRecord({ termsVersion: "old-version" });
    },
  }, userId);
  assert.equal(outdatedStatus.current, false);
  assert.deepEqual(await requireCurrentLegalConsent({ async findByUserAndBundle() { return null; } }, userId), {
    ok: false,
    error: "LEGAL_CONSENT_REQUIRED",
    consentUrl: "/legal-consent/",
  });

  let recorded = null;
  await recordCurrentLegalConsent({
    async recordCurrentAcceptance(params) {
      recorded = params;
    },
  }, userId, "login");
  assert.equal(recorded.userId, userId);
  assert.equal(recorded.minimumAge, 16);
  assert.equal(recorded.bundleVersion, LEGAL_POLICY.bundleVersion);
  assert.equal("acceptedAt" in recorded, false);

  let writeRepositoryCreated = 0;
  const unauthenticatedDependencies = {
    async authenticate() { return null; },
    createWriteRepository() { writeRepositoryCreated += 1; throw new Error("must not construct writer"); },
  };
  assert.equal((await responseJson(await handleLegalConsentGet(new Request("https://unit.test"), unauthenticatedDependencies))).status, 401);
  assert.equal((await responseJson(await handleLegalConsentPost(request(JSON.stringify({ accepted: true, source: "login" })), unauthenticatedDependencies))).status, 401);
  assert.equal(writeRepositoryCreated, 0, "authentication must precede privileged write construction");

  const readRepository = { async findByUserAndBundle() { return null; } };
  const dependencies = {
    async authenticate() { return { userId, readRepository }; },
    createWriteRepository() {
      writeRepositoryCreated += 1;
      return { async recordCurrentAcceptance(params) { recorded = params; } };
    },
    now: () => Date.parse("2026-07-12T00:02:00.000Z"),
  };
  const getResult = await responseJson(await handleLegalConsentGet(new Request("https://unit.test"), dependencies));
  assert.equal(getResult.status, 200);
  assert.deepEqual(getResult.body, { current: false, bundleVersion: LEGAL_POLICY.bundleVersion, minimumAge: 16, consentUrl: "/legal-consent/" });

  for (const [label, badRequest, expectedStatus] of [
    ["content type", request(JSON.stringify({ accepted: true, source: "login" }), { headers: { "content-type": "text/plain" } }), 415],
    ["oversized", request("x".repeat(1025)), 413],
    ["malformed", request("{"), 400],
    ["missing acceptance", request(JSON.stringify({ source: "login" })), 400],
    ["false acceptance", request(JSON.stringify({ accepted: false, source: "login" })), 400],
    ["invalid source", request(JSON.stringify({ accepted: true, source: "other" })), 400],
    ["client user", request(JSON.stringify({ accepted: true, source: "login", user_id: otherUserId })), 400],
    ["client versions", request(JSON.stringify({ accepted: true, source: "login", bundleVersion: "client" })), 400],
    ["client timestamp", request(JSON.stringify({ accepted: true, source: "login", acceptedAt: "2026-01-01" })), 400],
  ]) {
    const result = await responseJson(await handleLegalConsentPost(badRequest, dependencies));
    assert.equal(result.status, expectedStatus, label);
  }
  assert.equal(writeRepositoryCreated, 0, "invalid requests must not construct a writer");

  const postResult = await responseJson(await handleLegalConsentPost(request(JSON.stringify({ accepted: true, source: "login" })), dependencies));
  assert.equal(postResult.status, 200);
  assert.deepEqual(postResult.body, { current: true, bundleVersion: LEGAL_POLICY.bundleVersion, minimumAge: 16, consentUrl: "/legal-consent/" });
  assert.equal(recorded.source, "login");

  const rateLimitedDependencies = {
    ...dependencies,
    async authenticate() { return { userId, readRepository: { async findByUserAndBundle() { return activeRecord(); } } }; },
    now: () => Date.parse("2026-07-12T00:00:30.000Z"),
  };
  assert.equal((await responseJson(await handleLegalConsentPost(request(JSON.stringify({ accepted: true, source: "login" })), rateLimitedDependencies))).status, 429);

  assert.match(route, /getBearerToken\(request\)/);
  assert.match(route, /client\.auth\.getUser\(token\)/);
  assert.match(route, /createLegalConsentServiceClient\(env\)/);
  assert(route.indexOf("client.auth.getUser(token)") < route.indexOf("createLegalConsentServiceClient(env)"));
  assert.match(repository, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(route, /signIn|signUp|redirect|requireCurrentLegalConsent/);

  console.log("LEGAL_CONSENT_PERSISTENCE_OK offline mocks and static RLS/API checks passed");
}

main().catch((error) => {
  console.error("LEGAL_CONSENT_PERSISTENCE_FAIL", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
