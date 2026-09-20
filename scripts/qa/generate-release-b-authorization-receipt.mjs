import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  computeReleaseBExecutionSurfaceFingerprints,
  createReleaseBAuthorizationReceiptV2,
  hashAuthorizationReceipt,
  loadTask17FrozenGate,
  validateCurrentReleaseBAuthorizationReceiptV2,
} from "./release-b-production-import.mjs";

const APPROVAL_ID = "release-b-approval-2";
const AUTHORIZED_AT_UTC = "2026-09-20T08:35:56Z";
const EXPECTED_TARGET_PROJECT_REF = "xcbnxzjlsvtgzixurcof";
const EXPECTED_NORMALIZED_PAYLOAD_SHA256 = "c4b2bbaca63376402fcd4ca00af108a953a0b94d0975db2c579698e8a08aa333";
const EXPECTED_DRY_RUN_FINGERPRINT = "c1583080fdffa004861c70ab9c2987a19839b87b30846cbf9983994e6b64e5e7";
const EXPECTED_COUNTS = Object.freeze({
  before: Object.freeze({ devices: 0, deviceSpecDefinitions: 0, deviceSpecs: 0, deviceSources: 0, deviceSourceLinks: 0, deviceSpecEvidence: 0, catalogAuditEvents: 0 }),
  after: Object.freeze({ devices: 24, deviceSpecDefinitions: 92, deviceSpecs: 1488, deviceSources: 39, deviceSourceLinks: 46, deviceSpecEvidence: 15, catalogAuditEvents: 0 }),
  publishedDevices: 24,
});
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RECEIPT_DIRECTORY = path.join(REPOSITORY_ROOT, "artifacts", "device-schema-v1", "release-b-authorization-receipts");
const RECEIPT_PATH = path.join(RECEIPT_DIRECTORY, `${APPROVAL_ID}.json`);

function assertExactObject(actual, expected, label) {
  assert.deepEqual(actual, expected, `${label} must match the frozen Release B authorization contract`);
}

function assertRejectsCurrentReceipt(receipt, sha256, frozen, executionSurface, pattern, message) {
  assert.throws(() => validateCurrentReleaseBAuthorizationReceiptV2(receipt, sha256, frozen, executionSurface), pattern, message);
}

export async function buildReleaseBAuthorizationReceiptV2Packet() {
  const frozen = await loadTask17FrozenGate();
  assert.equal(frozen.targetProjectRef, EXPECTED_TARGET_PROJECT_REF, "target project ref must match the authorized Production target");
  assert.equal(frozen.normalizedPayloadSha256, EXPECTED_NORMALIZED_PAYLOAD_SHA256, "normalized payload hash must match the authorized payload");
  assert.equal(frozen.dryRunFingerprint, EXPECTED_DRY_RUN_FINGERPRINT, "dry-run fingerprint must match the authorized dry-run");
  assertExactObject(frozen.expectedBeforeCounts, EXPECTED_COUNTS.before, "before-counts");
  assertExactObject(frozen.expectedAfterCounts, EXPECTED_COUNTS.after, "after-counts");
  assert.equal(frozen.publishedDevices, EXPECTED_COUNTS.publishedDevices, "published device count must match the authorized target");

  const executionSurface = await computeReleaseBExecutionSurfaceFingerprints();
  const receipt = createReleaseBAuthorizationReceiptV2({ approvalId: APPROVAL_ID, authorizedAtUtc: AUTHORIZED_AT_UTC, frozen, executionSurface });
  const canonicalSha256 = hashAuthorizationReceipt(receipt);
  validateCurrentReleaseBAuthorizationReceiptV2(receipt, canonicalSha256, frozen, executionSurface);

  const semanticMutation = { ...receipt, maxAttempts: 2 };
  assert.notEqual(hashAuthorizationReceipt(receipt), hashAuthorizationReceipt(semanticMutation), "semantic mutations must change the canonical receipt hash");
  assertRejectsCurrentReceipt(semanticMutation, hashAuthorizationReceipt(semanticMutation), frozen, executionSurface, /INVALID_RELEASE_B_AUTHORIZATION_RECEIPT/, "semantic maxAttempts mutation must reject");

  const automaticRetryMutation = { ...receipt, automaticRetry: true };
  assertRejectsCurrentReceipt(automaticRetryMutation, hashAuthorizationReceipt(automaticRetryMutation), frozen, executionSurface, /INVALID_RELEASE_B_AUTHORIZATION_RECEIPT/, "automatic retry mutation must reject");

  const unknownFieldMutation = { ...receipt, unexpectedField: true };
  assertRejectsCurrentReceipt(unknownFieldMutation, hashAuthorizationReceipt(unknownFieldMutation), frozen, executionSurface, /INVALID_RELEASE_B_AUTHORIZATION_RECEIPT/, "unknown receipt fields must reject");

  const formattedClone = JSON.parse(JSON.stringify(receipt, null, 2));
  assert.equal(hashAuthorizationReceipt(formattedClone), canonicalSha256, "formatting-only receipt changes must preserve the canonical semantic hash");

  return Object.freeze({ frozen, executionSurface, receipt, canonicalSha256 });
}

export async function writeReleaseBAuthorizationReceiptV2() {
  const packet = await buildReleaseBAuthorizationReceiptV2Packet();
  await mkdir(RECEIPT_DIRECTORY, { recursive: true });
  const bytes = `${JSON.stringify(packet.receipt, null, 2)}\n`;
  await writeFile(RECEIPT_PATH, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const rawSha256 = hashAuthorizationReceipt(JSON.parse(await readFile(RECEIPT_PATH, "utf8")));
  assert.equal(rawSha256, packet.canonicalSha256, "written receipt must preserve the canonical authorization hash");
  return Object.freeze({ ...packet, receiptPath: RECEIPT_PATH, rawSha256 });
}

async function main() {
  const packet = await writeReleaseBAuthorizationReceiptV2();
  console.log(JSON.stringify({
    RELEASE_B_AUTHORIZATION_RECEIPT_V2: "PASS",
    APPROVAL_ID,
    AUTHORIZED_AT_UTC,
    AUTHORIZATION_RECEIPT_PATH: path.relative(REPOSITORY_ROOT, packet.receiptPath).replaceAll(path.sep, "/"),
    AUTHORIZATION_RECEIPT_SHA256: packet.canonicalSha256,
    RAW_RECEIPT_CANONICAL_SHA256: packet.rawSha256,
    TASK18_TRANSPORT_COMMIT: packet.executionSurface.task18TransportCommit,
    TASK18_EXECUTOR_COMMIT: packet.executionSurface.task18ExecutorCommit,
    PRODUCTION_TRANSPORT_FINGERPRINT: packet.executionSurface.productionTransportFingerprint,
    PRODUCTION_EXECUTOR_FINGERPRINT: packet.executionSurface.productionExecutorFingerprint,
    DELETE_OPERATIONS: 0,
    AUTOMATIC_RETRY: false,
    MAX_ATTEMPTS: 1,
    PRODUCTION_CONNECTIONS: 0,
    PRODUCTION_WRITES: 0,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`RELEASE_B_AUTHORIZATION_RECEIPT_V2_BLOCKED ${error.message}`);
    process.exitCode = 1;
  });
}
