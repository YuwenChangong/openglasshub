import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { LEGAL_POLICY } from "../src/lib/legal-policy.ts";
import { handleLegalConsentGet } from "../src/lib/server/legal-consent-api.server.ts";

const root = process.cwd();
const actorId = "00000000-0000-0000-0000-000000000101";
const otherUserId = "00000000-0000-0000-0000-000000000102";

function activeRecord(overrides = {}) {
  return {
    userId: actorId,
    bundleVersion: LEGAL_POLICY.bundleVersion,
    termsVersion: LEGAL_POLICY.termsVersion,
    privacyVersion: LEGAL_POLICY.privacyVersion,
    guidelinesVersion: LEGAL_POLICY.guidelinesVersion,
    minimumAge: LEGAL_POLICY.minimumAge,
    lastConfirmedAt: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

function dependenciesFor(record, events, options = {}) {
  return {
    async authenticate(request) {
      events.push(`authenticate:${request.headers.get("authorization") ?? "missing"}`);
      if (options.unauthenticated) return null;
      return {
        userId: actorId,
        readRepository: {
          async findByUserAndBundle(userId, bundleVersion) {
            events.push(`read:${userId}:${bundleVersion}`);
            assert.equal(userId, actorId, "GET must query only the verified actor");
            assert.equal(bundleVersion, LEGAL_POLICY.bundleVersion, "GET must select the server-current bundle");
            if (options.readFailure) throw new Error("database details must not escape");
            return record;
          },
        },
      };
    },
    createWriteRepository() {
      events.push("writer-created");
      throw new Error("GET must never construct the service-role writer");
    },
  };
}

async function main() {
  const route = await readFile(path.join(root, "src/pages/api/legal/consent.ts"), "utf8");
  const api = await readFile(path.join(root, "src/lib/server/legal-consent-api.server.ts"), "utf8");
  const repository = await readFile(path.join(root, "src/lib/server/legal-consent-repository.server.ts"), "utf8");
  const migration = await readFile(path.join(root, "supabase/migrations/20260712_legal_policy_acceptances.sql"), "utf8");

  assert.match(route, /getBearerToken\(request\)/);
  assert.match(route, /client\.auth\.getUser\(token\)/);
  assert.match(route, /createWriteRepository:\s*\(\)\s*=>\s*createLegalConsentWriteRepository\(createLegalConsentServiceClient\(env\)\)/);
  assert.match(api, /handleLegalConsentGet[\s\S]*?dependencies\.authenticate\(request\)[\s\S]*?getCurrentConsentStatus/);
  assert.doesNotMatch(api.match(/export async function handleLegalConsentGet[\s\S]*?\n}\n/)?.[0] ?? "", /createWriteRepository|recordCurrentLegalConsent|\.rpc\(/);
  assert.match(repository, /\.eq\("user_id", userId\)[\s\S]*?\.eq\("bundle_version", bundleVersion\)/);
  assert.match(migration, /legal_policy_acceptances_select_own[\s\S]*?using \(user_id = auth\.uid\(\)\)/i);
  assert.match(migration, /revoke all on table public\.legal_policy_acceptances from anon, authenticated/i);
  assert.doesNotMatch(api, /analytics|marketing/i);

  for (const [name, record, expectedCurrent] of [
    ["current", activeRecord(), true],
    ["missing", null, false],
    ["outdated-required-version", activeRecord({ privacyVersion: "old-privacy" }), false],
    ["required-current-with-optional-choices-false", { ...activeRecord(), analyticsConsent: false, marketingConsent: false }, true],
  ]) {
    const events = [];
    const response = await json(await handleLegalConsentGet(new Request(`https://unit.test/api/legal/consent?user_id=${otherUserId}`, { headers: { authorization: "Bearer verified-token" } }), dependenciesFor(record, events)));
    assert.equal(response.status, 200, name);
    assert.deepEqual(response.body, { current: expectedCurrent, bundleVersion: LEGAL_POLICY.bundleVersion, minimumAge: LEGAL_POLICY.minimumAge, consentUrl: "/legal-consent/" }, name);
    assert.deepEqual(events, [`authenticate:Bearer verified-token`, `read:${actorId}:${LEGAL_POLICY.bundleVersion}`], name);
    assert.equal("userId" in response.body, false, name);
    assert.equal("lastConfirmedAt" in response.body, false, name);
    assert.equal("analyticsConsent" in response.body, false, name);
    assert.equal("marketingConsent" in response.body, false, name);
  }

  for (const authorization of [null, "Basic invalid", "Bearer invalid-token"]) {
    const events = [];
    const headers = authorization ? { authorization } : {};
    const result = await json(await handleLegalConsentGet(new Request("https://unit.test/api/legal/consent", { headers }), dependenciesFor(null, events, { unauthenticated: true })));
    assert.deepEqual(result, { status: 401, body: { error: "UNAUTHORIZED" } });
    assert.deepEqual(events, [`authenticate:${authorization ?? "missing"}`]);
  }

  const failingEvents = [];
  const failure = await json(await handleLegalConsentGet(new Request("https://unit.test/api/legal/consent", { headers: { authorization: "Bearer verified-token" } }), dependenciesFor(null, failingEvents, { readFailure: true })));
  assert.deepEqual(failure, { status: 500, body: { error: "LEGAL_CONSENT_UNAVAILABLE" } });
  assert.deepEqual(failingEvents, [`authenticate:Bearer verified-token`, `read:${actorId}:${LEGAL_POLICY.bundleVersion}`]);
  assert.equal(failingEvents.includes("writer-created"), false);

  console.log(JSON.stringify({ current: true, missing: false, outdated: false, optionalChoicesAffectRequiredConsent: false, anonymousDenied: true, crossUserOverrideIgnored: true, writes: 0, serviceRoleWriterConstructed: false, realNetworkDatabaseStorageRequests: 0 }));
}

main().catch((error) => {
  console.error("LEGAL_CONSENT_API_GET_FAIL", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
