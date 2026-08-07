import { evaluateLegalNonproductionTargetProvisioning } from "./legal-nonproduction-target-binding.mjs";
import { validateLegalNonproductionTargetBinding } from "./legal-nonproduction-target-binding.mjs";
import { validateLegalLocalRebuildRestoreEvidence } from "./legal-local-rebuild-restore-evidence.mjs";
import { LEGAL_LOCAL_SMOKE_SCHEMA, REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS } from "./legal-local-smoke-runner.mjs";
import { sha256, stableJson } from "./legal-local-replay-evidence.mjs";
import { LEGAL_LOCAL_PRELEGAL_BASELINE_SCHEMA, LEGAL_LOCAL_PRELEGAL_BASELINE_TERMINAL_SCHEMA, validateLegalPrelegalBaselineCheckpoint, validateLegalPrelegalBaselineManifest } from "./legal-local-prelegal-baseline.mjs";
import { LEGAL_LOCAL_TASK_CONSUMPTION_SCHEMA } from "./legal-local-task-consumption-registry.mjs";
import { LEGAL_LOCAL_SUPABASE_RUNTIME_CAPABILITY_SCHEMA, LEGAL_LOCAL_SUPABASE_RUNTIME_MANIFEST_SCHEMA, LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE, validateLegalLocalSupabaseRuntimeManifest } from "./legal-local-supabase-runtime.mjs";

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const HASH = /^[a-f0-9]{64}$/;
const LEGAL_LOCAL_ORCHESTRATOR_SCHEMA = "legal-local-predeployment-orchestrator-v1";
const COMPLETE_EVIDENCE_FIELDS = Object.freeze([
  "targetBinding", "baselineManifest", "baselineTerminal", "baselineCheckpoint", "baselineJournal",
  "rebuildRestoreEvidence", "migrationJournal", "migrationTerminal", "smokeTerminal", "cleanupTerminal",
  "runtimeManifest", "runtimeCapability", "rebuiltRuntimeCapability", "orchestratorTerminal", "taskConsumption",
  "implementationCommit",
]);

function canonicalSha256(value) {
  return sha256(`${stableJson(value)}\n`);
}

function completedEvidenceNow(targetBinding) {
  const expiresAt = Date.parse(String(targetBinding?.expiresAt ?? ""));
  if (!Number.isFinite(expiresAt)) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  return expiresAt - 1;
}

function validateJournal(journal, { schemaVersion, taskId, implementationCommit, inventorySha256, inventoryField = "inventorySha256", count }) {
  if (!journal || journal.schemaVersion !== schemaVersion || journal.taskId !== taskId || journal.implementationCommit !== implementationCommit || journal.entries?.length !== count) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  if (inventorySha256 && journal[inventoryField] !== inventorySha256) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  if (journal.entries.some((entry) => entry?.classification !== "READY" || entry?.retryCount !== 0)) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
}

function validateRuntimeCapability(terminal, { taskId, implementationCommit, runtimeManifestSha256 }) {
  if (!terminal || terminal.schemaVersion !== LEGAL_LOCAL_SUPABASE_RUNTIME_CAPABILITY_SCHEMA || terminal.taskId !== taskId || terminal.implementationCommit !== implementationCommit || terminal.runtimeManifestSha256 !== runtimeManifestSha256 || terminal.runtimeProfile !== LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE || terminal.classification !== "R6_LOCAL_SUPABASE_RUNTIME_CAPABILITY_READY" || !Array.isArray(terminal.capabilities) || terminal.capabilities.some((capability) => capability?.required === true && capability?.present !== true) || !Array.isArray(terminal.missingCapabilities) || terminal.missingCapabilities.length !== 0) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
}

function validateAutomatableEvidence({ targetBinding, baselineManifest, baselineTerminal, baselineCheckpoint, rebuildRestoreEvidence, migrationTerminal, smokeTerminal, cleanupTerminal, implementationCommit, targetValidationNow = Date.now() }) {
  if (!targetBinding || !baselineManifest || !baselineTerminal || !baselineCheckpoint || !rebuildRestoreEvidence || !migrationTerminal || !smokeTerminal || !cleanupTerminal || !/^[a-f0-9]{40}$/.test(String(implementationCommit ?? ""))) {
    fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  }
  validateLegalNonproductionTargetBinding(targetBinding, { now: targetValidationNow });
  validateLegalLocalRebuildRestoreEvidence(rebuildRestoreEvidence, { targetBinding, now: targetValidationNow });
  validateLegalPrelegalBaselineManifest(baselineManifest, { implementationCommit });
  const baselineManifestSha256 = canonicalSha256(baselineManifest);
  if (baselineTerminal.schemaVersion !== LEGAL_LOCAL_PRELEGAL_BASELINE_TERMINAL_SCHEMA || baselineTerminal.taskId !== targetBinding.taskId || baselineTerminal.implementationCommit !== implementationCommit || baselineTerminal.baselineManifestSha256 !== baselineManifestSha256 || baselineTerminal.baselineInventorySha256 !== baselineManifest.baselineInventorySha256 || baselineTerminal.classification !== "R6_LOCAL_PRELEGAL_BASELINE_EXECUTION_READY" || baselineTerminal.executed !== baselineManifest.baselineMigrationCount || baselineTerminal.successful !== baselineManifest.baselineMigrationCount || baselineTerminal.failed !== 0 || baselineTerminal.retries !== 0) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  validateLegalPrelegalBaselineCheckpoint(baselineCheckpoint, { taskId: targetBinding.taskId, implementationCommit, baselineManifestSha256 });
  const targetBindingSha256 = canonicalSha256(targetBinding);
  if (targetBinding.implementationCommit !== implementationCommit || rebuildRestoreEvidence.implementationCommit !== implementationCommit) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  if (!new Set(["legal-local-migration-terminal-v1", "legal-local-migration-terminal-v2"]).has(migrationTerminal.schemaVersion) || migrationTerminal.taskId !== targetBinding.taskId || migrationTerminal.implementationCommit !== implementationCommit || migrationTerminal.targetBindingSha256 !== targetBindingSha256 || migrationTerminal.executed !== 12 || migrationTerminal.successful !== 12 || migrationTerminal.failed !== 0 || migrationTerminal.retries !== 0) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  if (smokeTerminal.schemaVersion !== LEGAL_LOCAL_SMOKE_SCHEMA || smokeTerminal.taskId !== targetBinding.taskId || smokeTerminal.implementationCommit !== implementationCommit || smokeTerminal.success !== true || !Array.isArray(smokeTerminal.checks) || smokeTerminal.checks.length !== REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS.length || smokeTerminal.checks.some((check, index) => check.check !== REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS[index] || check.classification !== "READY") || smokeTerminal.unexpectedWrites !== 0 || smokeTerminal.retainedTestRecords !== 0) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  if (cleanupTerminal.schemaVersion !== "legal-local-resource-cleanup-terminal-v1" || cleanupTerminal.taskId !== targetBinding.taskId || cleanupTerminal.implementationCommit !== implementationCommit || cleanupTerminal.classification !== "R6_LOCAL_NONPRODUCTION_RESOURCE_CLEANUP_READY" || cleanupTerminal.cleanupAttempts !== 1 || cleanupTerminal.remainingContainerCount !== 0 || cleanupTerminal.remainingVolumeCount !== 0 || cleanupTerminal.remainingNetworkCount !== 0 || cleanupTerminal.unrelatedResourcesChanged !== 0) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
}

function validateCompletedLocalReplayEvidence(evidence) {
  const { targetBinding, baselineManifest, baselineTerminal, baselineCheckpoint, baselineJournal, rebuildRestoreEvidence, migrationJournal, migrationTerminal, smokeTerminal, cleanupTerminal, runtimeManifest, runtimeCapability, rebuiltRuntimeCapability, orchestratorTerminal, taskConsumption, implementationCommit } = evidence;
  const targetValidationNow = completedEvidenceNow(targetBinding);
  validateAutomatableEvidence({ targetBinding, baselineManifest, baselineTerminal, baselineCheckpoint, rebuildRestoreEvidence, migrationTerminal, smokeTerminal, cleanupTerminal, implementationCommit, targetValidationNow });
  validateJournal(baselineJournal, { schemaVersion: "legal-local-baseline-migration-journal-v1", taskId: targetBinding.taskId, implementationCommit, inventorySha256: baselineManifest.baselineInventorySha256, inventoryField: "baselineInventorySha256", count: baselineManifest.baselineMigrationCount });
  validateJournal(migrationJournal, { schemaVersion: "legal-local-migration-journal-v2", taskId: targetBinding.taskId, implementationCommit, inventorySha256: migrationTerminal.inventorySha256, count: 12 });
  if (migrationTerminal.journalSha256 !== canonicalSha256(migrationJournal)) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  if (!runtimeManifest || runtimeManifest.schemaVersion !== LEGAL_LOCAL_SUPABASE_RUNTIME_MANIFEST_SCHEMA || runtimeManifest.taskId !== targetBinding.taskId || runtimeManifest.implementationCommit !== implementationCommit) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  validateLegalLocalSupabaseRuntimeManifest(runtimeManifest, { implementationCommit, taskId: targetBinding.taskId });
  const runtimeManifestSha256 = canonicalSha256(runtimeManifest);
  validateRuntimeCapability(runtimeCapability, { taskId: targetBinding.taskId, implementationCommit, runtimeManifestSha256 });
  validateRuntimeCapability(rebuiltRuntimeCapability, { taskId: targetBinding.taskId, implementationCommit, runtimeManifestSha256 });
  if (!orchestratorTerminal || orchestratorTerminal.schemaVersion !== LEGAL_LOCAL_ORCHESTRATOR_SCHEMA || orchestratorTerminal.classification !== "R6_LOCAL_PREDEPLOYMENT_LIVE_ORCHESTRATION_READY" || orchestratorTerminal.functionalResult !== "READY" || orchestratorTerminal.cleanupResult !== "READY") fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  if (!taskConsumption || taskConsumption.schemaVersion !== LEGAL_LOCAL_TASK_CONSUMPTION_SCHEMA || taskConsumption.taskId !== targetBinding.taskId || taskConsumption.implementationCommit !== implementationCommit || taskConsumption.migrationInventorySha256 !== migrationTerminal.inventorySha256 || taskConsumption.mode !== "EXECUTE" || taskConsumption.status !== "EXECUTE_ATTEMPT_CONSUMED" || !HASH.test(String(taskConsumption.confirmationSha256 ?? "")) || !Number.isFinite(Date.parse(String(taskConsumption.consumedAt ?? "")))) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  return Object.freeze({ classification: "R6_COMPLETED_LOCAL_REPLAY_EVIDENCE_READY", taskId: targetBinding.taskId });
}

export function evaluateLegalPredeploymentReadiness({ targetBinding = null, baselineManifest = null, baselineTerminal = null, baselineCheckpoint = null, baselineJournal = null, rebuildRestoreEvidence = null, migrationJournal = null, migrationTerminal = null, smokeTerminal = null, cleanupTerminal = null, runtimeManifest = null, runtimeCapability = null, rebuiltRuntimeCapability = null, orchestratorTerminal = null, taskConsumption = null, implementationCommit = null, now = Date.now() } = {}) {
  const evidence = { targetBinding, baselineManifest, baselineTerminal, baselineCheckpoint, baselineJournal, rebuildRestoreEvidence, migrationJournal, migrationTerminal, smokeTerminal, cleanupTerminal, runtimeManifest, runtimeCapability, rebuiltRuntimeCapability, orchestratorTerminal, taskConsumption, implementationCommit };
  const hasAutomatableEvidence = [baselineManifest, baselineTerminal, baselineCheckpoint, rebuildRestoreEvidence, migrationTerminal, smokeTerminal, cleanupTerminal, implementationCommit].some((value) => value !== null);
  const hasCompletedEvidence = COMPLETE_EVIDENCE_FIELDS.every((field) => evidence[field] !== null);
  const completedEvidence = hasCompletedEvidence ? validateCompletedLocalReplayEvidence(evidence) : null;
  const nonproductionTarget = completedEvidence
    ? Object.freeze({ classification: completedEvidence.classification, targetReady: true })
    : evaluateLegalNonproductionTargetProvisioning(targetBinding, { now });
  if (hasAutomatableEvidence && !completedEvidence) validateAutomatableEvidence({ targetBinding, baselineManifest, baselineTerminal, baselineCheckpoint, rebuildRestoreEvidence, migrationTerminal, smokeTerminal, cleanupTerminal, implementationCommit, targetValidationNow: now });
  return Object.freeze({
    schemaVersion: "legal-predeployment-readiness-v3",
    classification: hasAutomatableEvidence ? "R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_COMPLETE_PRODUCTION_FINGERPRINT_REQUIRED" : nonproductionTarget.classification,
    nonproductionTargetReady: nonproductionTarget.targetReady,
    localReplayState: completedEvidence ? "COMPLETED_AND_CLEANED" : hasAutomatableEvidence ? "ACTIVE_EXECUTION" : "PRE_EXECUTION",
    localReplayEvidence: completedEvidence?.classification ?? (hasAutomatableEvidence ? "R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_CURRENT_TARGET_REQUIRED" : "R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_NOT_PROVIDED"),
    productionFingerprint: "BLOCKED_PENDING_FINGERPRINT",
    legalStatus: "NO_GO",
    realOperations: 0,
  });
}
