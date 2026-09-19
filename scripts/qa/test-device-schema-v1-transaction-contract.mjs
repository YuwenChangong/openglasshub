import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSchemaV1RecoveryPlan } from "../devices/import-device-schema-v1.mjs";
import { fingerprintRecoveryPlan } from "../devices/schema-v1/dry-run.mjs";

let productionExecutor;
try {
  productionExecutor = await import("./release-b-production-import.mjs");
} catch (error) {
  const blocker = new Error("RELEASE_B_PRODUCTION_EXECUTOR_MISSING");
  blocker.cause = error;
  throw blocker;
}

const { AUTHORIZATION_RECEIPT_SCHEMA_VERSION, RELEASE_B_FROZEN, executeReleaseBProductionImport, hashAuthorizationReceipt } = productionExecutor;
const TASK_17_COMMIT = "ddb7de82c7cb4f76adc79fdb7f2a6410ec6b4c4a";

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
    allowDeployment: false, allowPush: false, allowMerge: false, allowQaProd: false, ...overrides,
  };
}

function createTransport({ failEntity, target = { projectRef: "xcbnxzjlsvtgzixurcof", targetClass: "OpenGlass Hub Supabase Production" }, beforeCounts = RELEASE_B_FROZEN.expectedBeforeCounts } = {}) {
  const state = { writes: [], transactionCount: 0, rollbackCount: 0 };
  return {
    state,
    async identifyTarget() { return target; },
    async readPrecheck() { return { releaseAHistory: "PRESENT", schemaPostconditions: "PASS", releaseBApplied: false, counts: beforeCounts }; },
    async transaction(work) {
      state.transactionCount += 1;
      const pending = [];
      try {
        await work({ async upsert(entity, row) { if (entity === failEntity) throw new Error(`simulated ${entity} constraint failure`); pending.push({ entity, row }); } });
        state.writes.push(...pending);
      } catch (error) { state.rollbackCount += 1; throw error; }
    },
    async readPostcheck() { return { counts: { ...RELEASE_B_FROZEN.expectedAfterCounts }, uniqueSlugs: 24, publishedDevices: 24, conflictInvariants: "PASS", rayBanIdentity: "ray-ban-meta", unexpectedDeletes: 0 }; },
  };
}

const recoveryPlan = await buildSchemaV1RecoveryPlan();
const frozenPlan = { ...recoveryPlan, normalizedPayloadSha256: RELEASE_B_FROZEN.normalizedPayloadSha256, dryRunFingerprint: fingerprintRecoveryPlan(recoveryPlan) };
assert.equal(frozenPlan.dryRunFingerprint, RELEASE_B_FROZEN.dryRunFingerprint, "the test rebuild uses the committed Task 17 frozen plan");
assert.match(hashAuthorizationReceipt(receipt()), /^[a-f0-9]{64}$/, "authorization receipts have a stable content-address");

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "openglass-release-b-production-contract-"));
try {
  const validTransport = createTransport();
  const valid = await executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: receipt(), authorizationReceiptSha256: hashAuthorizationReceipt(receipt()), ledgerDirectory: temporaryDirectory, transport: validTransport, plan: frozenPlan });
  assert.equal(valid.status, "COMMITTED", "one valid authorization applies the frozen plan atomically through the injected transport");
  assert.equal(validTransport.state.transactionCount, 1, "the valid production contract opens exactly one transaction");
  assert.ok(validTransport.state.writes.every((write) => ["definition", "device", "source", "sourceLink", "spec", "evidence", "compatibility"].includes(write.entity)), "the coordinator permits only approved Release B entity classes");
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: receipt(), authorizationReceiptSha256: hashAuthorizationReceipt(receipt()), ledgerDirectory: temporaryDirectory, transport: validTransport, plan: frozenPlan }), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/, "the same authorization cannot write twice");
  assert.equal(validTransport.state.transactionCount, 1, "a consumed approval cannot open a second transaction");

  const rejectedCases = [
    ["missing explicit execution flag", { args: [] }, /RELEASE_B_EXECUTION_FLAG_REQUIRED/],
    ["invalid approval ID", { authorizationReceipt: receipt({ approvalId: "release-b-approval-1-extra" }) }, /INVALID_RELEASE_B_APPROVAL_ID/],
    ["missing authorization timestamp", { authorizationReceipt: receipt({ authorizedAtUtc: undefined }) }, /INVALID_RELEASE_B_AUTHORIZED_AT_UTC/],
    ["non-Z timestamp", { authorizationReceipt: receipt({ authorizedAtUtc: "2026-09-17T04:15:00+00:00" }) }, /INVALID_RELEASE_B_AUTHORIZED_AT_UTC/],
    ["malformed UTC timestamp", { authorizationReceipt: receipt({ authorizedAtUtc: "2026-09-17T25:15:00Z" }) }, /INVALID_RELEASE_B_AUTHORIZED_AT_UTC/],
    ["Task 17 commit mismatch", { authorizationReceipt: receipt({ task17Commit: "0".repeat(40) }) }, /TASK_17_COMMIT_MISMATCH/],
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

  const driftTransport = createTransport({ beforeCounts: { ...RELEASE_B_FROZEN.expectedBeforeCounts, devices: 1 } });
  const driftReceipt = receipt({ approvalId: "release-b-approval-2001" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: driftReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(driftReceipt), ledgerDirectory: path.join(temporaryDirectory, "drift"), transport: driftTransport, plan: frozenPlan }), /RELEASE_B_PRODUCTION_PRECONDITION_DRIFT/, "before-count drift rejects before the transaction");
  assert.equal(driftTransport.state.transactionCount, 0);

  const wrongTargetTransport = createTransport({ target: { projectRef: "wrong-project", targetClass: "OpenGlass Hub Supabase Production" } });
  const targetReceipt = receipt({ approvalId: "release-b-approval-2002" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: targetReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(targetReceipt), ledgerDirectory: path.join(temporaryDirectory, "wrong-target"), transport: wrongTargetTransport, plan: frozenPlan }), /RELEASE_B_TARGET_MISMATCH/, "target mismatch is rejected before transaction");
  assert.equal(wrongTargetTransport.state.transactionCount, 0);

  const failingTransport = createTransport({ failEntity: "evidence" });
  const failedReceipt = receipt({ approvalId: "release-b-approval-2003" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: failedReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(failedReceipt), ledgerDirectory: path.join(temporaryDirectory, "rollback"), transport: failingTransport, plan: frozenPlan }), /simulated evidence constraint failure/, "a constraint failure rolls back every pending Release B row");
  assert.deepEqual(failingTransport.state.writes, [], "failed production transaction leaves zero partial committed rows");
  assert.equal(failingTransport.state.rollbackCount, 1);
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: failedReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(failedReceipt), ledgerDirectory: path.join(temporaryDirectory, "rollback"), transport: failingTransport, plan: frozenPlan }), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/, "a failed or ambiguous outcome remains consumed and cannot retry");
} finally { await rm(temporaryDirectory, { recursive: true, force: true }); }

console.log("DEVICE_SCHEMA_V1_TRANSACTION_CONTRACT_OK cases=17");
