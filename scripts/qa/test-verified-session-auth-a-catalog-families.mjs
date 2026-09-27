import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOG_FAMILIES } from "../lib/verified-session-catalog-contract.mjs";
import { catalogDigest, catalogFamilyDigest, catalogMismatchFamilies,
  classifyVerifiedSessionDbStage } from "../lib/verified-session-db-stage.mjs";
import { REVIEWED_LOCAL_STAGE_DIGESTS } from "../lib/verified-session-stage-digests.mjs";

const baseline = Object.fromEntries(CATALOG_FAMILIES.map((family) => [family, []]));
const expected = Object.fromEntries(CATALOG_FAMILIES.map((family) =>
  [family, catalogFamilyDigest(family, baseline[family])]));

test("family diagnostics are domain-separated and exact baseline has no mismatch", () => {
  assert.equal(catalogMismatchFamilies(baseline, expected), "none");
  assert.notEqual(expected.schemas, expected.objects);
  assert.match(catalogDigest(baseline), /^[a-f0-9]{64}$/);
});

for (const family of CATALOG_FAMILIES) {
  test(`${family} mutation reports only its allowlisted family`, () => {
    const changed = structuredClone(baseline);
    changed[family].push({ diagnosticProbe: true });
    assert.equal(catalogMismatchFamilies(changed, expected), family);
    assert.equal(classifyVerifiedSessionDbStage(changed, REVIEWED_LOCAL_STAGE_DIGESTS), "UNKNOWN");
  });
}

test("two mutations report exactly both family names in canonical order", () => {
  const changed = structuredClone(baseline);
  changed.schemas.push({ diagnosticProbe: true });
  changed.publication.push({ diagnosticProbe: true });
  assert.equal(catalogMismatchFamilies(changed, expected), "schemas,publication");
});

test("invalid snapshots and baselines cannot claim a family-level diagnosis", () => {
  const missing = structuredClone(baseline);
  delete missing.schemas;
  assert.equal(catalogMismatchFamilies(missing, expected), "UNKNOWN");
  const duplicate = structuredClone(baseline);
  duplicate.schemas.push({ diagnosticProbe: true }, { diagnosticProbe: true });
  assert.equal(catalogMismatchFamilies(duplicate, expected), "UNKNOWN");
  assert.equal(catalogMismatchFamilies(baseline, { ...expected, schemas: "bad" }), "UNKNOWN");
  assert.equal(catalogMismatchFamilies(baseline, { ...expected, extra: expected.schemas }), "UNKNOWN");
  assert.equal(catalogFamilyDigest("not-a-family", []), null);
});

test("whole-stage reviewed digest constants remain pinned", () => {
  assert.deepEqual(REVIEWED_LOCAL_STAGE_DIGESTS, {
    PRE_V1: "56b5ad002613e69bfd88e88ac28c97445c187ff90bc413a7a83ad1e0678c81f9",
    FOUNDATION: "e1ada2f02b029458b5f6090a50b09bb44a53c7fcb26114ba8cb87e34754d3f1a",
    ENFORCEMENT: "38e8d6a30402035dcad6966d03acd602ac08c3df70162363ddb5e6e526380797",
  });
});
