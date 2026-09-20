import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import {
  AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1,
  AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2,
  PRODUCTION_LEDGER_DIRECTORY,
  computeReleaseBExecutionSurfaceFingerprints,
  createReleaseBImportExecutor,
  createReleaseBConsumptionStore,
  hashAuthorizationReceipt,
  loadTask17FrozenGate,
  validateHistoricalReleaseBAuthorizationReceiptV1,
  validateCurrentReleaseBAuthorizationReceiptV2,
} from "./release-b-production-import.mjs";

const TASK_17_COMMIT = "ddb7de82c7cb4f76adc79fdb7f2a6410ec6b4c4a";
const fixtureDirectory = path.join(process.cwd(), "artifacts", "device-schema-v1", "release-b-authorization-receipts");
const approval1Path = path.join(fixtureDirectory, "release-b-approval-1.json");
const frozen = await loadTask17FrozenGate();
const fingerprints = await computeReleaseBExecutionSurfaceFingerprints();

function v1Receipt(overrides = {}) {
  return {
    schemaVersion: AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1,
    approvalId: "release-b-approval-1",
    authorizedAtUtc: "2026-09-20T03:21:20Z",
    targetProjectRef: frozen.targetProjectRef,
    targetClass: frozen.targetClass,
    task17Commit: TASK_17_COMMIT,
    gateSourceCommit: frozen.sourceCommit,
    normalizedPayloadSha256: frozen.normalizedPayloadSha256,
    dryRunFingerprint: frozen.dryRunFingerprint,
    identityMapFingerprint: frozen.identityMapFingerprint,
    sourceMetadataFingerprint: frozen.sourceMetadataFingerprint,
    conflictMapFingerprint: frozen.conflictMapFingerprint,
    importerCodeFingerprint: frozen.importerCodeFingerprint,
    expectedBeforeCounts: { ...frozen.expectedBeforeCounts },
    expectedAfterCounts: { ...frozen.expectedAfterCounts },
    authorizedOperation: "RELEASE_B_PRODUCTION_IMPORT",
    maxAttempts: 1,
    allowDeletes: false,
    allowSchemaMutation: false,
    allowMigrationHistoryMutation: false,
    allowCloudflareWrites: false,
    allowDeployment: false,
    allowPush: false,
    allowMerge: false,
    allowQaProd: false,
    ...overrides,
  };
}

function v2Receipt(overrides = {}) {
  return {
    ...v1Receipt({
      schemaVersion: AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2,
      approvalId: "release-b-approval-2",
      authorizedAtUtc: "2026-09-20T08:35:56Z",
    }),
    task18TransportCommit: fingerprints.task18TransportCommit,
    task18ExecutorCommit: fingerprints.task18ExecutorCommit,
    productionTransportFingerprint: fingerprints.productionTransportFingerprint,
    productionExecutorFingerprint: fingerprints.productionExecutorFingerprint,
    automaticRetry: false,
    ...overrides,
  };
}

function assertRejectsReceipt(fn, pattern, message) {
  assert.throws(fn, pattern, message);
}

validateHistoricalReleaseBAuthorizationReceiptV1(v1Receipt(), hashAuthorizationReceipt(v1Receipt()), frozen);
const approval1 = JSON.parse(await fs.readFile(approval1Path, "utf8"));
validateHistoricalReleaseBAuthorizationReceiptV1(approval1, hashAuthorizationReceipt(approval1), frozen);

for (const key of ["task18TransportCommit", "automaticRetry"]) {
  assertRejectsReceipt(
    () => validateHistoricalReleaseBAuthorizationReceiptV1(v1Receipt({ [key]: key === "automaticRetry" ? false : fingerprints.task18TransportCommit }), hashAuthorizationReceipt(v1Receipt({ [key]: key === "automaticRetry" ? false : fingerprints.task18TransportCommit })), frozen),
    /INVALID_RELEASE_B_AUTHORIZATION_RECEIPT/,
    `v1 rejects the v2-only ${key} field`,
  );
}

for (const key of ["task18TransportCommit", "task18ExecutorCommit", "productionTransportFingerprint", "productionExecutorFingerprint", "automaticRetry"]) {
  const candidate = v2Receipt();
  delete candidate[key];
  assertRejectsReceipt(
    () => validateCurrentReleaseBAuthorizationReceiptV2(candidate, hashAuthorizationReceipt(candidate), frozen, fingerprints),
    /INVALID_RELEASE_B_AUTHORIZATION_RECEIPT/,
    `v2 requires ${key}`,
  );
}

for (const [name, overrides, pattern] of [
  ["automatic retry", { automaticRetry: true }, /INVALID_RELEASE_B_AUTHORIZATION_RECEIPT/],
  ["maxAttempts", { maxAttempts: 2 }, /INVALID_RELEASE_B_AUTHORIZATION_RECEIPT/],
  ["transport commit", { task18TransportCommit: "0".repeat(40) }, /RELEASE_B_TASK18_TRANSPORT_COMMIT_MISMATCH/],
  ["executor commit", { task18ExecutorCommit: "0".repeat(40) }, /RELEASE_B_TASK18_EXECUTOR_COMMIT_MISMATCH/],
  ["transport fingerprint", { productionTransportFingerprint: "0".repeat(64) }, /RELEASE_B_PRODUCTION_TRANSPORT_FINGERPRINT_MISMATCH/],
  ["executor fingerprint", { productionExecutorFingerprint: "0".repeat(64) }, /RELEASE_B_PRODUCTION_EXECUTOR_FINGERPRINT_MISMATCH/],
  ["unknown field", { randomField: true }, /INVALID_RELEASE_B_AUTHORIZATION_RECEIPT/],
]) {
  const candidate = v2Receipt(overrides);
  assertRejectsReceipt(
    () => validateCurrentReleaseBAuthorizationReceiptV2(candidate, hashAuthorizationReceipt(candidate), frozen, fingerprints),
    pattern,
    `${name} mutation fails v2 validation`,
  );
}

const validV2 = v2Receipt();
validateCurrentReleaseBAuthorizationReceiptV2(validV2, hashAuthorizationReceipt(validV2), frozen, fingerprints);
assertRejectsReceipt(
  () => validateCurrentReleaseBAuthorizationReceiptV2(v1Receipt(), hashAuthorizationReceipt(v1Receipt()), frozen, fingerprints),
  /RELEASE_B_AUTHORIZATION_V2_REQUIRED/,
  "v1 cannot be silently treated as v2",
);

const semanticMutation = v2Receipt({ maxAttempts: 2 });
assert.notEqual(hashAuthorizationReceipt(validV2), hashAuthorizationReceipt(semanticMutation), "semantic mutations change the canonical receipt hash");
const formattedClone = JSON.parse(JSON.stringify(validV2, null, 2));
assert.equal(hashAuthorizationReceipt(validV2), hashAuthorizationReceipt(formattedClone), "formatting-only receipt changes preserve the canonical semantic hash");

const originalOpen = fs.open;
const originalMkdir = fs.mkdir;
let canonicalLedgerAccesses = 0;
fs.open = async (file, ...rest) => {
  const target = path.resolve(String(file));
  if (target === PRODUCTION_LEDGER_DIRECTORY || target.startsWith(`${PRODUCTION_LEDGER_DIRECTORY}${path.sep}`)) canonicalLedgerAccesses++;
  return originalOpen(file, ...rest);
};
fs.mkdir = async (file, ...rest) => {
  const target = path.resolve(String(file));
  if (target === PRODUCTION_LEDGER_DIRECTORY || target.startsWith(`${PRODUCTION_LEDGER_DIRECTORY}${path.sep}`)) canonicalLedgerAccesses++;
  return originalMkdir(file, ...rest);
};
syncBuiltinESMExports();
try {
  validateCurrentReleaseBAuthorizationReceiptV2(validV2, hashAuthorizationReceipt(validV2), frozen, fingerprints);
  assert.equal(canonicalLedgerAccesses, 0, "validating a v2 receipt creates no ledger entry");
} finally {
  fs.open = originalOpen;
  fs.mkdir = originalMkdir;
  syncBuiltinESMExports();
}

const ownedLedgerRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openglass-release-b-v2-test-"));
try {
  const ownedExecutor = createReleaseBImportExecutor({ consumptionStore: createReleaseBConsumptionStore(path.join(ownedLedgerRoot, "ledger")) });
  const neverTransport = {
    async identifyTarget() { throw new Error("transport must not be reached"); },
    async readPrecheck() { throw new Error("transport must not be reached"); },
    async readPostcheck() { throw new Error("transport must not be reached"); },
    async transaction() { throw new Error("transport must not be reached"); },
  };
  await assert.rejects(
    () => ownedExecutor({ args: ["--execute-production"], authorizationReceipt: v1Receipt({ approvalId: "release-b-approval-991" }), authorizationReceiptSha256: hashAuthorizationReceipt(v1Receipt({ approvalId: "release-b-approval-991" })), transport: neverTransport }),
    /RELEASE_B_AUTHORIZATION_V2_REQUIRED/,
    "the current Production path rejects v1 before ledger creation, transport creation, DB connection, or SQL",
  );
} finally {
  await fs.rm(ownedLedgerRoot, { recursive: true, force: true });
}

const drift = await computeReleaseBExecutionSurfaceFingerprints({ task18ExecutorCommit: fingerprints.task18ExecutorCommit, transportBytes: Buffer.from("transport drift\n"), executorBytes: Buffer.from("executor drift\n") });
assert.notEqual(drift.productionTransportFingerprint, fingerprints.productionTransportFingerprint, "transport source drift changes the bound fingerprint");
assert.notEqual(drift.productionExecutorFingerprint, fingerprints.productionExecutorFingerprint, "executor source drift changes the bound fingerprint");

console.log("RELEASE_B_AUTHORIZATION_RECEIPT_V2_CONTRACT_OK");
