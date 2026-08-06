import { evaluateLegalNonproductionTargetProvisioning } from "./legal-nonproduction-target-binding.mjs";
import { validateLegalLocalRebuildRestoreEvidence } from "./legal-local-rebuild-restore-evidence.mjs";
import { LEGAL_LOCAL_SMOKE_SCHEMA, REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS } from "./legal-local-smoke-runner.mjs";
import { sha256, stableJson } from "./legal-local-replay-evidence.mjs";

const fail = (code) => { throw Object.assign(new Error(code), { code }); };

function validateAutomatableEvidence({ targetBinding, rebuildRestoreEvidence, migrationTerminal, smokeTerminal, cleanupTerminal, implementationCommit }) {
  if (!targetBinding || !rebuildRestoreEvidence || !migrationTerminal || !smokeTerminal || !cleanupTerminal || !/^[a-f0-9]{40}$/.test(String(implementationCommit ?? ""))) {
    fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  }
  validateLegalLocalRebuildRestoreEvidence(rebuildRestoreEvidence, { targetBinding });
  const targetBindingSha256 = sha256(`${stableJson(targetBinding)}\n`);
  if (targetBinding.implementationCommit !== implementationCommit || rebuildRestoreEvidence.implementationCommit !== implementationCommit) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  if (migrationTerminal.schemaVersion !== "legal-local-migration-terminal-v1" || migrationTerminal.taskId !== targetBinding.taskId || migrationTerminal.implementationCommit !== implementationCommit || migrationTerminal.targetBindingSha256 !== targetBindingSha256 || migrationTerminal.executed !== 12 || migrationTerminal.successful !== 12 || migrationTerminal.failed !== 0 || migrationTerminal.retries !== 0) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  if (smokeTerminal.schemaVersion !== LEGAL_LOCAL_SMOKE_SCHEMA || smokeTerminal.taskId !== targetBinding.taskId || smokeTerminal.implementationCommit !== implementationCommit || smokeTerminal.success !== true || !Array.isArray(smokeTerminal.checks) || smokeTerminal.checks.length !== REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS.length || smokeTerminal.checks.some((check, index) => check.check !== REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS[index] || check.classification !== "READY") || smokeTerminal.unexpectedWrites !== 0 || smokeTerminal.retainedTestRecords !== 0) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
  if (cleanupTerminal.schemaVersion !== "legal-local-resource-cleanup-terminal-v1" || cleanupTerminal.taskId !== targetBinding.taskId || cleanupTerminal.implementationCommit !== implementationCommit || cleanupTerminal.classification !== "R6_LOCAL_NONPRODUCTION_RESOURCE_CLEANUP_READY" || cleanupTerminal.cleanupAttempts !== 1) fail("R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_INCOMPLETE");
}

export function evaluateLegalPredeploymentReadiness({ targetBinding = null, rebuildRestoreEvidence = null, migrationTerminal = null, smokeTerminal = null, cleanupTerminal = null, implementationCommit = null, now = Date.now() } = {}) {
  const nonproductionTarget = evaluateLegalNonproductionTargetProvisioning(targetBinding, { now });
  const hasAutomatableEvidence = [rebuildRestoreEvidence, migrationTerminal, smokeTerminal, cleanupTerminal, implementationCommit].some((value) => value !== null);
  if (hasAutomatableEvidence) validateAutomatableEvidence({ targetBinding, rebuildRestoreEvidence, migrationTerminal, smokeTerminal, cleanupTerminal, implementationCommit });
  return Object.freeze({
    schemaVersion: "legal-predeployment-readiness-v2",
    classification: hasAutomatableEvidence ? "R6_LOCAL_AUTOMATABLE_LEGAL_EVIDENCE_COMPLETE_PRODUCTION_FINGERPRINT_REQUIRED" : nonproductionTarget.classification,
    nonproductionTargetReady: nonproductionTarget.targetReady,
    productionFingerprint: "BLOCKED_PENDING_FINGERPRINT",
    legalStatus: "NO_GO",
    realOperations: 0,
  });
}
