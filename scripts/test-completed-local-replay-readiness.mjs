import assert from "node:assert/strict";
import { evaluateLegalPredeploymentReadiness } from "./lib/legal-predeployment-readiness.mjs";
import { resolveLegalPrelegalBaseline, createBoundaryCheckpointRequirements } from "./lib/legal-local-prelegal-baseline.mjs";
import { REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS } from "./lib/legal-local-smoke-runner.mjs";
import { LEGAL_LOCAL_SUPABASE_OPTIONAL_CAPABILITIES, LEGAL_LOCAL_SUPABASE_REQUIRED_CAPABILITIES, createLegalLocalSupabaseRuntimeManifest, createRuntimeCapabilityTerminal } from "./lib/legal-local-supabase-runtime.mjs";
import { sha256, stableJson } from "./lib/legal-local-replay-evidence.mjs";

const implementationCommit = "af3ee7c9473d940903ccb951bf4b2ce63334fea7";
const taskId = "r6-local-predeployment-11111111-2222-4333-8444-555555555555";
const hash = (character) => character.repeat(64);
const canonicalSha256 = (value) => sha256(`${stableJson(value)}\n`);
const baselineManifest = await resolveLegalPrelegalBaseline({ repositoryRoot: process.cwd(), implementationCommit, generatedAt: "2026-08-06T00:00:00.000Z" });
const targetBinding = {
  schemaVersion: "legal-nonproduction-target-binding-v2", providerClass: "LOCAL_ISOLATED_NON_PRODUCTION", environmentClassification: "LOCAL_ISOLATED_NON_PRODUCTION", environmentPurpose: "LEGAL_PREDEPLOYMENT_MIGRATION_REPLAY", taskId, implementationCommit,
  targetIdentityHash: hash("a"), hostIdentityHash: hash("b"), databaseIdentityHash: hash("c"), networkIdentityHash: hash("d"), engine: "postgresql", engineVersion: "17.6", createdAt: "2026-08-06T00:00:00.000Z", expiresAt: "2026-08-06T00:30:00.000Z", disposable: true, persistentBusinessData: false, productionCredentialsPresent: false, productionNetworkAccessRequired: false,
  productionIdentityComparison: { source: "LOCAL_ISOLATION_FALLBACK", targetIdentityDifferent: true, hostIdentityDifferent: true, databaseIdentityDifferent: true, networkIdentityDifferent: true, productionProjectReferenceAbsent: true, productionConnectionStringAbsent: true, productionCredentialsAbsent: true },
  localAddressClass: "TASK_OWNED_DOCKER_NETWORK", containerRuntime: "docker", containerRuntimeVersion: "29.6.1", containerIdentityHash: hash("e"), containerTaskOwned: true, networkTaskOwned: true, externalDatabaseConnectionAllowed: false,
};
const targetBindingSha256 = canonicalSha256(targetBinding);
const baselineManifestSha256 = canonicalSha256(baselineManifest);
const requirements = createBoundaryCheckpointRequirements();
const baselineTerminal = { schemaVersion: "legal-local-prelegal-baseline-terminal-v1", taskId, implementationCommit, baselineManifestSha256, baselineInventorySha256: baselineManifest.baselineInventorySha256, classification: "R6_LOCAL_PRELEGAL_BASELINE_EXECUTION_READY", planned: baselineManifest.baselineMigrationCount, executed: baselineManifest.baselineMigrationCount, successful: baselineManifest.baselineMigrationCount, failed: 0, skipped: 0, retries: 0 };
const baselineCheckpoint = { schemaVersion: "legal-local-prelegal-baseline-checkpoint-v1", taskId, implementationCommit, baselineManifestSha256, classification: "R6_LOCAL_PRELEGAL_BASELINE_CHECKPOINT_READY", relation: requirements.relation, columns: requirements.columns, constraints: requirements.constraints, functions: requirements.functions };
const baselineJournal = { schemaVersion: "legal-local-baseline-migration-journal-v1", taskId, implementationCommit, baselineInventorySha256: baselineManifest.baselineInventorySha256, entries: Array.from({ length: baselineManifest.baselineMigrationCount }, () => ({ classification: "READY", retryCount: 0 })) };
const rebuildRestoreEvidence = { schemaVersion: "legal-local-prelegal-baseline-rebuild-restore-evidence-v2", taskId, implementationCommit, targetBindingSha256, bootstrapFingerprintSha256: hash("f"), preMigrationFingerprintSha256: hash("a"), rebuiltFingerprintSha256: hash("a"), destroyedContainerIdentityHash: hash("e"), rebuiltContainerIdentityHash: hash("b"), bootstrappedAtUtc: "2026-08-06T00:01:00.000Z", destroyedAtUtc: "2026-08-06T00:02:00.000Z", rebuiltAtUtc: "2026-08-06T00:03:00.000Z", destroyObserved: true, rebuildObserved: true, restoreSmoke: { databaseReachable: true, migrationHistoryReadable: true, requiredSchemasPresent: true, fingerprintRecomputed: true }, baselineManifestSha256, baselineInventorySha256: baselineManifest.baselineInventorySha256, baselineCheckpointClassification: "R6_LOCAL_PRELEGAL_BASELINE_CHECKPOINT_READY", rebuiltBaselineCheckpointClassification: "R6_LOCAL_PRELEGAL_BASELINE_CHECKPOINT_READY", baselineReapplied: true };
const inventorySha256 = hash("c");
const migrationJournal = { schemaVersion: "legal-local-migration-journal-v2", taskId, implementationCommit, inventorySha256, entries: Array.from({ length: 12 }, () => ({ classification: "READY", retryCount: 0 })) };
const migrationTerminal = { schemaVersion: "legal-local-migration-terminal-v2", taskId, implementationCommit, targetBindingSha256, inventorySha256, journalSha256: canonicalSha256(migrationJournal), classification: "R6_LOCAL_NONPRODUCTION_MIGRATION_REPLAY_AND_SMOKE_READY", planned: 12, executed: 12, successful: 12, failed: 0, skipped: 0, retries: 0, diagnosticCaptureStatus: null, failureDiagnostic: null };
const smokeTerminal = { schemaVersion: "legal-local-predeployment-smoke-terminal-v1", taskId, implementationCommit, runtimeProfile: "LOCAL_SUPABASE_RUNTIME", classification: "R6_LOCAL_NONPRODUCTION_MIGRATION_REPLAY_AND_SMOKE_READY", success: true, checks: REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS.map((check) => ({ check, classification: "READY" })), unexpectedWrites: 0, unexpectedPrivilegeGrants: 0, retainedTestRecords: 0 };
const cleanupTerminal = { schemaVersion: "legal-local-resource-cleanup-terminal-v1", taskId, implementationCommit, classification: "R6_LOCAL_NONPRODUCTION_RESOURCE_CLEANUP_READY", cleanupAttempts: 1, remainingContainerCount: 0, remainingVolumeCount: 0, remainingNetworkCount: 0, unrelatedResourcesChanged: 0 };
const runtimeManifest = createLegalLocalSupabaseRuntimeManifest({ implementationCommit, taskId, networkIdentityHash: targetBinding.networkIdentityHash, databaseIdentityHash: targetBinding.databaseIdentityHash, createdAt: "2026-08-06T00:00:00.000Z" });
const runtimeManifestSha256 = canonicalSha256(runtimeManifest);
const capabilityStates = [...LEGAL_LOCAL_SUPABASE_REQUIRED_CAPABILITIES.map((name) => ({ name, present: true, required: true })), ...LEGAL_LOCAL_SUPABASE_OPTIONAL_CAPABILITIES.map((name) => ({ name, present: true, required: false }))];
const runtimeCapability = createRuntimeCapabilityTerminal({ taskId, implementationCommit, runtimeManifestSha256, capabilityStates, checkedAt: "2026-08-06T00:01:00.000Z" });
const rebuiltRuntimeCapability = createRuntimeCapabilityTerminal({ taskId, implementationCommit, runtimeManifestSha256, capabilityStates, checkedAt: "2026-08-06T00:03:00.000Z" });
const orchestratorTerminal = { schemaVersion: "legal-local-predeployment-orchestrator-v1", functionalResult: "READY", cleanupResult: "READY", classification: "R6_LOCAL_PREDEPLOYMENT_LIVE_ORCHESTRATION_READY" };
const taskConsumption = { schemaVersion: "r6-legal-local-task-consumption-v1", taskId, implementationCommit, migrationInventorySha256: inventorySha256, mode: "EXECUTE", confirmationSha256: hash("d"), status: "EXECUTE_ATTEMPT_CONSUMED", consumedAt: "2026-08-06T00:00:00.000Z" };
const completeEvidence = { targetBinding, baselineManifest, baselineTerminal, baselineCheckpoint, baselineJournal, rebuildRestoreEvidence, migrationJournal, migrationTerminal, smokeTerminal, cleanupTerminal, runtimeManifest, runtimeCapability, rebuiltRuntimeCapability, orchestratorTerminal, taskConsumption, implementationCommit };

const completed = evaluateLegalPredeploymentReadiness({ ...completeEvidence, now: Date.parse("2026-08-07T00:00:00.000Z") });
assert.equal(completed.classification, "R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_COMPLETE_PRODUCTION_FINGERPRINT_REQUIRED");
assert.equal(completed.localReplayState, "COMPLETED_AND_CLEANED");
assert.equal(completed.localReplayEvidence, "R6_COMPLETED_LOCAL_REPLAY_EVIDENCE_READY");
assert.equal(completed.nonproductionTargetReady, true);
assert.equal(completed.legalStatus, "NO_GO");
const expiredNow = Date.parse("2026-08-07T00:00:00.000Z");
const rejectExpired = (evidence) => assert.throws(() => evaluateLegalPredeploymentReadiness({ ...evidence, now: expiredNow }), (error) => error.code === "R6_NONPRODUCTION_TARGET_EXPIRED");
const rejectIncomplete = (evidence) => assert.throws(() => evaluateLegalPredeploymentReadiness({ ...evidence, now: expiredNow }), (error) => error.code === "R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");

rejectExpired({ ...completeEvidence, taskConsumption: null });
rejectExpired({ ...completeEvidence, migrationTerminal: { ...migrationTerminal, executed: 1, successful: 1 }, taskConsumption: null });
rejectIncomplete({ ...completeEvidence, orchestratorTerminal: { ...orchestratorTerminal, classification: "R6_LOCAL_NONPRODUCTION_MIGRATION_REPLAY_INCOMPLETE" } });
rejectIncomplete({ targetBinding: null, implementationCommit });
rejectIncomplete({ ...completeEvidence, migrationTerminal: { ...migrationTerminal, journalSha256: hash("f") } });
rejectIncomplete({ ...completeEvidence, baselineTerminal: { ...baselineTerminal, taskId: "r6-local-predeployment-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" } });
rejectIncomplete({ ...completeEvidence, taskConsumption: { ...taskConsumption, implementationCommit: "b".repeat(40) } });
rejectIncomplete({ ...completeEvidence, taskConsumption: { ...taskConsumption, migrationInventorySha256: hash("f") } });
rejectIncomplete({ ...completeEvidence, runtimeCapability: { ...runtimeCapability, runtimeProfile: "UNTRUSTED_RUNTIME" } });
rejectIncomplete({ ...completeEvidence, smokeTerminal: { ...smokeTerminal, checks: smokeTerminal.checks.slice(0, 13) } });
rejectIncomplete({ ...completeEvidence, cleanupTerminal: { ...cleanupTerminal, remainingVolumeCount: 1 } });
rejectExpired({ targetBinding });

console.log(JSON.stringify({ classification: "R6_COMPLETED_LOCAL_REPLAY_READINESS_REGRESSION_TESTS_READY", fixtures: 13, realOperations: 0 }));
