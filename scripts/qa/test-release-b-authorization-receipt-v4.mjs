import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1,
  AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2,
  AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3,
  AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V4,
  RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_PATH,
  RELEASE_B_PRODUCTION_RUNNER_PATH,
  computeReleaseBExecutionSurfaceFingerprints,
  createReleaseBAuthorizationReceiptV4,
  hashAuthorizationReceipt,
  loadTask17FrozenGate,
  validateCurrentReleaseBAuthorizationReceiptV4,
} from "./release-b-production-import.mjs";

const frozen = await loadTask17FrozenGate();
const runnerBytes = await readFile(new URL("./release-b-production-runner.mjs", import.meta.url));
const adapterBytes = await readFile(new URL("./lib/release-b-production-postgres-adapter.mjs", import.meta.url));
const executionSurface = await computeReleaseBExecutionSurfaceFingerprints({ runnerBytes, adapterBytes });

function v4Receipt(overrides = {}) {
  return createReleaseBAuthorizationReceiptV4({
    approvalId: "release-b-approval-4",
    authorizedAtUtc: "2026-09-21T04:00:00Z",
    frozen,
    executionSurface,
    ...overrides,
  });
}

function historicalReceipt(schemaVersion) {
  const current = v4Receipt({ approvalId: schemaVersion === AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3 ? "release-b-approval-3" : "release-b-approval-2" });
  if (schemaVersion !== AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V4) {
    delete current.productionPostgresAdapterPath;
    delete current.productionPostgresAdapterCommit;
    delete current.productionPostgresAdapterFingerprint;
  }
  if (schemaVersion !== AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V4 && schemaVersion !== AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3) {
    delete current.runnerPath;
    delete current.runnerCommit;
    delete current.productionRunnerFingerprint;
  }
  if (schemaVersion === AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1) {
    delete current.task18TransportCommit;
    delete current.task18ExecutorCommit;
    delete current.productionTransportFingerprint;
    delete current.productionExecutorFingerprint;
    delete current.automaticRetry;
  }
  return { ...current, schemaVersion };
}

assert.equal(AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V4, "openglass-device-schema-v1-release-b-authorization-v4");
assert.equal(RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_PATH, "scripts/qa/lib/release-b-production-postgres-adapter.mjs");
assert.match(executionSurface.productionPostgresAdapterFingerprint, /^[a-f0-9]{64}$/, "v4 execution surface binds the adapter source bytes");

const valid = v4Receipt();
assert.equal(valid.schemaVersion, AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V4);
assert.equal(valid.productionPostgresAdapterPath, RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_PATH);
assert.equal(valid.productionPostgresAdapterCommit, executionSurface.productionPostgresAdapterCommit);
assert.equal(valid.productionPostgresAdapterFingerprint, executionSurface.productionPostgresAdapterFingerprint);
validateCurrentReleaseBAuthorizationReceiptV4(valid, hashAuthorizationReceipt(valid), frozen, executionSurface);

for (const schemaVersion of [
  AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1,
  AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2,
  AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3,
]) {
  const candidate = historicalReceipt(schemaVersion);
  assert.throws(
    () => validateCurrentReleaseBAuthorizationReceiptV4(candidate, hashAuthorizationReceipt(candidate), frozen, executionSurface),
    /RELEASE_B_AUTHORIZATION_V4_REQUIRED/,
    `${schemaVersion} remains historical and non-executable on the adapter-bound path`,
  );
}

for (const key of ["productionPostgresAdapterPath", "productionPostgresAdapterCommit", "productionPostgresAdapterFingerprint"]) {
  const candidate = v4Receipt();
  delete candidate[key];
  assert.throws(
    () => validateCurrentReleaseBAuthorizationReceiptV4(candidate, hashAuthorizationReceipt(candidate), frozen, executionSurface),
    /INVALID_RELEASE_B_AUTHORIZATION_RECEIPT/,
    `v4 requires ${key}`,
  );
}

for (const [name, overrides, pattern] of [
  ["target", { targetProjectRef: "wrong-project" }, /RELEASE_B_TARGET_MISMATCH/],
  ["executor commit", { task18ExecutorCommit: "0".repeat(40) }, /RELEASE_B_TASK18_EXECUTOR_COMMIT_MISMATCH/],
  ["runner path", { runnerPath: "scripts/qa/other-runner.mjs" }, /RELEASE_B_PRODUCTION_RUNNER_PATH_MISMATCH/],
  ["adapter path", { productionPostgresAdapterPath: "scripts/qa/lib/other-adapter.mjs" }, /RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_PATH_MISMATCH/],
  ["adapter commit", { productionPostgresAdapterCommit: "0".repeat(40) }, /RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_COMMIT_MISMATCH/],
  ["adapter fingerprint", { productionPostgresAdapterFingerprint: "0".repeat(64) }, /RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_FINGERPRINT_MISMATCH/],
  ["unknown field", { unexpected: true }, /INVALID_RELEASE_B_AUTHORIZATION_RECEIPT/],
  ["maxAttempts", { maxAttempts: 2 }, /INVALID_RELEASE_B_AUTHORIZATION_RECEIPT/],
  ["automaticRetry", { automaticRetry: true }, /INVALID_RELEASE_B_AUTHORIZATION_RECEIPT/],
]) {
  const candidate = { ...v4Receipt(), ...overrides };
  assert.throws(
    () => validateCurrentReleaseBAuthorizationReceiptV4(candidate, hashAuthorizationReceipt(candidate), frozen, executionSurface),
    pattern,
    `${name} mutation fails v4 authorization`,
  );
}

const adapterDrift = await computeReleaseBExecutionSurfaceFingerprints({
  runnerBytes,
  adapterBytes: Buffer.from("adapter drift\n"),
});
assert.notEqual(
  adapterDrift.productionPostgresAdapterFingerprint,
  executionSurface.productionPostgresAdapterFingerprint,
  "adapter source drift changes the bound v4 fingerprint",
);

console.log("RELEASE_B_AUTHORIZATION_RECEIPT_V4_CONTRACT_OK");
