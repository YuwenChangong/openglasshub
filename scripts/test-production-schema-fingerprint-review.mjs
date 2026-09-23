import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertFingerprintReviewMatches,
  reviewFingerprintCandidate,
  writeReviewedFingerprintFixture,
} from "./production-schema-fingerprint-review.mjs";
import { generateLocalFingerprint } from "./generate-local-production-schema-fingerprint.mjs";
import { buildFingerprint } from "./production-schema-fingerprint-core.mjs";

function fingerprint({ migrations, objects = [] }) {
  return {
    format: "openglass-production-schema-fingerprint-v1",
    generatedFrom: "LOCAL_DOCKER_ONLY",
    canonicalMigrationCount: migrations.length,
    legalConsentPrerequisiteCount: 12,
    localMigrationLedger: migrations.map((name, index) => ({ version: `2026090${index + 1}000001`, name, statementCount: 1 })),
    objectCount: objects.length,
    objects,
  };
}

test("structured review identifies a stale 43-entry fixture before a 48-entry candidate can replace it", () => {
  const expected = fingerprint({ migrations: Array.from({ length: 43 }, (_, index) => `migration_${index + 1}`) });
  const candidate = fingerprint({ migrations: Array.from({ length: 48 }, (_, index) => `migration_${index + 1}`) });
  const review = reviewFingerprintCandidate({ expected, candidate });
  assert.equal(review.classification, "STALE_CANONICAL_MANIFEST");
  assert.deepEqual(review.migrationLedger, {
    expectedCount: 43,
    candidateCount: 48,
    missingFromCandidate: [],
    addedByCandidate: [
      { version: "202609044000001", name: "migration_44" },
      { version: "202609045000001", name: "migration_45" },
      { version: "202609046000001", name: "migration_46" },
      { version: "202609047000001", name: "migration_47" },
      { version: "202609048000001", name: "migration_48" },
    ],
    orderMatchesForSharedEntries: true,
  });
  assert.equal(review.fixtureMatchesCandidate, false);
  assert.match(review.reviewId, /^[a-f0-9]{64}$/);
});

test("fixture update requires an explicit matching reviewed candidate confirmation", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "openglass-fingerprint-review-"));
  try {
    const fixturePath = path.join(temporaryRoot, "fixture.json");
    const candidatePath = path.join(temporaryRoot, "candidate.json");
    const reviewPath = path.join(temporaryRoot, "review.json");
    const expected = fingerprint({ migrations: Array.from({ length: 43 }, (_, index) => `migration_${index + 1}`) });
    const candidate = fingerprint({ migrations: Array.from({ length: 48 }, (_, index) => `migration_${index + 1}`) });
    await writeFile(fixturePath, `${JSON.stringify(expected)}\n`);
    await writeFile(candidatePath, `${JSON.stringify(candidate)}\n`);
    const review = reviewFingerprintCandidate({ expected, candidate });
    await writeFile(reviewPath, `${JSON.stringify(review)}\n`);

    await assert.rejects(
      () => writeReviewedFingerprintFixture({ fixturePath, candidatePath, reviewPath, confirmation: "wrong-review-id" }),
      /explicit review confirmation/,
    );
    assert.deepEqual(JSON.parse(await readFile(fixturePath, "utf8")), expected);

    await writeReviewedFingerprintFixture({ fixturePath, candidatePath, reviewPath, confirmation: review.reviewId });
    assert.deepEqual(JSON.parse(await readFile(fixturePath, "utf8")), candidate);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("candidate generator refuses to write the committed fixture directly", async () => {
  await assert.rejects(
    () => generateLocalFingerprint({ root: process.cwd(), outputPath: path.join(process.cwd(), "tests", "fixtures", "production-schema-expected-fingerprint.json"), environment: {} }),
    /reviewed update path/,
  );
});

test("review accepts a strict Release A delta without absorbing it into the historical baseline", () => {
  const sharedObject = { objectType: "table", schema: "public", name: "devices", identity: "public.devices", attribute: "rls_state", deterministicSha256: "same" };
  const releaseAObject = { objectType: "table", schema: "public", name: "device_attributes", identity: "public.device_attributes", attribute: "rls_state", deterministicSha256: "new" };
  const expected = fingerprint({ migrations: Array.from({ length: 49 }, (_, index) => `migration_${index + 1}`), objects: [sharedObject] });
  const candidate = fingerprint({ migrations: [...Array.from({ length: 49 }, (_, index) => `migration_${index + 1}`), "device_schema_v1_foundation"], objects: [sharedObject, releaseAObject] });
  const review = reviewFingerprintCandidate({ expected, candidate });

  assert.equal(review.classification, "RELEASE_A_DELTA_ACCEPTED");
  assert.equal(review.fixtureMatchesCandidate, false);
  assert.equal(review.releaseDeltaMatchesCandidate, true);
  assert.equal(review.objectIdentity.missingFromCandidate.length, 0);
  assert.equal(review.objectIdentity.divergentDefinitions.length, 0);
  assert.equal(review.objectIdentity.addedByCandidate.length, 1);
  assert.doesNotThrow(() => assertFingerprintReviewMatches(review));
});

test("review accepts only the exact Release A device policy replacements", () => {
  const row = (name, operation, hash = name) => ({ objectType: "policy", schema: "public", name: "devices", identity: `public.devices.${name}`, attribute: operation, deterministicSha256: hash });
  const shared = { objectType: "table", schema: "public", name: "devices", identity: "public.devices", attribute: "rls_state", deterministicSha256: "same" };
  const historicalPolicies = [row("devices_insert_staff", "INSERT"), row("devices_update_staff", "UPDATE"), row("devices_delete_staff", "DELETE")];
  const catalogPolicies = [row("devices_insert_catalog_admin", "INSERT"), row("devices_update_catalog_admin", "UPDATE"), row("devices_delete_catalog_admin", "DELETE")];
  const expected = fingerprint({ migrations: Array.from({ length: 49 }, (_, index) => `migration_${index + 1}`), objects: [shared, ...historicalPolicies] });
  const candidate = fingerprint({ migrations: [...Array.from({ length: 49 }, (_, index) => `migration_${index + 1}`), "device_schema_v1_foundation"], objects: [shared, ...catalogPolicies] });
  const accepted = reviewFingerprintCandidate({ expected, candidate });
  assert.equal(accepted.releaseDeltaMatchesCandidate, true);
  assert.equal(accepted.classification, "RELEASE_A_DELTA_ACCEPTED");
  assert.doesNotThrow(() => assertFingerprintReviewMatches(accepted));

  const unrelatedRemoval = reviewFingerprintCandidate({ expected: fingerprint({ migrations: expected.localMigrationLedger.map(({ name }) => name), objects: [shared, ...historicalPolicies, row("devices_select_published_public", "SELECT")] }), candidate });
  assert.equal(unrelatedRemoval.releaseDeltaMatchesCandidate, false, "an unrelated missing policy remains a fingerprint blocker");
  assert.throws(() => assertFingerprintReviewMatches(unrelatedRemoval), /fixture review required/i);
});

test("generated fingerprint scope follows the applied local migration ledger", () => {
  const rows = [
    { section: "migration_ledger", object_type: "migration", schema_name: "supabase_migrations", object_name: "one", identity: "20260901000001", attribute: "statement_count", value: "1", definition_hash: "" },
    { section: "migration_ledger", object_type: "migration", schema_name: "supabase_migrations", object_name: "two", identity: "20260902000001", attribute: "statement_count", value: "1", definition_hash: "" },
  ];
  const fingerprint = buildFingerprint(rows, new Map());
  assert.equal(fingerprint.localMigrationLedger.length, 2);
  assert.equal(fingerprint.canonicalMigrationCount, 2);
});

test("committed fingerprint fixture provenance is limited to its own migration ledger", async () => {
  const fixture = JSON.parse(await readFile(path.join(process.cwd(), "tests", "fixtures", "production-schema-expected-fingerprint.json"), "utf8"));
  const ledgerNames = new Set(fixture.localMigrationLedger.map(({ name }) => `${name}.sql`));
  const outside = fixture.objects.filter((entry) => [
    ...entry.sourceMigrations,
    entry.firstIntroducedMigration,
    ...entry.laterModifyingMigrations,
  ].filter(Boolean).some((migration) => !ledgerNames.has(migration.replace(/^\d+_/, ""))));
  assert.deepEqual(outside.map(({ identity, attribute }) => `${identity}/${attribute}`).slice(0, 5), []);
});
