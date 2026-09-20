import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import * as executor from "./release-b-production-import.mjs";

// Synthetic receipts and stores exist only in owned temporary test directories.
export async function createReleaseBTestFixture() {
  assert.equal(typeof executor.createReleaseBImportExecutor, "function", "RELEASE_B_TEST_CONSUMPTION_INJECTION_REQUIRED");
  const root = await mkdtemp(path.join(os.tmpdir(), "openglass-release-b-test-"));
  const directory = path.join(root, "test-consumption");
  const canonicalSandbox = path.join(root, "canonical-ledger");
  await mkdir(canonicalSandbox);
  const sentinel = path.join(canonicalSandbox, "release-b-approval-20260917.json");
  const sentinelBytes = '{"approvalId":"release-b-approval-20260917","status":"STARTED"}\n';
  await writeFile(sentinel, sentinelBytes, { flag: "wx" });
  const frozen = await executor.loadTask17FrozenGate();
  const executionSurface = await executor.computeReleaseBExecutionSurfaceFingerprints();
  return {
    root, directory, frozen, canonicalSandbox,
    execute: executor.createReleaseBImportExecutor({ consumptionStore: executor.createReleaseBConsumptionStore(directory) }),
    receipt(overrides = {}) {
      return {
        schemaVersion: executor.AUTHORIZATION_RECEIPT_SCHEMA_VERSION, approvalId: "release-b-approval-20260917", authorizedAtUtc: "2026-09-17T04:15:00Z",
        targetProjectRef: frozen.targetProjectRef, targetClass: frozen.targetClass, task17Commit: "ddb7de82c7cb4f76adc79fdb7f2a6410ec6b4c4a",
        gateSourceCommit: frozen.sourceCommit, normalizedPayloadSha256: frozen.normalizedPayloadSha256, dryRunFingerprint: frozen.dryRunFingerprint,
        identityMapFingerprint: frozen.identityMapFingerprint, sourceMetadataFingerprint: frozen.sourceMetadataFingerprint,
        conflictMapFingerprint: frozen.conflictMapFingerprint, importerCodeFingerprint: frozen.importerCodeFingerprint,
        expectedBeforeCounts: { ...frozen.expectedBeforeCounts }, expectedAfterCounts: { ...frozen.expectedAfterCounts },
        authorizedOperation: "RELEASE_B_PRODUCTION_IMPORT", maxAttempts: 1, allowDeletes: false, allowSchemaMutation: false,
        allowMigrationHistoryMutation: false, allowCloudflareWrites: false, allowDeployment: false, allowPush: false,
        allowMerge: false, allowQaProd: false, automaticRetry: false,
        task18TransportCommit: executionSurface.task18TransportCommit,
        task18ExecutorCommit: executionSurface.task18ExecutorCommit,
        productionTransportFingerprint: executionSurface.productionTransportFingerprint,
        productionExecutorFingerprint: executionSurface.productionExecutorFingerprint,
        ...overrides,
      };
    },
    async close() {
      assert.equal(await readFile(sentinel, "utf8"), sentinelBytes, "the preexisting canonical-namespace STARTED sentinel survives the suite byte-for-byte");
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
      assert.ok(path.basename(root).startsWith("openglass-release-b-test-"));
      await rm(root, { recursive: true, force: true });
    },
  };
}
