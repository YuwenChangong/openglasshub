import assert from "node:assert/strict";
import { test } from "node:test";
import { requireAuthenticatedLegalConsent } from "../src/lib/server/legal-consent-mutation.server.ts";

for (const [name, context] of [["absent context", null], ["absent identity", {}], ["absent actor", { identity: {} }], ["empty actor", { identity: { userId: "" } }]]) {
  test(`anonymous identity rejected: ${name}`, async () => {
    const result = await requireAuthenticatedLegalConsent(context);
    assert.equal(result.ok, false);
    assert.equal(result.response.status, 401);
    assert.deepEqual(await result.response.json(), { error: "UNAUTHORIZED" });
    assert.equal(result.response.headers.get("cache-control"), "no-store");
  });
}
for (const state of ["missing", "outdated", "malformed", "unavailable"]) {
  test(`authenticated actor proceeds without consent: ${state}`, async () => {
    let reads = 0;
    const result = await requireAuthenticatedLegalConsent({
      identity: { userId: "verified-actor" },
      repository: { findByUserAndBundle: async () => {
        reads += 1;
        if (state === "unavailable") throw new Error("offline storage unavailable");
        return state === "missing" ? null : { userId: "other-actor", bundleVersion: "stale" };
      } },
    });
    assert.deepEqual(result, { ok: true, userId: "verified-actor" });
    assert.equal(reads, 0, "legacy repository must not be queried");
  });
}
test("deprecated repository need not exist or be inspected", async () => {
  const context = { identity: { userId: "verified-actor" } };
  Object.defineProperty(context, "repository", { get() { throw new Error("repository accessed"); } });
  assert.deepEqual(await requireAuthenticatedLegalConsent(context), { ok: true, userId: "verified-actor" });
});
