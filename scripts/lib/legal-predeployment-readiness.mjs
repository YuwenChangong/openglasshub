import { evaluateLegalNonproductionTargetProvisioning } from "./legal-nonproduction-target-binding.mjs";
import { validateLegalLocalRebuildRestoreEvidence } from "./legal-local-rebuild-restore-evidence.mjs";
import { LEGAL_LOCAL_SMOKE_SCHEMA, REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS } from "./legal-local-smoke-runner.mjs";
import { sha256, stableJson } from "./legal-local-replay-evidence.mjs";
import { LEGAL_LOCAL_PRELEGAL_BASELINE_SCHEMA, LEGAL_LOCAL_PRELEGAL_BASELINE_TERMINAL_SCHEMA, validateLegalPrelegalBaselineCheckpoint, validateLegalPrelegalBaselineManifest } from "./legal-local-prelegal-baseline.mjs";

const fail = (code) => { throw Object.assign(new Error(code), { code }); };

function validateAutomatableEvidence({ targetBinding, baselineManifest, baselineTerminal, baselineCheckpoint, rebuildRestoreEvidence, migrationTerminal, smokeTerminal, cleanupTerminal, implementationCommit }) {
  if (!targetBinding || !baselineManifest || !baselineTerminal || !baselineCheckpoint || !rebuildRestoreEvidence || !migrationTerminal || !smokeTerminal || !cleanupTerminal || !/^[a-f0-9]{40}$/.test(String(implementationCommit ?? ""))) {
    fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  }
  validateLegalLocalRebuildRestoreEvidence(rebuildRestoreEvidence, { targetBinding });
  validateLegalPrelegalBaselineManifest(baselineManifest, { implementationCommit });
  const baselineManifestSha256 = sha256(`${stableJson(baselineManifest)}\n`);
  if (baselineTerminal.schemaVersion !== LEGAL_LOCAL_PRELEGAL_BASELINE_TERMINAL_SCHEMA || baselineTerminal.taskId !== targetBinding.taskId || baselineTerminal.implementationCommit !== implementationCommit || baselineTerminal.baselineManifestSha256 !== baselineManifestSha256 || baselineTerminal.baselineInventorySha256 !== baselineManifest.baselineInventorySha256 || baselineTerminal.classification !== "R6_LOCAL_PRELEGAL_BASELINE_EXECUTION_READY" || baselineTerminal.executed !== baselineManifest.baselineMigrationCount || baselineTerminal.successful !== baselineManifest.baselineMigrationCount || baselineTerminal.failed !== 0 || baselineTerminal.retries !== 0) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  validateLegalPrelegalBaselineCheckpoint(baselineCheckpoint, { taskId: targetBinding.taskId, implementationCommit, baselineManifestSha256 });
  const targetBindingSha256 = sha256(`${stableJson(targetBinding)}\n`);
  if (targetBinding.implementationCommit !== implementationCommit || rebuildRestoreEvidence.implementationCommit !== implementationCommit) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  if (!new Set(["legal-local-migration-terminal-v1", "legal-local-migration-terminal-v2"]).has(migrationTerminal.schemaVersion) || migrationTerminal.taskId !== targetBinding.taskId || migrationTerminal.implementationCommit !== implementationCommit || migrationTerminal.targetBindingSha256 !== targetBindingSha256 || migrationTerminal.executed !== 12 || migrationTerminal.successful !== 12 || migrationTerminal.failed !== 0 || migrationTerminal.retries !== 0) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  if (smokeTerminal.schemaVersion !== LEGAL_LOCAL_SMOKE_SCHEMA || smokeTerminal.taskId !== targetBinding.taskId || smokeTerminal.implementationCommit !== implementationCommit || smokeTerminal.success !== true || !Array.isArray(smokeTerminal.checks) || smokeTerminal.checks.length !== REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS.length || smokeTerminal.checks.some((check, index) => check.check !== REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS[index] || check.classification !== "READY") || smokeTerminal.unexpectedWrites !== 0 || smokeTerminal.retainedTestRecords !== 0) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  if (cleanupTerminal.schemaVersion !== "legal-local-resource-cleanup-terminal-v1" || cleanupTerminal.taskId !== targetBinding.taskId || cleanupTerminal.implementationCommit !== implementationCommit || cleanupTerminal.classification !== "R6_LOCAL_NONPRODUCTION_RESOURCE_CLEANUP_READY" || cleanupTerminal.cleanupAttempts !== 1) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
}

export function evaluateLegalPredeploymentReadiness({ targetBinding = null, baselineManifest = null, baselineTerminal = null, baselineCheckpoint = null, rebuildRestoreEvidence = null, migrationTerminal = null, smokeTerminal = null, cleanupTerminal = null, implementationCommit = null, now = Date.now() } = {}) {
  const nonproductionTarget = evaluateLegalNonproductionTargetProvisioning(targetBinding, { now });
  const hasAutomatableEvidence = [baselineManifest, baselineTerminal, baselineCheckpoint, rebuildRestoreEvidence, migrationTerminal, smokeTerminal, cleanupTerminal, implementationCommit].some((value) => value !== null);
  if (hasAutomatableEvidence) validateAutomatableEvidence({ targetBinding, baselineManifest, baselineTerminal, baselineCheckpoint, rebuildRestoreEvidence, migrationTerminal, smokeTerminal, cleanupTerminal, implementationCommit });
  return Object.freeze({
    schemaVersion: "legal-predeployment-readiness-v2",
    classification: hasAutomatableEvidence ? "R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_COMPLETE_PRODUCTION_FINGERPRINT_REQUIRED" : nonproductionTarget.classification,
    nonproductionTargetReady: nonproductionTarget.targetReady,
    productionFingerprint: "BLOCKED_PENDING_FINGERPRINT",
    legalStatus: "NO_GO",
    realOperations: 0,
  });
}
