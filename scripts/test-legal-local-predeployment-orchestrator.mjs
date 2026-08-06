import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runLegalLocalPredeploymentReplay } from "./lib/legal-local-predeployment-orchestrator.mjs";
import { createLegalLocalExecutionApproval } from "./lib/legal-local-execution-approval.mjs";

const root = process.cwd();
const implementationCommit = "9b489d37183fa9b172933ae32fe9d57432b995d2";
const taskIdFor = (suffix) => `r6-local-predeployment-11111111-2222-4333-8444-${suffix.toString().padStart(12, "0")}`;
const hash = (character) => character.repeat(64);
const target = (taskId) => ({ schemaVersion: "legal-nonproduction-target-binding-v2", providerClass: "LOCAL_ISOLATED_NON_PRODUCTION", environmentClassification: "LOCAL_ISOLATED_NON_PRODUCTION", environmentPurpose: "LEGAL_PREDEPLOYMENT_MIGRATION_REPLAY", taskId, implementationCommit, targetIdentityHash: hash("a"), hostIdentityHash: hash("b"), databaseIdentityHash: hash("c"), networkIdentityHash: hash("d"), engine: "postgresql", engineVersion: "17.6", createdAt: "2026-08-06T00:00:00.000Z", expiresAt: "2027-08-06T00:00:00.000Z", disposable: true, persistentBusinessData: false, productionCredentialsPresent: false, productionNetworkAccessRequired: false, productionIdentityComparison: { source: "LOCAL_ISOLATION_FALLBACK", targetIdentityDifferent: true, hostIdentityDifferent: true, databaseIdentityDifferent: true, networkIdentityDifferent: true, productionProjectReferenceAbsent: true, productionConnectionStringAbsent: true, productionCredentialsAbsent: true }, localAddressClass: "LOOPBACK", containerRuntime: "docker", containerRuntimeVersion: "29.6", containerIdentityHash: hash("e"), containerTaskOwned: true, networkTaskOwned: true, externalDatabaseConnectionAllowed: false });
function adapter({ migrationFailureAt = null, smokeFailure = false, cleanupFailure = false, fresh = true } = {}) {
  let migrationCount = 0;
  return {
    calls: [],
    async assertFreshTask() { this.calls.push("fresh"); return fresh; },
    async createLocalTarget({ task }) { this.calls.push("create"); return target(task.taskId); },
    async capturePristineFingerprint() { this.calls.push("pristine"); return { schemaVersion: "local-bootstrap-fingerprint-v1", fingerprintSha256: hash("1"), migrationHistorySha256: hash("2") }; },
    async destroyTarget() { this.calls.push("destroy"); },
    async rebuildTarget() { this.calls.push("rebuild"); return { containerIdentityHash: hash("f") }; },
    async verifyRebuild({ task, targetBindingSha256 }) { this.calls.push("verify"); return { schemaVersion: "legal-local-nonproduction-rebuild-restore-evidence-v1", taskId: task.taskId, implementationCommit, targetBindingSha256, bootstrapFingerprintSha256: hash("1"), preMigrationFingerprintSha256: hash("2"), rebuiltFingerprintSha256: hash("2"), destroyedContainerIdentityHash: hash("e"), rebuiltContainerIdentityHash: hash("f"), bootstrappedAtUtc: "2026-08-06T00:00:00.000Z", destroyedAtUtc: "2026-08-06T00:00:01.000Z", rebuiltAtUtc: "2026-08-06T00:00:02.000Z", destroyObserved: true, rebuildObserved: true, restoreSmoke: { databaseReachable: true, migrationHistoryReadable: true, requiredSchemasPresent: true, fingerprintRecomputed: true } }; },
    async captureCatalogFingerprint() { return { catalogSha256: hash("3") }; },
    async applyMigration() { migrationCount += 1; this.calls.push(`migration-${migrationCount}`); const failed = migrationFailureAt === migrationCount; return { success: !failed, transactionResult: failed ? "FAILED" : "COMMITTED", exitCode: failed ? 3 : 0, historyEntryResult: failed ? "ABSENT" : "PRESENT", stdinSha256: hash("9"), psqlFlags: ["-X", "-v", "ON_ERROR_STOP=1", "-f", "-"], stdout: "", stderr: failed ? "psql:<stdin>:1: ERROR:  42P01: relation does not exist\nLINE 1: alter table public.forum_notifications\n" : "", startedAt: "2026-08-06T00:00:00.000Z", completedAt: "2026-08-06T00:00:01.000Z", durationMs: 1, signal: null, spawnError: null }; },
    async runSmokeCheck({ check }) { this.calls.push(`smoke-${check}`); return { identityClass: "TASK_OWNED_SYNTHETIC", expected: "PASS", observed: smokeFailure ? "FAIL" : "PASS", classification: smokeFailure ? "FAILED" : "READY" }; },
    async cleanupTestData() { this.calls.push("cleanup-data"); return { remaining: 0, unexpectedAffected: 0 }; },
    async cleanupTaskResources() { this.calls.push("cleanup-resources"); return { remainingContainerCount: cleanupFailure ? 1 : 0, remainingVolumeCount: 0, remainingNetworkCount: 0, unrelatedResourcesChanged: 0 }; },
  };
}

const preflightTaskId = taskIdFor(1);
const preflight = await runLegalLocalPredeploymentReplay({ repositoryRoot: root, taskId: preflightTaskId, implementationCommit });
assert.equal(preflight.classification, "R6_LOCAL_NONPRODUCTION_PREFLIGHT_READY"); assert.equal(preflight.executionAuthorized, false); assert.equal(preflight.approvalContract.taskId, preflightTaskId);
let runNumber = 2;
const run = async (options = {}) => { const parentRoot = await mkdtemp(path.join(os.tmpdir(), "r6-local-orchestrator-test-")); const taskRoot = path.join(parentRoot, "fresh-task"); const taskId = options.taskId ?? taskIdFor(runNumber++); const localAdapter = adapter(options); const contract = createLegalLocalExecutionApproval({ implementationCommit, taskId, migrationInventorySha256: preflight.inventory.inventorySha256, issuedAt: "2026-08-06T00:00:00.000Z" }); try { const result = await runLegalLocalPredeploymentReplay({ mode: "EXECUTE", taskId, taskRoot, confirmation: options.confirmation ?? contract.requiredConfirmationPhrase, confirmationSha256: options.confirmationSha256 ?? contract.requiredConfirmationSha256, consumptionRegistryRoot: path.join(parentRoot, "registry"), implementationCommit, repositoryRoot: root, adapter: localAdapter, now: (() => { let second = 0; return () => `2026-08-06T00:00:${String(second++).padStart(2, "0")}.000Z`; })() }); return { result, localAdapter, evidence: await readdir(path.join(taskRoot, "evidence")) }; } finally { await rm(parentRoot, { recursive: true, force: true }); } };
const complete = await run(); assert.equal(complete.result.classification, "R6_LOCAL_PREDEPLOYMENT_LIVE_ORCHESTRATION_READY"); assert.equal(complete.result.readiness.classification, "R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_COMPLETE_PRODUCTION_FINGERPRINT_REQUIRED"); assert.equal(complete.localAdapter.calls.filter((call) => call.startsWith("migration-")).length, 12); assert.equal(complete.localAdapter.calls.filter((call) => call.startsWith("smoke-")).length, 14); assert(complete.evidence.includes("orchestrator-terminal.json"));
const migrationFailure = await run({ migrationFailureAt: 3 }); assert.equal(migrationFailure.result.classification, "R6_LOCAL_NONPRODUCTION_MIGRATION_REPLAY_INCOMPLETE"); assert.equal(migrationFailure.localAdapter.calls.includes("migration-4"), false); assert.equal(migrationFailure.localAdapter.calls.some((call) => call.startsWith("smoke-")), false); assert(migrationFailure.evidence.includes("migration-attempt-3-stderr.log")); assert.equal(migrationFailure.result.evidence.migrationTerminal.sha256.length, 64);
const smokeFailure = await run({ smokeFailure: true }); assert.equal(smokeFailure.result.classification, "R6_LOCAL_NONPRODUCTION_LEGAL_SMOKE_INCOMPLETE");
const cleanupFailure = await run({ cleanupFailure: true }); assert.equal(cleanupFailure.result.classification, "R6_LOCAL_NONPRODUCTION_RESOURCE_CLEANUP_INCOMPLETE"); assert.equal(cleanupFailure.localAdapter.calls.includes("cleanup-resources"), true);
const mismatchRoot = await mkdtemp(path.join(os.tmpdir(), "r6-local-approval-mismatch-"));
const mismatchTaskId = taskIdFor(99);
const mismatchContract = createLegalLocalExecutionApproval({ implementationCommit, taskId: mismatchTaskId, migrationInventorySha256: preflight.inventory.inventorySha256, issuedAt: "2026-08-06T00:00:00.000Z" });
const mismatchAdapter = adapter();
try {
  await assert.rejects(() => runLegalLocalPredeploymentReplay({ mode: "EXECUTE", taskId: mismatchTaskId, taskRoot: path.join(mismatchRoot, "task"), confirmation: `${mismatchContract.requiredConfirmationPhrase} `, confirmationSha256: mismatchContract.requiredConfirmationSha256, consumptionRegistryRoot: path.join(mismatchRoot, "registry"), implementationCommit, repositoryRoot: root, adapter: mismatchAdapter }), (error) => error.innerClassification === "LEGAL_LOCAL_EXECUTION_CONFIRMATION_MISMATCH");
  assert.equal(mismatchAdapter.calls.length, 0); await assert.rejects(() => runLegalLocalPredeploymentReplay({ mode: "EXECUTE", taskId: mismatchTaskId, taskRoot: path.join(mismatchRoot, "task"), confirmation: mismatchContract.requiredConfirmationPhrase, confirmationSha256: mismatchContract.requiredConfirmationSha256, consumptionRegistryRoot: path.join(mismatchRoot, "registry"), implementationCommit, repositoryRoot: root, adapter: mismatchAdapter }), (error) => error.innerClassification === "LEGAL_LOCAL_EXECUTION_TASK_ALREADY_CONSUMED");
  await assert.rejects(() => runLegalLocalPredeploymentReplay({ mode: "EXECUTE", taskId: "r6-local-predeployment-fc1a4df7-b1aa-4c5b-8347-fe16b423cf67", taskRoot: path.join(mismatchRoot, "historical"), confirmation: "x", confirmationSha256: "x", consumptionRegistryRoot: path.join(mismatchRoot, "registry"), implementationCommit, repositoryRoot: root, adapter: mismatchAdapter }), (error) => error.innerClassification === "LEGAL_LOCAL_EXECUTION_TASK_ALREADY_CONSUMED");
  assert.equal(mismatchAdapter.calls.length, 0);
} finally { await rm(mismatchRoot, { recursive: true, force: true }); }
console.log(JSON.stringify({ classification: "R6_LOCAL_PREDEPLOYMENT_ORCHESTRATOR_CONTRACT_TESTS_READY", scenarios: 8, realOperations: 0 }));
