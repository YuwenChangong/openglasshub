import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runLegalLocalPredeploymentReplay, LEGAL_LOCAL_EXECUTION_APPROVAL } from "./lib/legal-local-predeployment-orchestrator.mjs";
import { sha256 } from "./lib/legal-local-replay-evidence.mjs";

const root = process.cwd();
const taskId = "r6-local-predeployment-11111111-2222-4333-8444-555555555555";
const hash = (character) => character.repeat(64);
const target = () => ({ schemaVersion: "legal-nonproduction-target-binding-v2", providerClass: "LOCAL_ISOLATED_NON_PRODUCTION", environmentClassification: "LOCAL_ISOLATED_NON_PRODUCTION", environmentPurpose: "LEGAL_PREDEPLOYMENT_MIGRATION_REPLAY", taskId, implementationCommit: "9b489d37183fa9b172933ae32fe9d57432b995d2", targetIdentityHash: hash("a"), hostIdentityHash: hash("b"), databaseIdentityHash: hash("c"), networkIdentityHash: hash("d"), engine: "postgresql", engineVersion: "17.6", createdAt: "2026-08-06T00:00:00.000Z", expiresAt: "2027-08-06T00:00:00.000Z", disposable: true, persistentBusinessData: false, productionCredentialsPresent: false, productionNetworkAccessRequired: false, productionIdentityComparison: { source: "LOCAL_ISOLATION_FALLBACK", targetIdentityDifferent: true, hostIdentityDifferent: true, databaseIdentityDifferent: true, networkIdentityDifferent: true, productionProjectReferenceAbsent: true, productionConnectionStringAbsent: true, productionCredentialsAbsent: true }, localAddressClass: "LOOPBACK", containerRuntime: "docker", containerRuntimeVersion: "29.6", containerIdentityHash: hash("e"), containerTaskOwned: true, networkTaskOwned: true, externalDatabaseConnectionAllowed: false });
function adapter({ migrationFailureAt = null, smokeFailure = false, cleanupFailure = false, fresh = true } = {}) {
  let migrationCount = 0;
  return {
    calls: [],
    async assertFreshTask() { this.calls.push("fresh"); return fresh; },
    async createLocalTarget() { this.calls.push("create"); return target(); },
    async capturePristineFingerprint() { this.calls.push("pristine"); return { schemaVersion: "local-bootstrap-fingerprint-v1", fingerprintSha256: hash("1"), migrationHistorySha256: hash("2") }; },
    async destroyTarget() { this.calls.push("destroy"); },
    async rebuildTarget() { this.calls.push("rebuild"); return { containerIdentityHash: hash("f") }; },
    async verifyRebuild({ targetBindingSha256 }) { this.calls.push("verify"); return { schemaVersion: "legal-local-nonproduction-rebuild-restore-evidence-v1", taskId, implementationCommit: "9b489d37183fa9b172933ae32fe9d57432b995d2", targetBindingSha256, bootstrapFingerprintSha256: hash("1"), preMigrationFingerprintSha256: hash("2"), rebuiltFingerprintSha256: hash("2"), destroyedContainerIdentityHash: hash("e"), rebuiltContainerIdentityHash: hash("f"), bootstrappedAtUtc: "2026-08-06T00:00:00.000Z", destroyedAtUtc: "2026-08-06T00:00:01.000Z", rebuiltAtUtc: "2026-08-06T00:00:02.000Z", destroyObserved: true, rebuildObserved: true, restoreSmoke: { databaseReachable: true, migrationHistoryReadable: true, requiredSchemasPresent: true, fingerprintRecomputed: true } }; },
    async captureCatalogFingerprint() { return { catalogSha256: hash("3") }; },
    async applyMigration() { migrationCount += 1; this.calls.push(`migration-${migrationCount}`); return { success: migrationFailureAt !== migrationCount, transactionResult: migrationFailureAt === migrationCount ? "FAILED" : "COMMITTED", exitCode: migrationFailureAt === migrationCount ? 1 : 0, historyEntryResult: migrationFailureAt === migrationCount ? "ABSENT" : "PRESENT" }; },
    async runSmokeCheck({ check }) { this.calls.push(`smoke-${check}`); return { identityClass: "TASK_OWNED_SYNTHETIC", expected: "PASS", observed: smokeFailure ? "FAIL" : "PASS", classification: smokeFailure ? "FAILED" : "READY" }; },
    async cleanupTestData() { this.calls.push("cleanup-data"); return { remaining: 0, unexpectedAffected: 0 }; },
    async cleanupTaskResources() { this.calls.push("cleanup-resources"); return { remainingContainerCount: cleanupFailure ? 1 : 0, remainingVolumeCount: 0, remainingNetworkCount: 0, unrelatedResourcesChanged: 0 }; },
  };
}

const preflight = await runLegalLocalPredeploymentReplay({ repositoryRoot: root });
assert.equal(preflight.classification, "R6_LOCAL_NONPRODUCTION_PREFLIGHT_READY"); assert.equal(preflight.executionAuthorized, false);
const run = async (options = {}) => { const parentRoot = await mkdtemp(path.join(os.tmpdir(), "r6-local-orchestrator-test-")); const taskRoot = path.join(parentRoot, "fresh-task"); const localAdapter = adapter(options); try { const result = await runLegalLocalPredeploymentReplay({ mode: "EXECUTE", taskId, taskRoot, confirmation: LEGAL_LOCAL_EXECUTION_APPROVAL, confirmationSha256: sha256(LEGAL_LOCAL_EXECUTION_APPROVAL), implementationCommit: "9b489d37183fa9b172933ae32fe9d57432b995d2", repositoryRoot: root, adapter: localAdapter, now: (() => { let second = 0; return () => `2026-08-06T00:00:${String(second++).padStart(2, "0")}.000Z`; })() }); return { result, localAdapter, evidence: await readdir(path.join(taskRoot, "evidence")) }; } finally { await rm(parentRoot, { recursive: true, force: true }); } };
const complete = await run(); assert.equal(complete.result.classification, "R6_LOCAL_PREDEPLOYMENT_LIVE_ORCHESTRATION_READY"); assert.equal(complete.result.readiness.classification, "R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_COMPLETE_PRODUCTION_FINGERPRINT_REQUIRED"); assert.equal(complete.localAdapter.calls.filter((call) => call.startsWith("migration-")).length, 12); assert.equal(complete.localAdapter.calls.filter((call) => call.startsWith("smoke-")).length, 14); assert(complete.evidence.includes("orchestrator-terminal.json"));
const migrationFailure = await run({ migrationFailureAt: 3 }); assert.equal(migrationFailure.result.classification, "R6_LOCAL_NONPRODUCTION_MIGRATION_REPLAY_INCOMPLETE"); assert.equal(migrationFailure.localAdapter.calls.includes("migration-4"), false); assert.equal(migrationFailure.localAdapter.calls.some((call) => call.startsWith("smoke-")), false);
const smokeFailure = await run({ smokeFailure: true }); assert.equal(smokeFailure.result.classification, "R6_LOCAL_NONPRODUCTION_LEGAL_SMOKE_INCOMPLETE");
const cleanupFailure = await run({ cleanupFailure: true }); assert.equal(cleanupFailure.result.classification, "R6_LOCAL_NONPRODUCTION_RESOURCE_CLEANUP_INCOMPLETE"); assert.equal(cleanupFailure.localAdapter.calls.includes("cleanup-resources"), true);
await assert.rejects(() => runLegalLocalPredeploymentReplay({ mode: "EXECUTE", taskId, taskRoot: path.join(os.tmpdir(), "r6-no-confirmation"), confirmation: "wrong", confirmationSha256: sha256("wrong"), implementationCommit: "9b489d37183fa9b172933ae32fe9d57432b995d2", repositoryRoot: root, adapter: adapter() }), (error) => error.code === "R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED");
console.log(JSON.stringify({ classification: "R6_LOCAL_PREDEPLOYMENT_ORCHESTRATOR_CONTRACT_TESTS_READY", scenarios: 6, realOperations: 0 }));
