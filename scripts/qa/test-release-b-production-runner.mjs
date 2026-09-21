import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1,
  AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2,
  AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3,
  computeReleaseBExecutionSurfaceFingerprints,
  hashAuthorizationReceipt,
  loadTask17FrozenGate,
  validateCurrentReleaseBAuthorizationReceiptV3,
} from "./release-b-production-import.mjs";
import {
  RELEASE_B_PRODUCTION_RUNNER_PATH,
  createReleaseBProductionRunnerTransport,
  preflightReleaseBProductionRunner,
} from "./release-b-production-runner.mjs";

const TASK_17_COMMIT = "ddb7de82c7cb4f76adc79fdb7f2a6410ec6b4c4a";
const SESSION_DSN = "postgresql://postgres.xcbnxzjlsvtgzixurcof:test-only@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require";
const TRANSACTION_DSN = "postgresql://postgres.xcbnxzjlsvtgzixurcof:test-only@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require";
const frozen = await loadTask17FrozenGate();
const runnerBytes = await readFile(new URL("./release-b-production-runner.mjs", import.meta.url));
const executionSurface = await computeReleaseBExecutionSurfaceFingerprints({ runnerBytes });
const headExecutionSurface = await computeReleaseBExecutionSurfaceFingerprints();

function receipt(schemaVersion, overrides = {}) {
  const base = {
    schemaVersion,
    approvalId: schemaVersion === AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3 ? "release-b-approval-3" : "release-b-approval-2",
    authorizedAtUtc: "2026-09-21T00:00:00Z",
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
    task18TransportCommit: executionSurface.task18TransportCommit,
    task18ExecutorCommit: executionSurface.task18ExecutorCommit,
    productionTransportFingerprint: executionSurface.productionTransportFingerprint,
    productionExecutorFingerprint: executionSurface.productionExecutorFingerprint,
    automaticRetry: false,
  };
  if (schemaVersion === AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3) {
    base.runnerPath = RELEASE_B_PRODUCTION_RUNNER_PATH;
    base.runnerCommit = executionSurface.runnerCommit;
    base.productionRunnerFingerprint = executionSurface.productionRunnerFingerprint;
  }
  return { ...base, ...overrides };
}

assert.equal(RELEASE_B_PRODUCTION_RUNNER_PATH, "scripts/qa/release-b-production-runner.mjs", "runner is a separate reviewed composition root");

assert.throws(
  () => preflightReleaseBProductionRunner({ environment: {} }),
  /PRODUCTION_CONNECTION_SOURCE_UNAVAILABLE/,
  "missing P9_PRODUCTION_DATABASE_URL fails closed before session construction",
);

assert.throws(
  () => preflightReleaseBProductionRunner({ environment: { P9_PRODUCTION_DATABASE_URL: TRANSACTION_DSN } }),
  /PRODUCTION_CONNECTION_SOURCE_UNAVAILABLE/,
  "transaction pooler or otherwise invalid DSN fails through the existing P9 contract",
);

const preflight = preflightReleaseBProductionRunner({ environment: { P9_PRODUCTION_DATABASE_URL: SESSION_DSN } });
assert.deepEqual(
  [preflight.runnerPath, preflight.targetEndpointClass, preflight.connects, preflight.startsTransaction, preflight.runsSql, preflight.authorizationConsumed],
  [RELEASE_B_PRODUCTION_RUNNER_PATH, "SUPAVISOR_SESSION", false, false, false, false],
  "valid synthetic Session Pooler DSN constructs only value-blind runner metadata",
);

let sessions = 0;
const transport = createReleaseBProductionRunnerTransport({
  environment: { P9_PRODUCTION_DATABASE_URL: SESSION_DSN },
  createSession: async () => { sessions += 1; throw new Error("test session should not be opened by construction"); },
  readPostcheck: async () => ({}),
});
assert.equal(typeof transport.identifyTarget, "function", "runner injects the existing reviewed transport factory");
assert.equal(sessions, 0, "transport construction does not connect");
assert.equal(JSON.stringify(transport).includes("query"), false, "runner does not expose an alternate SQL client surface");

let clientConstructed = 0;
let clientConnected = 0;
const runnerComposedReceipt = receipt(AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3, {
  runnerCommit: headExecutionSurface.runnerCommit,
  productionRunnerFingerprint: headExecutionSurface.productionRunnerFingerprint,
});
const runnerCompositionResult = await (await import("./release-b-production-runner.mjs")).runReleaseBProductionRunner({
  args: ["--execute-production"],
  environment: { P9_PRODUCTION_DATABASE_URL: SESSION_DSN },
  authorizationReceipt: runnerComposedReceipt,
  authorizationReceiptSha256: hashAuthorizationReceipt(runnerComposedReceipt),
  PostgresClient: class FakeRunnerClient {
    constructor(config) {
      clientConstructed += 1;
      this.config = config;
    }
    async connect() {
      clientConnected += 1;
    }
    async query(sql) {
      if (sql.startsWith("SELECT current_database")) {
        return { rows: [{ current_database: "postgres", current_user: "postgres.xcbnxzjlsvtgzixurcof", server_port: "5432" }] };
      }
      throw new Error("runner composition test must stop before non-identity SQL");
    }
    async end() {}
  },
  executeProductionImport: async ({ transport: composedTransport }) => composedTransport.identifyTarget(),
});
assert.deepEqual(
  runnerCompositionResult,
  { projectRef: "xcbnxzjlsvtgzixurcof", targetClass: "OpenGlass Hub Supabase Production" },
  "runner execution composes the reviewed postgres adapter collaborators when manual injection is absent",
);
assert.equal(clientConstructed, 1, "adapter construction itself opens zero sessions; the executor-controlled target check opens the first one");
assert.equal(clientConnected, 1, "runner composition supplies a real adapter createSession collaborator to the reviewed transport");

assert.throws(
  () => validateCurrentReleaseBAuthorizationReceiptV3(receipt(AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1), hashAuthorizationReceipt(receipt(AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1)), frozen, executionSurface),
  /RELEASE_B_AUTHORIZATION_V3_REQUIRED/,
  "historical v1 cannot authorize the new runner",
);
assert.throws(
  () => validateCurrentReleaseBAuthorizationReceiptV3(receipt(AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2), hashAuthorizationReceipt(receipt(AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2)), frozen, executionSurface),
  /RELEASE_B_AUTHORIZATION_V3_REQUIRED/,
  "historical approval-2/v2 cannot authorize the new runner",
);

for (const [name, overrides, pattern] of [
  ["historical approval id wrapped as v3", { approvalId: "release-b-approval-2" }, /RELEASE_B_HISTORICAL_APPROVAL_NOT_EXECUTABLE/],
  ["runner fingerprint", { productionRunnerFingerprint: "0".repeat(64) }, /RELEASE_B_PRODUCTION_RUNNER_FINGERPRINT_MISMATCH/],
  ["runner path", { runnerPath: "scripts/qa/other-runner.mjs" }, /RELEASE_B_PRODUCTION_RUNNER_PATH_MISMATCH/],
  ["runner commit", { runnerCommit: "0".repeat(40) }, /RELEASE_B_PRODUCTION_RUNNER_COMMIT_MISMATCH/],
  ["unknown field", { unexpected: true }, /INVALID_RELEASE_B_AUTHORIZATION_RECEIPT/],
  ["maxAttempts", { maxAttempts: 2 }, /INVALID_RELEASE_B_AUTHORIZATION_RECEIPT/],
  ["automaticRetry", { automaticRetry: true }, /INVALID_RELEASE_B_AUTHORIZATION_RECEIPT/],
]) {
  const candidate = receipt(AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3, overrides);
  assert.throws(
    () => validateCurrentReleaseBAuthorizationReceiptV3(candidate, hashAuthorizationReceipt(candidate), frozen, executionSurface),
    pattern,
    `${name} fails v3 authorization before transport construction`,
  );
}

console.log("RELEASE_B_PRODUCTION_RUNNER_CONTRACT_OK");
