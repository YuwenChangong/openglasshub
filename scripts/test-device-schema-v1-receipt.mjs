import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";

let writeSchemaV1Receipt;
try {
  ({ writeSchemaV1Receipt } = await import("./qa/device-schema-v1-receipt.mjs"));
} catch (error) {
  const blocker = new Error("DEVICE_SCHEMA_V1_RECEIPT_WRITER_MISSING: writeSchemaV1Receipt is not implemented");
  blocker.cause = error;
  throw blocker;
}

const artifactPath = "artifacts/device-schema-v1/local-recovery-receipt.json";
const SHA = "14f3451544b5a5fbf07dc9691e7278bc30c674e6676c6c767fc6792baa6250cc";
const exactCounts = Object.freeze({
  definitions: 92,
  devices: 24,
  sources: 39,
  sourceLinks: 46,
  specs: 1488,
  evidence: 15,
  compatibility: 24,
  publishedDevices: 24,
  uniqueSlugs: 24,
  yamlSourceUrls: 36,
  evidenceOnlyUrls: 3,
  trueValueConflicts: 7,
  unresolvedEvidenceMaps: 0,
});

function validInput(overrides = {}) {
  return {
    migrationFingerprint: SHA,
    modelFingerprint: SHA,
    planFingerprint: SHA,
    localReceipt: {
      format: "openglass-device-schema-v1-local-recovery-receipt-v1",
      targetHost: "localhost",
      planFingerprint: SHA,
      delete: "NONE",
      operations: {
        definition: 92, device: 24, source: 39, sourceLink: 46,
        spec: 1488, evidence: 15, compatibility: 24,
      },
    },
    counts: exactCounts,
    production: { writes: 0, writeOccurredAt: null, authorizationEvidence: null },
    ...overrides,
  };
}

try {
  const first = await writeSchemaV1Receipt(validInput());
  const second = await writeSchemaV1Receipt(validInput({ counts: { ...exactCounts } }));
  assert.equal(first.path, artifactPath, "the receipt is kept under the ignored Schema v1 artifact directory");
  assert.equal(first.sha256, second.sha256, "equivalent inputs produce a stable receipt fingerprint");
  assert.match(first.sha256, /^[a-f0-9]{64}$/, "the canonical receipt has a SHA-256 fingerprint");
  const text = await readFile(first.path, "utf8");
  const receipt = JSON.parse(text);
  assert.deepEqual(receipt.counts, exactCounts, "the receipt records the exact approved local recovery counts");
  assert.equal(receipt.plan.delete, "NONE", "the receipt preserves the no-delete recovery invariant");
  assert.equal(receipt.plan.blocked, 0, "the receipt preserves the unblocked local dry run evidence");
  assert.equal(receipt.plan.conflicts, 0, "the receipt preserves the conflict-free local dry run evidence");
  assert.equal(receipt.sideEffects.productionDbConnections, 0, "receipt writing records no production database connection");
  assert.equal(receipt.sideEffects.providerWrites, 0, "receipt writing records no provider write");

  await assert.rejects(
    () => writeSchemaV1Receipt(validInput({ migrationFingerprint: "postgresql://user:password@db.example.test/postgres" })),
    /SECRET_OR_DSN_REJECTED/,
    "credential-shaped values are rejected instead of being emitted into recovery evidence",
  );
  await assert.rejects(
    () => writeSchemaV1Receipt(validInput({ counts: { ...exactCounts, devices: 23 } })),
    /EXACT_COUNT_MISMATCH: devices/,
    "a receipt cannot claim a partial local recovery",
  );
  await assert.rejects(
    () => writeSchemaV1Receipt(validInput({ production: { writes: 1, writeOccurredAt: "2026-09-12T23:00:00.000Z", authorizationEvidence: null } })),
    /PRODUCTION_WRITE_AUTHORIZATION_REQUIRED/,
    "a production-write receipt needs separate prior authorization evidence",
  );
  await assert.rejects(
    () => writeSchemaV1Receipt(validInput({ production: { writes: 1, writeOccurredAt: "2026-09-12T23:00:00.000Z", authorizationEvidence: { authorizedAt: "2026-09-13T00:00:00.000Z", authorizationId: "release-b-approval-001" } } })),
    /PRODUCTION_WRITE_AUTHORIZATION_REQUIRED/,
    "post-hoc authorization cannot legitimize a production-write receipt",
  );
  const authorized = await writeSchemaV1Receipt(validInput({ production: { writes: 1, writeOccurredAt: "2026-09-12T23:00:00.000Z", authorizationEvidence: { authorizedAt: "2026-09-12T22:00:00.000Z", authorizationId: "release-b-approval-001" } } }));
  assert.match(authorized.sha256, /^[a-f0-9]{64}$/, "prior explicit authorization permits a production-write receipt");
  const changedWriteTime = await writeSchemaV1Receipt(validInput({ production: { writes: 1, writeOccurredAt: "2026-09-12T23:01:00.000Z", authorizationEvidence: { authorizedAt: "2026-09-12T22:00:00.000Z", authorizationId: "release-b-approval-001" } } }));
  const productionReceipt = JSON.parse(await readFile(changedWriteTime.path, "utf8"));
  assert.equal(productionReceipt.production.writeOccurredAt, "2026-09-12T23:01:00.000Z", "canonical production evidence retains the write timestamp");
  assert.notEqual(authorized.sha256, changedWriteTime.sha256, "different production write times produce distinct receipt fingerprints");
  await assert.rejects(
    () => writeSchemaV1Receipt(validInput({ localReceipt: { ...validInput().localReceipt, extra: { note: "C:/restricted/production-password.txt" } } })),
    /SECRET_OR_DSN_REJECTED/,
    "nested credential-bearing filesystem paths are rejected without being written",
  );
  await assert.rejects(
    () => writeSchemaV1Receipt(validInput({ counts: { ...exactCounts, extra: { note: "https://user:password@example.test/receipt" } } })),
    /SECRET_OR_DSN_REJECTED/,
    "credential-bearing HTTPS URLs cannot be smuggled through extra objects",
  );
} finally {
  await rm("artifacts/device-schema-v1", { recursive: true, force: true });
}

console.log("DEVICE_SCHEMA_V1_RECEIPT_OK cases=8 counts=13");
