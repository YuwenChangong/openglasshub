import assert from "node:assert/strict";
import { requireAuthenticatedLegalConsent } from "../src/lib/server/legal-consent-mutation.server.ts";
import { getActiveLegalBundle } from "../src/lib/server/legal-consent.server.ts";
const bundle = getActiveLegalBundle();
const currentRecord = (overrides = {}) => ({ userId: "test-user", ...bundle, lastConfirmedAt: "2026-01-01T00:00:00Z", ...overrides });
const repository = (record, calls = []) => ({ findByUserAndBundle: async (userId, bundleVersion) => { calls.push({ userId, bundleVersion }); return record; } });

let result = await requireAuthenticatedLegalConsent(null);
assert.equal(result.ok, false); assert.equal(result.response.status, 401);

for (const [name, record] of [
  ["missing", null],
  ["stale-terms", currentRecord({ termsVersion: "stale" })],
  ["stale-guidelines", currentRecord({ guidelinesVersion: "stale" })],
  ["stale-privacy", currentRecord({ privacyVersion: "stale" })],
  ["wrong-bundle", currentRecord({ bundleVersion: "wrong" })],
  ["malformed", { userId: "test-user", bundleVersion: bundle.bundleVersion }],
]) {
  const calls = [];
  result = await requireAuthenticatedLegalConsent({ identity: { userId: "test-user" }, repository: repository(record, calls) });
  assert.equal(result.ok, false, name);
  assert.equal(result.response.status, 403, name);
  assert.deepEqual(await result.response.json(), { error: "LEGAL_CONSENT_REQUIRED", consentUrl: "/legal-consent/" }, name);
  assert.deepEqual(calls, [{ userId: "test-user", bundleVersion: bundle.bundleVersion }], `${name} uses only the verified actor and server bundle`);
}

for (const [name, record] of [
  ["optional-analytics-false", { ...currentRecord(), analytics: false }],
  ["optional-marketing-false", { ...currentRecord(), marketing: false }],
  ["optional-values-absent", currentRecord()],
]) {
  result = await requireAuthenticatedLegalConsent({ identity: { userId: "test-user" }, repository: repository(record) });
  assert.equal(result.ok, true, name);
}

const actorCalls = [];
result = await requireAuthenticatedLegalConsent({ identity: { userId: "verified-user" }, repository: repository({ ...currentRecord(), userId: "verified-user" }, actorCalls) });
assert.equal(result.ok, true);
assert.deepEqual(actorCalls, [{ userId: "verified-user", bundleVersion: bundle.bundleVersion }], "request data cannot select the consent actor");

result = await requireAuthenticatedLegalConsent({ identity: { userId: "test-user" }, repository: { findByUserAndBundle: async () => { throw new Error("offline") } } });
assert.equal(result.ok, false); assert.equal(result.response.status, 503);
assert.deepEqual(await result.response.json(), { error: "LEGAL_CONSENT_UNAVAILABLE" });

console.log("LEGAL_CONSENT_MUTATION_GUARD_OK offline cases=13");
