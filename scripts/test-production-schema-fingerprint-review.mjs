import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  reviewFingerprintCandidate,
  writeReviewedFingerprintFixture,
} from "./production-schema-fingerprint-review.mjs";
import { generateLocalFingerprint } from "./generate-local-production-schema-fingerprint.mjs";

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
