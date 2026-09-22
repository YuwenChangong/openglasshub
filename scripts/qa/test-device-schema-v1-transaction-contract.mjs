import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { buildSchemaV1RecoveryPlan } from "../devices/import-device-schema-v1.mjs";
import { fingerprintRecoveryPlan } from "../devices/schema-v1/dry-run.mjs";
import { createReleaseBDisposableTransport } from "./release-b-disposable-transport.mjs";
import { createReleaseBTestFixture } from "./release-b-test-fixture.mjs";
import { createReleaseBProductionTransport } from "./lib/release-b-production-transport.mjs";

let productionExecutor;
try {
  productionExecutor = await import("./release-b-production-import.mjs");
} catch (error) {
  const blocker = new Error("RELEASE_B_PRODUCTION_EXECUTOR_MISSING");
  blocker.cause = error;
  throw blocker;
}

const { AUTHORIZATION_RECEIPT_SCHEMA_VERSION, AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1, AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3, PRODUCTION_LEDGER_DIRECTORY, hashAuthorizationReceipt, loadTask17FrozenGate } = productionExecutor;
const fixture = await createReleaseBTestFixture();
// Canonical filesystem calls are redirected only for a default-executor sentinel
// check, then prohibited entirely. The real durable ledger is never accessed.
let sandboxCanonical = true;
let canonicalAccesses = 0;
let canonicalLedgerSentinelChecked = false;
const originals = new Map();
for (const method of ["readFile", "open", "mkdir", "rm", "readdir", "stat", "lstat", "writeFile"]) {
  originals.set(method, fs[method]);
  fs[method] = async (file, ...rest) => {
    const target = path.resolve(String(file));
    const canonical = target === PRODUCTION_LEDGER_DIRECTORY || target.startsWith(`${PRODUCTION_LEDGER_DIRECTORY}${path.sep}`);
    assert.ok(method !== "rm" || !PRODUCTION_LEDGER_DIRECTORY.startsWith(`${target}${path.sep}`), "canonical ledger ancestor cleanup forbidden");
    if (canonical) {
      canonicalAccesses++;
      assert.ok(sandboxCanonical, `canonical ledger filesystem access forbidden: ${method}`);
      return originals.get(method)(path.join(fixture.canonicalSandbox, path.relative(PRODUCTION_LEDGER_DIRECTORY, target)), ...rest);
    }
    return originals.get(method)(file, ...rest);
  };
}
syncBuiltinESMExports();
const executeReleaseBProductionImport = fixture.execute;
const RELEASE_B_FROZEN = await loadTask17FrozenGate();
const TASK_17_COMMIT = "ddb7de82c7cb4f76adc79fdb7f2a6410ec6b4c4a";
const RUNNER_BYTES = await fs.readFile(new URL("./release-b-production-runner.mjs", import.meta.url));
const EXECUTION_SURFACE = await productionExecutor.computeReleaseBExecutionSurfaceFingerprints();

function receipt(overrides = {}) {
  return {
    schemaVersion: AUTHORIZATION_RECEIPT_SCHEMA_VERSION, approvalId: "release-b-approval-20260917", authorizedAtUtc: "2026-09-17T04:15:00Z",
    targetProjectRef: "xcbnxzjlsvtgzixurcof", targetClass: "OpenGlass Hub Supabase Production", task17Commit: TASK_17_COMMIT,
    gateSourceCommit: RELEASE_B_FROZEN.sourceCommit, normalizedPayloadSha256: RELEASE_B_FROZEN.normalizedPayloadSha256,
    dryRunFingerprint: RELEASE_B_FROZEN.dryRunFingerprint, identityMapFingerprint: RELEASE_B_FROZEN.identityMapFingerprint,
    sourceMetadataFingerprint: RELEASE_B_FROZEN.sourceMetadataFingerprint, conflictMapFingerprint: RELEASE_B_FROZEN.conflictMapFingerprint,
    importerCodeFingerprint: RELEASE_B_FROZEN.importerCodeFingerprint, expectedBeforeCounts: { ...RELEASE_B_FROZEN.expectedBeforeCounts },
    expectedAfterCounts: { ...RELEASE_B_FROZEN.expectedAfterCounts }, authorizedOperation: "RELEASE_B_PRODUCTION_IMPORT", maxAttempts: 1,
    allowDeletes: false, allowSchemaMutation: false, allowMigrationHistoryMutation: false, allowCloudflareWrites: false,
    allowDeployment: false, allowPush: false, allowMerge: false, allowQaProd: false, automaticRetry: false,
    task18TransportCommit: EXECUTION_SURFACE.task18TransportCommit,
    task18ExecutorCommit: EXECUTION_SURFACE.task18ExecutorCommit,
    runnerPath: productionExecutor.RELEASE_B_PRODUCTION_RUNNER_PATH,
    runnerCommit: EXECUTION_SURFACE.runnerCommit,
    productionTransportFingerprint: EXECUTION_SURFACE.productionTransportFingerprint,
    productionExecutorFingerprint: EXECUTION_SURFACE.productionExecutorFingerprint,
    productionRunnerFingerprint: EXECUTION_SURFACE.productionRunnerFingerprint,
    productionPostgresAdapterPath: productionExecutor.RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_PATH,
    productionPostgresAdapterCommit: EXECUTION_SURFACE.productionPostgresAdapterCommit,
    productionPostgresAdapterFingerprint: EXECUTION_SURFACE.productionPostgresAdapterFingerprint,
    ...overrides,
  };
}

function historicalV1Receipt(overrides = {}) {
  const current = receipt({ schemaVersion: AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1, ...overrides });
  delete current.task18TransportCommit;
  delete current.task18ExecutorCommit;
  delete current.productionTransportFingerprint;
  delete current.productionExecutorFingerprint;
  delete current.runnerPath;
  delete current.runnerCommit;
  delete current.productionRunnerFingerprint;
  delete current.productionPostgresAdapterPath;
  delete current.productionPostgresAdapterCommit;
  delete current.productionPostgresAdapterFingerprint;
  delete current.automaticRetry;
  return current;
}

function historicalV3Receipt(overrides = {}) {
  const current = receipt({ schemaVersion: AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3, approvalId: "release-b-approval-3", ...overrides });
  delete current.productionPostgresAdapterPath;
  delete current.productionPostgresAdapterCommit;
  delete current.productionPostgresAdapterFingerprint;
  return current;
}

async function receiptV2(overrides = {}) {
  const surface = await productionExecutor.loadReleaseBExecutionSurfaceBinding({ runnerBytes: RUNNER_BYTES });
  return {
    schemaVersion: productionExecutor.AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2,
    approvalId: "release-b-approval-20260918",
    authorizedAtUtc: "2026-09-18T04:15:00Z",
    targetProjectRef: "xcbnxzjlsvtgzixurcof",
    targetClass: "OpenGlass Hub Supabase Production",
    task17Commit: TASK_17_COMMIT,
    gateSourceCommit: RELEASE_B_FROZEN.sourceCommit,
    task18TransportCommit: surface.task18TransportCommit,
    task18ExecutorCommit: surface.task18ExecutorCommit,
    normalizedPayloadSha256: RELEASE_B_FROZEN.normalizedPayloadSha256,
    dryRunFingerprint: RELEASE_B_FROZEN.dryRunFingerprint,
    identityMapFingerprint: RELEASE_B_FROZEN.identityMapFingerprint,
    sourceMetadataFingerprint: RELEASE_B_FROZEN.sourceMetadataFingerprint,
    conflictMapFingerprint: RELEASE_B_FROZEN.conflictMapFingerprint,
    importerCodeFingerprint: RELEASE_B_FROZEN.importerCodeFingerprint,
    productionTransportFingerprint: surface.productionTransportFingerprint,
    productionExecutorFingerprint: surface.productionExecutorFingerprint,
    expectedBeforeCounts: { ...RELEASE_B_FROZEN.expectedBeforeCounts },
    expectedAfterCounts: { ...RELEASE_B_FROZEN.expectedAfterCounts },
    authorizedOperation: "RELEASE_B_PRODUCTION_IMPORT",
    maxAttempts: 1,
    automaticRetry: false,
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

function failure(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createTransport({ failEntity, target = { projectRef: "xcbnxzjlsvtgzixurcof", targetClass: "OpenGlass Hub Supabase Production" }, beforeCounts = RELEASE_B_FROZEN.expectedBeforeCounts, identifyFailure = null } = {}) {
  const state = { writes: [], identifyCount: 0, transactionCount: 0, rollbackCount: 0, postcheckCount: 0 };
  return {
    state,
    async identifyTarget() {
      state.identifyCount += 1;
      if (identifyFailure) throw identifyFailure;
      return target;
    },
    async readPrecheck() { return { releaseAHistory: "PRESENT", schemaPostconditions: "PASS", releaseBApplied: false, counts: beforeCounts }; },
    async transaction(work) {
      state.transactionCount += 1;
      const pending = [];
      try {
        await work({
          async readPrecheckForUpdate() { return { releaseAHistory: "PRESENT", schemaPostconditions: "PASS", releaseBApplied: false, counts: beforeCounts }; },
          async upsert(entity, row) { if (entity === failEntity) throw new Error(`simulated ${entity} constraint failure`); pending.push({ entity, row }); },
        });
        state.writes.push(...pending);
      } catch (error) { state.rollbackCount += 1; throw error; }
    },
    async readPostcheck() {
      state.postcheckCount += 1;
      return { counts: { ...RELEASE_B_FROZEN.expectedAfterCounts }, uniqueSlugs: 24, publishedDevices: 24, conflictInvariants: "PASS", rayBanIdentity: "ray-ban-meta", unexpectedDeletes: 0 };
    },
  };
}

function createActualAdapterTransport({ precheck = { releaseAHistory: "PRESENT", schemaPostconditions: "PASS", releaseBApplied: false, counts: RELEASE_B_FROZEN.expectedBeforeCounts }, failCommitAck = false } = {}) {
  const state = { queries: [], sessions: 0 };
  const environment = { P9_PRODUCTION_DATABASE_URL: "postgresql://postgres.xcbnxzjlsvtgzixurcof:unit-test-password@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require" };
  return {
    state,
    transport: createReleaseBProductionTransport({
      environment,
      async createSession() {
        state.sessions += 1;
        return {
          targetIdentity: { projectRef: "xcbnxzjlsvtgzixurcof", host: "aws-1-ap-northeast-1.pooler.supabase.com", port: 5432, database: "postgres", databaseRole: "postgres", endpointClass: "SUPAVISOR_SESSION" },
          async query(sql) {
            state.queries.push(sql);
            if (sql.startsWith("SELECT current_database")) return { rows: [{ current_database: "postgres", current_user: "postgres", server_port: "5432" }] };
            if (sql.startsWith("LOCK TABLE")) return { rows: [] };
            if (sql.startsWith("SELECT encode")) return { rows: [{ release_b_state: precheck }] };
            if (sql.startsWith("UPDATE public.devices") && sql.includes(" RETURNING 1 AS updated")) return { rows: [{ updated: 1 }], rowCount: 1 };
            if (failCommitAck && sql === "COMMIT;") throw Object.assign(new Error("lost commit acknowledgement"), { code: "ECONNRESET" });
            return { rows: [] };
          },
          async close() {},
        };
      },
      readPostcheck: async () => ({ counts: { ...RELEASE_B_FROZEN.expectedAfterCounts }, uniqueSlugs: 24, publishedDevices: 24, conflictInvariants: "PASS", rayBanIdentity: "ray-ban-meta", unexpectedDeletes: 0 }),
    }),
  };
}

const recoveryPlan = await buildSchemaV1RecoveryPlan();
const frozenPlan = { ...recoveryPlan, normalizedPayloadSha256: RELEASE_B_FROZEN.normalizedPayloadSha256, dryRunFingerprint: fingerprintRecoveryPlan(recoveryPlan) };
assert.equal(frozenPlan.dryRunFingerprint, RELEASE_B_FROZEN.dryRunFingerprint, "the test rebuild uses the committed Task 17 frozen plan");
assert.match(hashAuthorizationReceipt(receipt()), /^[a-f0-9]{64}$/, "authorization receipts have a stable content-address");

const temporaryDirectory = fixture.directory;
async function ledgerEntry(approvalId) {
  try {
    return JSON.parse(await fs.readFile(path.join(temporaryDirectory, `${approvalId}.json`), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertLedgerAbsent(approvalId, message) {
  assert.equal(await ledgerEntry(approvalId), null, message);
}

async function assertStartedLedger(approvalId, authorizationReceiptSha256) {
  assert.deepEqual(await ledgerEntry(approvalId), {
    approvalId,
    authorizationReceiptSha256,
    schemaVersion: "openglass-device-schema-v1-release-b-consumption-v1",
    status: "STARTED",
  }, `${approvalId} keeps a durable STARTED ledger entry`);
}

try {
  const v1ExecutionTransport = createTransport();
  const v1ExecutionReceipt = historicalV1Receipt({ approvalId: "release-b-approval-4090" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: v1ExecutionReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(v1ExecutionReceipt), ledgerDirectory: path.join(temporaryDirectory, "v1-execution-rejected"), transport: v1ExecutionTransport, plan: frozenPlan }), /RELEASE_B_AUTHORIZATION_V3_REQUIRED/, "current Release B Production execution rejects legacy v1 receipts before mutation");
  assert.equal(v1ExecutionTransport.state.transactionCount, 0, "legacy v1 execution rejection occurs before any transaction");

  const v2ValidTransport = createTransport();
  const v2ValidReceipt = await receiptV2({ approvalId: "release-b-approval-4091" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: v2ValidReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(v2ValidReceipt), ledgerDirectory: path.join(temporaryDirectory, "v2-valid"), transport: v2ValidTransport, plan: frozenPlan }), /RELEASE_B_AUTHORIZATION_V3_REQUIRED/, "an exact historical v2 receipt cannot execute the current runner-bound Production path");
  assert.equal(v2ValidTransport.state.transactionCount, 0);

  const v3HistoricalTransport = createTransport();
  const v3HistoricalReceipt = historicalV3Receipt({ approvalId: "release-b-approval-4092" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: v3HistoricalReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(v3HistoricalReceipt), ledgerDirectory: path.join(temporaryDirectory, "v3-historical"), transport: v3HistoricalTransport, plan: frozenPlan }), /RELEASE_B_AUTHORIZATION_V4_REQUIRED/, "historical approval-3/v3 cannot execute the adapter-bound Production path");
  assert.equal(v3HistoricalTransport.state.transactionCount, 0);

  const canonicalTransport = createTransport();
  await assert.rejects(() => productionExecutor.executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: receipt(), authorizationReceiptSha256: hashAuthorizationReceipt(receipt()), transport: canonicalTransport }), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/, "a preexisting canonical STARTED approval blocks the default production entry point");
  assert.equal(canonicalTransport.state.transactionCount, 0);
  assert.equal(canonicalAccesses, 2, "default executor mkdir/open are safely redirected into the canonical namespace sandbox");
  canonicalLedgerSentinelChecked = true;
  sandboxCanonical = false;
  const ignoredCallerPlanTransport = createTransport();
  const ignoredCallerPlanReceipt = receipt({ approvalId: "release-b-approval-20260916" });
  const ignoredCallerPlan = await executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: ignoredCallerPlanReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(ignoredCallerPlanReceipt), ledgerDirectory: temporaryDirectory, transport: ignoredCallerPlanTransport });
  assert.equal(ignoredCallerPlan.status, "COMMITTED", "the executor applies its independently rebuilt immutable plan without a caller-supplied plan");
  assert.deepEqual(ignoredCallerPlan.operations, { definition: 92, device: 24, source: 39, sourceLink: 46, spec: 1488, evidence: 15, compatibility: 24 });

  const validTransport = createTransport();
  const valid = await executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: receipt(), authorizationReceiptSha256: hashAuthorizationReceipt(receipt()), ledgerDirectory: temporaryDirectory, transport: validTransport, plan: frozenPlan });
  assert.equal(valid.status, "COMMITTED", "one valid authorization applies the frozen plan atomically through the injected transport");
  assert.equal(validTransport.state.transactionCount, 1, "the valid production contract opens exactly one transaction");
  assert.ok(validTransport.state.writes.every((write) => ["definition", "device", "source", "sourceLink", "spec", "evidence", "compatibility"].includes(write.entity)), "the coordinator permits only approved Release B entity classes");
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: receipt(), authorizationReceiptSha256: hashAuthorizationReceipt(receipt()), ledgerDirectory: temporaryDirectory, transport: validTransport, plan: frozenPlan }), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/, "the same authorization cannot write twice");
  assert.equal(validTransport.state.transactionCount, 1, "a consumed approval cannot open a second transaction");
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: receipt(), authorizationReceiptSha256: hashAuthorizationReceipt(receipt()), ledgerDirectory: path.join(temporaryDirectory, "different-caller-directory"), transport: validTransport, plan: frozenPlan }), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/, "changing a caller ledger directory cannot reset durable approval consumption");

  const rejectedCases = [
    ["missing explicit execution flag", { args: [] }, /RELEASE_B_EXECUTION_FLAG_REQUIRED/],
    ["invalid approval ID", { authorizationReceipt: receipt({ approvalId: "release-b-approval-1-extra" }) }, /INVALID_RELEASE_B_APPROVAL_ID/],
    ["missing authorization timestamp", { authorizationReceipt: receipt({ authorizedAtUtc: undefined }) }, /INVALID_RELEASE_B_AUTHORIZED_AT_UTC/],
    ["non-Z timestamp", { authorizationReceipt: receipt({ authorizedAtUtc: "2026-09-17T04:15:00+00:00" }) }, /INVALID_RELEASE_B_AUTHORIZED_AT_UTC/],
    ["malformed UTC timestamp", { authorizationReceipt: receipt({ authorizedAtUtc: "2026-09-17T25:15:00Z" }) }, /INVALID_RELEASE_B_AUTHORIZED_AT_UTC/],
    ["Task 17 commit mismatch", { authorizationReceipt: receipt({ task17Commit: "0".repeat(40) }) }, /TASK_17_COMMIT_MISMATCH/],
    ["historical v1 receipt cannot execute current Production path", { authorizationReceipt: historicalV1Receipt({ approvalId: "release-b-approval-1006" }) }, /RELEASE_B_AUTHORIZATION_V3_REQUIRED/],
    ["payload hash mismatch", { plan: { ...frozenPlan, normalizedPayloadSha256: "0".repeat(64) } }, /RELEASE_B_NORMALIZED_PAYLOAD_MISMATCH/],
    ["dry-run fingerprint mismatch", { plan: { ...frozenPlan, dryRunFingerprint: "0".repeat(64) } }, /RELEASE_B_DRY_RUN_FINGERPRINT_MISMATCH/],
    ["delete operation", { plan: { ...frozenPlan, delete: "DELETE" } }, /RELEASE_B_DELETE_FORBIDDEN/],
    ["extra-table write", { plan: { ...frozenPlan, entries: [...frozenPlan.entries, { entity: "migration", operation: "INSERT", desired: {} }] } }, /RELEASE_B_WRITE_SCOPE_VIOLATION/],
    ["schema/history mutation request", { args: ["--execute-production", "--migration"] }, /RELEASE_B_EXECUTION_FLAG_REQUIRED/],
  ];
  for (const [index, [name, overrides, expected]] of rejectedCases.entries()) {
    const transport = createTransport();
    const authorizationReceipt = overrides.authorizationReceipt ?? receipt({ approvalId: `release-b-approval-${1000 + index}` });
    await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(authorizationReceipt), ledgerDirectory: path.join(temporaryDirectory, name.replaceAll(" ", "-")), transport, plan: frozenPlan, ...overrides }), expected, `${name} is rejected before mutation`);
    assert.equal(transport.state.transactionCount, 0, `${name} cannot begin a transaction`);
  }

  for (const [index, [label, transport, expected]] of [
    ["identify connect failure", createTransport({ identifyFailure: failure("ECONNREFUSED", "synthetic identify connect failure") }), /synthetic identify connect failure/],
    ["identify auth failure", createTransport({ identifyFailure: failure("28P01", "synthetic identify auth failure") }), /synthetic identify auth failure/],
    ["identify target mismatch", createTransport({ target: { projectRef: "wrong-project", targetClass: "OpenGlass Hub Supabase Production" } }), /RELEASE_B_TARGET_MISMATCH/],
  ].entries()) {
    const approvalId = `release-b-approval-${5000 + index}`;
    const authorizationReceipt = receipt({ approvalId });
    await assertLedgerAbsent(approvalId, `${label} starts without a sandbox ledger entry`);
    await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(authorizationReceipt), transport, plan: frozenPlan }), expected, `${label} rejects before ledger consumption`);
    assert.equal(transport.state.identifyCount, 1, `${label} identifies exactly once`);
    assert.equal(transport.state.transactionCount, 0, `${label} cannot begin a transaction`);
    await assertLedgerAbsent(approvalId, `${label} leaves the sandbox ledger absent`);
  }

  const driftTransport = createTransport({ beforeCounts: { ...RELEASE_B_FROZEN.expectedBeforeCounts, devices: 1 } });
  const driftReceipt = receipt({ approvalId: "release-b-approval-2001" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: driftReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(driftReceipt), ledgerDirectory: path.join(temporaryDirectory, "drift"), transport: driftTransport, plan: frozenPlan }), /RELEASE_B_PRODUCTION_PRECONDITION_DRIFT/, "before-count drift rejects before the transaction");
  assert.equal(driftTransport.state.transactionCount, 1, "the concurrency-safe precheck executes inside the one transaction before writes");
  assert.deepEqual(driftTransport.state.writes, []);
  await assertStartedLedger(driftReceipt.approvalId, hashAuthorizationReceipt(driftReceipt));

  const wrongTargetTransport = createTransport({ target: { projectRef: "wrong-project", targetClass: "OpenGlass Hub Supabase Production" } });
  const targetReceipt = receipt({ approvalId: "release-b-approval-2002" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: targetReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(targetReceipt), ledgerDirectory: path.join(temporaryDirectory, "wrong-target"), transport: wrongTargetTransport, plan: frozenPlan }), /RELEASE_B_TARGET_MISMATCH/, "target mismatch is rejected before transaction");
  assert.equal(wrongTargetTransport.state.transactionCount, 0);
  await assertLedgerAbsent(targetReceipt.approvalId, "target mismatch leaves no consumed ledger entry");

  const beforeBeginTransport = createTransport();
  beforeBeginTransport.transaction = async () => {
    beforeBeginTransport.state.transactionCount += 1;
    throw failure("ECONNRESET", "connection lost before BEGIN");
  };
  const beforeBeginReceipt = receipt({ approvalId: "release-b-approval-5100" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: beforeBeginReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(beforeBeginReceipt), transport: beforeBeginTransport, plan: frozenPlan }), (error) => error.code === "RELEASE_B_EXECUTION_AMBIGUOUS", "before-BEGIN connection loss is consumed and ambiguous");
  assert.equal(beforeBeginTransport.state.transactionCount, 1, "before-BEGIN connection loss is attempted once");
  await assertStartedLedger(beforeBeginReceipt.approvalId, hashAuthorizationReceipt(beforeBeginReceipt));
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: beforeBeginReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(beforeBeginReceipt), transport: beforeBeginTransport, plan: frozenPlan }), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/, "before-BEGIN connection loss cannot retry");
  assert.equal(beforeBeginTransport.state.transactionCount, 1, "before-BEGIN consumed approval performs no retry");

  const authFailureTransport = createTransport();
  authFailureTransport.transaction = async () => {
    authFailureTransport.state.transactionCount += 1;
    throw failure("28P01", "transaction authentication failed");
  };
  const authFailureReceipt = receipt({ approvalId: "release-b-approval-5101" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: authFailureReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(authFailureReceipt), transport: authFailureTransport, plan: frozenPlan }), /transaction authentication failed/, "transaction authentication failure is consumed without retry");
  assert.equal(authFailureTransport.state.transactionCount, 1);
  await assertStartedLedger(authFailureReceipt.approvalId, hashAuthorizationReceipt(authFailureReceipt));
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: authFailureReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(authFailureReceipt), transport: authFailureTransport, plan: frozenPlan }), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/);
  assert.equal(authFailureTransport.state.transactionCount, 1, "transaction authentication failure performs no retry");

  const failingTransport = createTransport({ failEntity: "evidence" });
  const failedReceipt = receipt({ approvalId: "release-b-approval-2003" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: failedReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(failedReceipt), ledgerDirectory: path.join(temporaryDirectory, "rollback"), transport: failingTransport, plan: frozenPlan }), /simulated evidence constraint failure/, "a constraint failure rolls back every pending Release B row");
  assert.deepEqual(failingTransport.state.writes, [], "failed production transaction leaves zero partial committed rows");
  assert.equal(failingTransport.state.rollbackCount, 1);
  await assertStartedLedger(failedReceipt.approvalId, hashAuthorizationReceipt(failedReceipt));
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: failedReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(failedReceipt), ledgerDirectory: path.join(temporaryDirectory, "rollback"), transport: failingTransport, plan: frozenPlan }), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/, "a failed or ambiguous outcome remains consumed and cannot retry");
  assert.equal(failingTransport.state.transactionCount, 1, "deterministic write failure performs no retry");

  const afterWriteLossTransport = createTransport();
  afterWriteLossTransport.transaction = async (work) => {
    afterWriteLossTransport.state.transactionCount += 1;
    await work({
      async readPrecheckForUpdate() { return { releaseAHistory: "PRESENT", schemaPostconditions: "PASS", releaseBApplied: false, counts: RELEASE_B_FROZEN.expectedBeforeCounts }; },
      async upsert(entity, row) {
        afterWriteLossTransport.state.writes.push({ entity, row });
        throw failure("ECONNRESET", "connection lost after first write");
      },
    });
  };
  const afterWriteLossReceipt = receipt({ approvalId: "release-b-approval-5102" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: afterWriteLossReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(afterWriteLossReceipt), transport: afterWriteLossTransport, plan: frozenPlan }), (error) => error.code === "RELEASE_B_EXECUTION_AMBIGUOUS", "connection loss after first write is ambiguous");
  assert.equal(afterWriteLossTransport.state.transactionCount, 1);
  assert.equal(afterWriteLossTransport.state.writes.length, 1, "after-write loss stops after the first attempted write");
  await assertStartedLedger(afterWriteLossReceipt.approvalId, hashAuthorizationReceipt(afterWriteLossReceipt));
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: afterWriteLossReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(afterWriteLossReceipt), transport: afterWriteLossTransport, plan: frozenPlan }), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/);
  assert.equal(afterWriteLossTransport.state.transactionCount, 1, "after-write connection loss performs no retry");

  const rollbackFailureTransport = createTransport();
  rollbackFailureTransport.transaction = async () => {
    rollbackFailureTransport.state.transactionCount += 1;
    rollbackFailureTransport.state.rollbackCount += 1;
    throw failure("TRANSPORT_AFTER_FIRST_WRITE", "rollback acknowledgement lost after write failure");
  };
  const rollbackFailureReceipt = receipt({ approvalId: "release-b-approval-5103" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: rollbackFailureReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(rollbackFailureReceipt), transport: rollbackFailureTransport, plan: frozenPlan }), (error) => error.code === "RELEASE_B_EXECUTION_AMBIGUOUS", "rollback failure after a write is ambiguous");
  assert.equal(rollbackFailureTransport.state.transactionCount, 1);
  assert.equal(rollbackFailureTransport.state.rollbackCount, 1);
  await assertStartedLedger(rollbackFailureReceipt.approvalId, hashAuthorizationReceipt(rollbackFailureReceipt));
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: rollbackFailureReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(rollbackFailureReceipt), transport: rollbackFailureTransport, plan: frozenPlan }), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/);
  assert.equal(rollbackFailureTransport.state.transactionCount, 1, "rollback failure performs no retry");

  const timeoutTransport = createTransport();
  timeoutTransport.transaction = async () => { const error = new Error("transport timeout"); error.code = "TRANSPORT_TIMEOUT"; throw error; };
  const timeoutReceipt = receipt({ approvalId: "release-b-approval-2004" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: timeoutReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(timeoutReceipt), ledgerDirectory: path.join(temporaryDirectory, "timeout"), transport: timeoutTransport, plan: frozenPlan }), (error) => error.code === "RELEASE_B_EXECUTION_AMBIGUOUS", "transport timeout is ambiguous and cannot become a retry");
  await assertStartedLedger(timeoutReceipt.approvalId, hashAuthorizationReceipt(timeoutReceipt));

  const postcheckLossTransport = createTransport();
  let postcheckLossAttempts = 0;
  postcheckLossTransport.readPostcheck = async () => {
    postcheckLossAttempts += 1;
    const error = new Error("provider unknown after commit");
    error.code = "PROVIDER_UNKNOWN";
    throw error;
  };
  const postcheckLossReceipt = receipt({ approvalId: "release-b-approval-2005" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: postcheckLossReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(postcheckLossReceipt), ledgerDirectory: path.join(temporaryDirectory, "postcheck-loss"), transport: postcheckLossTransport, plan: frozenPlan }), (error) => error.code === "RELEASE_B_EXECUTION_AMBIGUOUS", "post-commit provider loss is classified as an ambiguous consumed execution");
  assert.equal(postcheckLossTransport.state.transactionCount, 1);
  assert.equal(postcheckLossAttempts, 1, "postcheck provider loss is attempted exactly once");
  await assertStartedLedger(postcheckLossReceipt.approvalId, hashAuthorizationReceipt(postcheckLossReceipt));
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: postcheckLossReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(postcheckLossReceipt), ledgerDirectory: path.join(temporaryDirectory, "another-directory"), transport: postcheckLossTransport, plan: frozenPlan }), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/, "post-commit transport loss cannot retry in another supplied directory");
  assert.equal(postcheckLossTransport.state.transactionCount, 1, "postcheck provider loss performs no retry");
  assert.equal(postcheckLossAttempts, 1, "postcheck provider loss performs no second verification");

  const postcheckMismatchTransport = createTransport();
  postcheckMismatchTransport.readPostcheck = async () => {
    postcheckMismatchTransport.state.postcheckCount += 1;
    return { counts: { ...RELEASE_B_FROZEN.expectedAfterCounts, devices: 23 }, uniqueSlugs: 24, publishedDevices: 24, conflictInvariants: "PASS", rayBanIdentity: "ray-ban-meta", unexpectedDeletes: 0 };
  };
  const postcheckMismatchReceipt = receipt({ approvalId: "release-b-approval-5104" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: postcheckMismatchReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(postcheckMismatchReceipt), transport: postcheckMismatchTransport, plan: frozenPlan }), (error) => error.code === "RELEASE_B_POSTCOMMIT_VERIFICATION_BLOCKED", "deterministic postcheck mismatch is verification-blocked, not ambiguous");
  assert.equal(postcheckMismatchTransport.state.transactionCount, 1);
  assert.equal(postcheckMismatchTransport.state.postcheckCount, 1);
  await assertStartedLedger(postcheckMismatchReceipt.approvalId, hashAuthorizationReceipt(postcheckMismatchReceipt));
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: postcheckMismatchReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(postcheckMismatchReceipt), transport: postcheckMismatchTransport, plan: frozenPlan }), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/);
  assert.equal(postcheckMismatchTransport.state.transactionCount, 1, "postcheck mismatch performs no retry");
  assert.equal(postcheckMismatchTransport.state.postcheckCount, 1, "postcheck mismatch performs no second verification");

  for (const [index, failure] of [{ code: "ECONNRESET" }, { code: "EPIPE" }, { code: "ETIMEDOUT" }, { code: "57P01" }, { code: "TRANSPORT_DISCONNECTED" }, { code: "NETWORK_LOST" }, { sqlState: "57P01" }].entries()) {
    const code = failure.code ?? failure.sqlState;
    for (const phase of ["transaction", "readPostcheck"]) {
      const transport = createTransport();
      let calls = 0;
      transport[phase] = async () => { calls++; throw Object.assign(new Error("native failure"), failure); };
      const authorizationReceipt = receipt({ approvalId: `release-b-approval-${3000 + index * 2 + (phase === "transaction" ? 0 : 1)}` });
      const input = { args: ["--execute-production"], authorizationReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(authorizationReceipt), transport };
      await assert.rejects(() => executeReleaseBProductionImport(input), (error) => error.code === "RELEASE_B_EXECUTION_AMBIGUOUS", `${code} during ${phase} is ambiguous`);
      await assertStartedLedger(authorizationReceipt.approvalId, hashAuthorizationReceipt(authorizationReceipt));
      await assert.rejects(() => executeReleaseBProductionImport(input), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/);
      assert.equal(calls, 1, "native transport failures never retry");
    }
  }

  const adapterDrift = createActualAdapterTransport({ precheck: { releaseAHistory: "PRESENT", schemaPostconditions: "PASS", releaseBApplied: false, counts: { ...RELEASE_B_FROZEN.expectedBeforeCounts, devices: 1 } } });
  const adapterDriftReceipt = receipt({ approvalId: "release-b-approval-4101" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: adapterDriftReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(adapterDriftReceipt), transport: adapterDrift.transport }), (error) => error.code === "RELEASE_B_PRODUCTION_PRECONDITION_DRIFT", "the actual adapter preserves the locked precheck mismatch after an acknowledged rollback");
  assert.equal(adapterDrift.state.queries.at(-1), "ROLLBACK;", "a precheck mismatch through the actual adapter receives an explicit rollback acknowledgement");
  assert.equal(adapterDrift.state.queries.some((sql) => sql.startsWith("INSERT INTO")), false, "a transaction-bound precheck mismatch sends no write through the actual adapter");

  const adapterCommitLoss = createActualAdapterTransport({ failCommitAck: true });
  const adapterCommitLossReceipt = receipt({ approvalId: "release-b-approval-4102" });
  const adapterCommitLossInput = { args: ["--execute-production"], authorizationReceipt: adapterCommitLossReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(adapterCommitLossReceipt), transport: adapterCommitLoss.transport };
  await assert.rejects(() => executeReleaseBProductionImport(adapterCommitLossInput), (error) => error.code === "RELEASE_B_EXECUTION_AMBIGUOUS", "the actual adapter maps a lost commit acknowledgement to an ambiguous execution");
  assert.equal(adapterCommitLoss.state.queries.includes("ROLLBACK;"), false, "a lost commit acknowledgement never claims rollback");
  await assertStartedLedger(adapterCommitLossReceipt.approvalId, hashAuthorizationReceipt(adapterCommitLossReceipt));
  const transactionBeginsBeforeRetry = adapterCommitLoss.state.queries.filter((sql) => sql.startsWith("BEGIN;")).length;
  await assert.rejects(() => executeReleaseBProductionImport(adapterCommitLossInput), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/, "a commit-ambiguous approval is consumed and cannot open a retry transaction");
  assert.equal(adapterCommitLoss.state.queries.filter((sql) => sql.startsWith("BEGIN;")).length, transactionBeginsBeforeRetry, "the consumed ambiguous approval performs no second adapter transaction");

  const sessionSql = [];
  const driftState = { releaseAHistory: "PRESENT", schemaPostconditions: "PASS", releaseBApplied: true, counts: { ...RELEASE_B_FROZEN.expectedBeforeCounts, devices: 1 } };
  const lockedTransport = createReleaseBDisposableTransport({
    executeSql: async () => { throw new Error("precheck must use the open transaction session"); },
    createSession: () => ({
      async query(sql) { sessionSql.push(sql); return `payload\n${Buffer.from(JSON.stringify(driftState)).toString("hex")}\n`; },
      async close() {},
    }),
    beforeCounts: { ...RELEASE_B_FROZEN.expectedBeforeCounts }, afterCounts: { ...RELEASE_B_FROZEN.expectedAfterCounts },
  });
  const lockedReceipt = receipt({ approvalId: "release-b-approval-2007" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: lockedReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(lockedReceipt), transport: lockedTransport }), /RELEASE_B_PRODUCTION_PRECONDITION_DRIFT/, "actual transaction-session counts override invented caller counts");
  assert.match(sessionSql[0], /^BEGIN;/);
  assert.match(sessionSql[1], /LOCK TABLE public\.devices/);
  assert.match(sessionSql[1], /SHARE ROW EXCLUSIVE MODE/);
  assert.match(sessionSql[1], /SELECT count\(\*\).*public\.devices/);
  assert.equal(sessionSql.at(-1), "ROLLBACK;");
  assert.ok(sessionSql.every((sql) => !sql.includes("INSERT INTO")), "drift is rejected before any SQL write");
} finally {
  await fixture.close();
  if (canonicalLedgerSentinelChecked) assert.equal(canonicalAccesses, 2, "the injected test executor and cleanup never access the canonical ledger");
  for (const [method, original] of originals) fs[method] = original;
  syncBuiltinESMExports();
}

console.log("DEVICE_SCHEMA_V1_TRANSACTION_CONTRACT_OK canonical_ledger_access=0 ambiguous_no_retry_cases=14");
