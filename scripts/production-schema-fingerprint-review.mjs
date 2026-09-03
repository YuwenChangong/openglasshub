import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ORDERED_MIGRATION_FILENAMES } from "./build-local-supabase-replay-mirror.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function ledgerEntries(fingerprint) {
  return fingerprint.localMigrationLedger.map(({ version, name }) => ({ version, name }));
}

function ledgerIdentity(entry) {
  return `${entry.version}:${entry.name}`;
}

function objectKey(entry) {
  return [entry.objectType, entry.schema, entry.name, entry.identity, entry.attribute].join("|");
}

function objectIndex(fingerprint) {
  return new Map(fingerprint.objects.map((entry) => [objectKey(entry), entry.deterministicSha256]));
}

function stableReviewId(review) {
  return sha256(JSON.stringify(review));
}

export function reviewFingerprintCandidate({ expected, candidate }) {
  const expectedLedger = ledgerEntries(expected);
  const candidateLedger = ledgerEntries(candidate);
  const expectedLedgerIds = expectedLedger.map(ledgerIdentity);
  const candidateLedgerIds = candidateLedger.map(ledgerIdentity);
  const expectedObjects = objectIndex(expected);
  const candidateObjects = objectIndex(candidate);
  const review = {
    format: "openglass-production-schema-fingerprint-review-v1",
    classification: expectedLedgerIds.every((identity, index) => candidateLedgerIds[index] === identity)
      && candidateLedger.length > expectedLedger.length
      ? "STALE_CANONICAL_MANIFEST"
      : "FINGERPRINT_DELTA_REQUIRES_REVIEW",
    expected: {
      canonicalMigrationCount: expected.canonicalMigrationCount,
      localMigrationLedgerCount: expectedLedger.length,
      objectCount: expected.objectCount,
    },
    candidate: {
      generatedFrom: candidate.generatedFrom,
      canonicalMigrationCount: candidate.canonicalMigrationCount,
      localMigrationLedgerCount: candidateLedger.length,
      objectCount: candidate.objectCount,
    },
    migrationLedger: {
      expectedCount: expectedLedger.length,
      candidateCount: candidateLedger.length,
      missingFromCandidate: expectedLedger.filter((entry) => !candidateLedgerIds.includes(ledgerIdentity(entry))),
      addedByCandidate: candidateLedger.filter((entry) => !expectedLedgerIds.includes(ledgerIdentity(entry))),
      orderMatchesForSharedEntries: expectedLedgerIds.filter((identity) => candidateLedgerIds.includes(identity)).every((identity, index) => candidateLedgerIds.filter((candidateIdentity) => expectedLedgerIds.includes(candidateIdentity))[index] === identity),
    },
    objectIdentity: {
      missingFromCandidate: [...expectedObjects.keys()].filter((key) => !candidateObjects.has(key)),
      addedByCandidate: [...candidateObjects.keys()].filter((key) => !expectedObjects.has(key)),
      divergentDefinitions: [...expectedObjects.keys()].filter((key) => candidateObjects.has(key) && candidateObjects.get(key) !== expectedObjects.get(key)),
    },
  };
  review.fixtureMatchesCandidate = review.migrationLedger.missingFromCandidate.length === 0
    && review.migrationLedger.addedByCandidate.length === 0
    && review.migrationLedger.orderMatchesForSharedEntries
    && review.objectIdentity.missingFromCandidate.length === 0
    && review.objectIdentity.addedByCandidate.length === 0
    && review.objectIdentity.divergentDefinitions.length === 0;
  return { ...review, reviewId: stableReviewId(review) };
}

export function assertFingerprintReviewMatches(review) {
  if (!review.fixtureMatchesCandidate) {
    throw new Error(`Fingerprint fixture review required: migration ledger ${review.migrationLedger.expectedCount} -> ${review.migrationLedger.candidateCount}; review id ${review.reviewId}`);
  }
  return true;
}

export async function writeReviewedFingerprintFixture({ fixturePath, candidatePath, reviewPath, confirmation }) {
  const [expected, candidate, recordedReview] = await Promise.all([
    readFile(fixturePath, "utf8").then(JSON.parse),
    readFile(candidatePath, "utf8").then(JSON.parse),
    readFile(reviewPath, "utf8").then(JSON.parse),
  ]);
  const review = reviewFingerprintCandidate({ expected, candidate });
  if (candidate.format !== "openglass-production-schema-fingerprint-v1"
    || candidate.generatedFrom !== "LOCAL_DOCKER_ONLY"
    || candidate.canonicalMigrationCount !== ORDERED_MIGRATION_FILENAMES.length
    || candidate.localMigrationLedger.length !== ORDERED_MIGRATION_FILENAMES.length) {
    throw new Error("Reviewed fixture update requires a complete local disposable fingerprint candidate");
  }
  if (recordedReview.reviewId !== review.reviewId || JSON.stringify(recordedReview) !== JSON.stringify(review)) {
    throw new Error("Reviewed fixture update refuses a stale or modified review record");
  }
  if (!confirmation || confirmation !== review.reviewId) throw new Error("Reviewed fixture update requires an explicit review confirmation");
  await writeFile(fixturePath, `${JSON.stringify(candidate, null, 2)}\n`);
  return review;
}

function requiredArgument(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || !argv[index + 1]) throw new Error(`Missing ${name}`);
  return argv[index + 1];
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.includes("--update-fixture")) throw new Error("Only the explicit --update-fixture path may write the fingerprint fixture");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const review = await writeReviewedFingerprintFixture({
    fixturePath: path.join(root, "tests", "fixtures", "production-schema-expected-fingerprint.json"),
    candidatePath: path.resolve(requiredArgument(argv, "--candidate")),
    reviewPath: path.resolve(requiredArgument(argv, "--review")),
    confirmation: requiredArgument(argv, "--confirm-review-id"),
  });
  console.log(JSON.stringify({ updated: true, reviewId: review.reviewId, canonicalMigrationCount: review.candidate.canonicalMigrationCount }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
