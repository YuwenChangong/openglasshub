import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { buildSchemaV1RecoveryPlan } from "../devices/import-device-schema-v1.mjs";
import { fingerprintRecoveryPlan } from "../devices/schema-v1/dry-run.mjs";
import { createReleaseBDisposableTransport } from "./release-b-disposable-transport.mjs";
import { createReleaseBTestFixture } from "./release-b-test-fixture.mjs";

let productionExecutor;
try {
  productionExecutor = await import("./release-b-production-import.mjs");
} catch (error) {
  const blocker = new Error("RELEASE_B_PRODUCTION_EXECUTOR_MISSING");
  blocker.cause = error;
  throw blocker;
}

const { AUTHORIZATION_RECEIPT_SCHEMA_VERSION, PRODUCTION_LEDGER_DIRECTORY, hashAuthorizationReceipt, loadTask17FrozenGate } = productionExecutor;
const fixture = await createReleaseBTestFixture();
// Canonical filesystem calls are redirected only for a default-executor sentinel
// check, then prohibited entirely. The real durable ledger is never accessed.
let sandboxCanonical = true;
let canonicalAccesses = 0;
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
        await work({
          async readPrecheckForUpdate() { return { releaseAHistory: "PRESENT", schemaPostconditions: "PASS", releaseBApplied: false, counts: beforeCounts }; },
          async upsert(entity, row) { if (entity === failEntity) throw new Error(`simulated ${entity} constraint failure`); pending.push({ entity, row }); },
        });
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

const temporaryDirectory = fixture.directory;
try {
  const canonicalTransport = createTransport();
  await assert.rejects(() => productionExecutor.executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: receipt(), authorizationReceiptSha256: hashAuthorizationReceipt(receipt()), transport: canonicalTransport }), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/, "a preexisting canonical STARTED approval blocks the default production entry point");
  assert.equal(canonicalTransport.state.transactionCount, 0);
  assert.equal(canonicalAccesses, 2, "default executor mkdir/open are safely redirected into the canonical namespace sandbox");
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
  assert.equal(driftTransport.state.transactionCount, 1, "the concurrency-safe precheck executes inside the one transaction before writes");
  assert.deepEqual(driftTransport.state.writes, []);

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

  const timeoutTransport = createTransport();
  timeoutTransport.transaction = async () => { const error = new Error("transport timeout"); error.code = "TRANSPORT_TIMEOUT"; throw error; };
  const timeoutReceipt = receipt({ approvalId: "release-b-approval-2004" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: timeoutReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(timeoutReceipt), ledgerDirectory: path.join(temporaryDirectory, "timeout"), transport: timeoutTransport, plan: frozenPlan }), (error) => error.code === "RELEASE_B_EXECUTION_AMBIGUOUS", "transport timeout is ambiguous and cannot become a retry");

  const postcheckLossTransport = createTransport();
  postcheckLossTransport.readPostcheck = async () => { const error = new Error("provider unknown after commit"); error.code = "PROVIDER_UNKNOWN"; throw error; };
  const postcheckLossReceipt = receipt({ approvalId: "release-b-approval-2005" });
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: postcheckLossReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(postcheckLossReceipt), ledgerDirectory: path.join(temporaryDirectory, "postcheck-loss"), transport: postcheckLossTransport, plan: frozenPlan }), (error) => error.code === "RELEASE_B_EXECUTION_AMBIGUOUS", "post-commit provider loss is classified as an ambiguous consumed execution");
  await assert.rejects(() => executeReleaseBProductionImport({ args: ["--execute-production"], authorizationReceipt: postcheckLossReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(postcheckLossReceipt), ledgerDirectory: path.join(temporaryDirectory, "another-directory"), transport: postcheckLossTransport, plan: frozenPlan }), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/, "post-commit transport loss cannot retry in another supplied directory");

  for (const [index, failure] of [{ code: "ECONNRESET" }, { code: "EPIPE" }, { code: "ETIMEDOUT" }, { code: "57P01" }, { code: "TRANSPORT_DISCONNECTED" }, { code: "NETWORK_LOST" }, { sqlState: "57P01" }].entries()) {
    const code = failure.code ?? failure.sqlState;
    for (const phase of ["transaction", "readPostcheck"]) {
      const transport = createTransport();
      let calls = 0;
      transport[phase] = async () => { calls++; throw Object.assign(new Error("native failure"), failure); };
      const authorizationReceipt = receipt({ approvalId: `release-b-approval-${3000 + index * 2 + (phase === "transaction" ? 0 : 1)}` });
      const input = { args: ["--execute-production"], authorizationReceipt, authorizationReceiptSha256: hashAuthorizationReceipt(authorizationReceipt), transport };
      await assert.rejects(() => executeReleaseBProductionImport(input), (error) => error.code === "RELEASE_B_EXECUTION_AMBIGUOUS", `${code} during ${phase} is ambiguous`);
      await assert.rejects(() => executeReleaseBProductionImport(input), /RELEASE_B_APPROVAL_ALREADY_CONSUMED/);
      assert.equal(calls, 1, "native transport failures never retry");
    }
  }

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
  assert.equal(canonicalAccesses, 2, "the injected test executor and cleanup never access the canonical ledger");
  for (const [method, original] of originals) fs[method] = original;
  syncBuiltinESMExports();
}

console.log("DEVICE_SCHEMA_V1_TRANSACTION_CONTRACT_OK canonical_ledger_access=0 ambiguous_no_retry_cases=14");
