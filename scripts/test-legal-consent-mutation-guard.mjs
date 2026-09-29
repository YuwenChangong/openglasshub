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
  assert.deepEqual(result, { ok: true, userId: "test-user" }, name);
  assert.deepEqual(calls, [], `${name} never consults historical consent`);
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
assert.deepEqual(actorCalls, [], "request data cannot select the authenticated actor or cause a consent read");

result = await requireAuthenticatedLegalConsent({ identity: { userId: "test-user" }, repository: { findByUserAndBundle: async () => { throw new Error("offline") } } });
assert.deepEqual(result, { ok: true, userId: "test-user" });

console.log("AUTHENTICATED_MUTATION_IDENTITY_GUARD_OK offline cases=13");
