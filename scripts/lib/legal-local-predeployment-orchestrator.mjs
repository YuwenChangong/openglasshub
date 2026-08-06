import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { REQUIRED_FORWARD_MIGRATIONS } from "./legal-consent-forward-migration-inventory.mjs";
import { validateLegalNonproductionTargetBinding } from "./legal-nonproduction-target-binding.mjs";
import { validateLegalLocalRebuildRestoreEvidence } from "./legal-local-rebuild-restore-evidence.mjs";
import { evaluateLegalPredeploymentReadiness } from "./legal-predeployment-readiness.mjs";
import { cleanupLegalLocalResources } from "./legal-local-resource-cleanup.mjs";
import { runLegalLocalSmoke } from "./legal-local-smoke-runner.mjs";
import { sha256, writeCanonicalEvidence, writeRedactedMigrationLog } from "./legal-local-replay-evidence.mjs";
import { createLegalLocalExecutionApproval } from "./legal-local-execution-approval.mjs";
import { consumeLegalLocalExecuteTask } from "./legal-local-task-consumption-registry.mjs";
import { parsePostgresDiagnostic, redactMigrationDiagnosticText, validateMigrationAttemptDiagnostic } from "./legal-local-migration-diagnostics.mjs";
import { LEGAL_LOCAL_PRELEGAL_RUNTIME_REQUIRED, LEGAL_LOCAL_PRELEGAL_BASELINE_TERMINAL_SCHEMA, resolveLegalPrelegalBaseline, validateLegalPrelegalBaselineCheckpoint, validateLegalPrelegalBaselineManifest } from "./legal-local-prelegal-baseline.mjs";

export const LEGAL_LOCAL_ORCHESTRATOR_SCHEMA = "legal-local-predeployment-orchestrator-v1";
const TASK_ID = /^r6-local-predeployment-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

export function taskNames(taskId) {
  if (!TASK_ID.test(String(taskId ?? ""))) fail("R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED");
  const suffix = taskId.slice("r6-local-predeployment-".length);
  return Object.freeze({ taskId, dockerProject: `r6-local-predeployment-${suffix}`, network: `r6-local-predeployment-net-${suffix}`, container: `r6-local-predeployment-db-${suffix}`, volume: `r6-local-predeployment-data-${suffix}` });
}

export async function resolveLegalMigrationInventory({ repositoryRoot }) {
  const root = path.resolve(repositoryRoot);
  const entries = [];
  for (const [sequence, definition] of REQUIRED_FORWARD_MIGRATIONS.entries()) {
    const filename = definition.file;
    const source = await readFile(path.join(root, "supabase", "migrations", filename));
    entries.push(Object.freeze({ sequence: sequence + 1, identity: filename.slice(0, 8), filename, canonicalSha256: sha256(source), dependencies: definition.dependencies, expectedEffects: definition.fragments }));
  }
  if (entries.length !== 12 || new Set(entries.map((entry) => entry.filename)).size !== 12) fail("R6_LOCAL_NONPRODUCTION_MIGRATION_INVENTORY_INVALID");
  return Object.freeze({ schemaVersion: "legal-local-migration-inventory-v1", migrationCount: entries.length, entries, inventorySha256: sha256(JSON.stringify(entries)) });
}

export async function runLegalLocalPredeploymentReplay({ mode = "PREFLIGHT", taskId, taskRoot, confirmation, confirmationSha256, implementationCommit, repositoryRoot, adapter, consumptionRegistryRoot, now = () => new Date().toISOString() }) {
  const inventory = await resolveLegalMigrationInventory({ repositoryRoot });
  const baseline = await resolveLegalPrelegalBaseline({ repositoryRoot, implementationCommit, generatedAt: now() });
  if (!TASK_ID.test(String(taskId ?? "")) || !/^[a-f0-9]{40}$/.test(String(implementationCommit ?? ""))) fail("R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED");
  const approvalContract = createLegalLocalExecutionApproval({ implementationCommit, taskId, migrationInventorySha256: inventory.inventorySha256, issuedAt: now() });
  if (mode === "PREFLIGHT") return Object.freeze({ schemaVersion: LEGAL_LOCAL_ORCHESTRATOR_SCHEMA, classification: "R6_LOCAL_NONPRODUCTION_PREFLIGHT_READY", executionAuthorized: false, baseline, inventory, approvalContract });
  if (mode !== "EXECUTE" || !adapter || !taskRoot || !consumptionRegistryRoot) fail("R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED");
  await consumeLegalLocalExecuteTask({ registryRoot: consumptionRegistryRoot, approvalContract, now });
  if (confirmation !== approvalContract.requiredConfirmationPhrase) throw Object.assign(new Error("R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED"), { code: "R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED", innerClassification: "LEGAL_LOCAL_EXECUTION_CONFIRMATION_MISMATCH" });
  if (confirmationSha256 !== approvalContract.requiredConfirmationSha256) throw Object.assign(new Error("R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED"), { code: "R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED", innerClassification: "LEGAL_LOCAL_EXECUTION_CONFIRMATION_SHA_MISMATCH" });
  const task = taskNames(taskId);
  const resolvedTaskRoot = path.resolve(taskRoot);
  const evidenceRoot = path.join(resolvedTaskRoot, "evidence");
  if (existsSync(resolvedTaskRoot) || existsSync(evidenceRoot)) fail("R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED");
  if (!(await adapter.assertFreshTask({ task, taskRoot, evidenceRoot }))) fail("R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED");
  const breadcrumb = [];
  const advance = (stage) => breadcrumb.push({ stage, at: now() });
  let functionalResult = "INCOMPLETE";
  let functionalFailureClassification = null;
  let functionalFailureType = null;
  let cleanupResult = "NOT_STARTED";
  let cleanupFailureClassification = null;
  const evidence = {};
  let targetBinding;
  let targetValidation;
  let restoreEvidence;
  let baselineJournal = [];
  let baselineTerminal;
  let baselineCheckpoint;
  let migrationJournal = [];
  let migrationTerminal;
  let smokeTerminal;
  let cleanupTerminal;
  let result;
  const writeAttemptDiagnostics = async ({ migration, attempt, adapterResult }) => {
    let stdout;
    let stderr;
    try {
      stdout = redactMigrationDiagnosticText(String(adapterResult.stdout ?? ""));
      stderr = redactMigrationDiagnosticText(String(adapterResult.stderr ?? ""));
    } catch (error) {
      throw Object.assign(error, { code: "R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_REDACTION_FAILED" });
    }
    let stdoutArtifact;
    let stderrArtifact;
    try {
      const prefix = migration.journalKind === "baseline" ? "baseline-" : "";
      stdoutArtifact = await writeRedactedMigrationLog({ evidenceRoot, name: `${prefix}migration-attempt-${migration.sequence}-stdout.log`, text: stdout });
      stderrArtifact = await writeRedactedMigrationLog({ evidenceRoot, name: `${prefix}migration-attempt-${migration.sequence}-stderr.log`, text: stderr });
    } catch (error) {
      throw Object.assign(error, { code: error?.code ?? "R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_WRITE_FAILED" });
    }
    const diagnostic = adapterResult.success
      ? null
      : parsePostgresDiagnostic(stderr);
    return Object.freeze({
      taskId,
      implementationCommit,
      inventorySha256: migration.inventorySha256 ?? inventory.inventorySha256,
      migrationIdentity: migration.identity,
      migrationFilename: migration.filename,
      migrationSha256: migration.canonicalSha256,
      sequence: migration.sequence,
      attempt,
      stdinSha256: adapterResult.stdinSha256 ?? null,
      psqlFlags: adapterResult.psqlFlags ?? null,
      exitCode: adapterResult.exitCode ?? null,
      signal: adapterResult.signal ?? null,
      spawnError: adapterResult.spawnError ?? null,
      startedAt: adapterResult.startedAt ?? null,
      completedAt: adapterResult.completedAt ?? null,
      durationMs: adapterResult.durationMs ?? null,
      stdoutArtifact,
      stderrArtifact,
      diagnostic,
    });
  };
  const writeBaselineTerminal = async (classification) => {
    if (baselineTerminal) return;
    baselineTerminal = {
      schemaVersion: LEGAL_LOCAL_PRELEGAL_BASELINE_TERMINAL_SCHEMA,
      taskId,
      implementationCommit,
      baselineManifestSha256: evidence.baselineManifest?.sha256 ?? null,
      baselineInventorySha256: baseline.baselineInventorySha256,
      classification,
      planned: baseline.baselineMigrationCount,
      executed: baselineJournal.length,
      successful: baselineJournal.filter((entry) => entry.classification === "READY").length,
      failed: baselineJournal.filter((entry) => entry.classification === "FAILED").length,
      skipped: baseline.baselineMigrationCount - baselineJournal.length,
      retries: 0,
    };
    evidence.baselineTerminal = await writeCanonicalEvidence({ evidenceRoot, name: "baseline-migration-execution-terminal.json", payload: baselineTerminal });
  };
  const applyBaseline = async ({ captureEvidence }) => {
    for (const entry of baseline.migrations) {
      const migration = { ...entry, journalKind: "baseline", inventorySha256: baseline.baselineInventorySha256 };
      const beforeFingerprint = await adapter.captureCatalogFingerprint({ task });
      const adapterResult = await (adapter.applyBaselineMigration ?? adapter.applyMigration).call(adapter, { task, migration, attempt: 1 });
      const afterFingerprint = await adapter.captureCatalogFingerprint({ task });
      if (captureEvidence) {
        const diagnosticEvidence = await writeAttemptDiagnostics({ migration, attempt: 1, adapterResult });
        const journalEntry = validateMigrationAttemptDiagnostic({ sequence: entry.sequence, identity: entry.identity, filename: entry.filename, canonicalSha256: entry.canonicalSha256, ...diagnosticEvidence, retryCount: 0, automaticRollback: false, beforeFingerprint, afterFingerprint, transactionResult: adapterResult.transactionResult, historyEntryResult: adapterResult.historyEntryResult, classification: adapterResult.success ? "READY" : "FAILED", diagnosticCaptureStatus: diagnosticEvidence.diagnostic?.diagnosticCaptureStatus ?? null }, { taskId, implementationCommit, inventorySha256: baseline.baselineInventorySha256, evidenceRoot });
        baselineJournal.push(journalEntry);
      }
      if (!adapterResult.success) throw Object.assign(new Error("R6_LOCAL_PRELEGAL_BASELINE_EXECUTION_INCOMPLETE"), { code: "R6_LOCAL_PRELEGAL_BASELINE_EXECUTION_INCOMPLETE" });
    }
  };
  try {
    advance("RESOLVE_BASELINE");
    validateLegalPrelegalBaselineManifest(baseline, { implementationCommit });
    evidence.baselineManifest = await writeCanonicalEvidence({ evidenceRoot, name: "baseline-migration-inventory.json", payload: baseline });
    advance("CREATE_LOCAL_TARGET");
    targetBinding = await adapter.createLocalTarget({ task, implementationCommit, inventorySha256: inventory.inventorySha256 });
    targetValidation = validateLegalNonproductionTargetBinding(targetBinding);
    evidence.targetBinding = await writeCanonicalEvidence({ evidenceRoot, name: "local-target-binding.json", payload: targetBinding });
    if ((await adapter.assertBaselineRuntime?.({ task, baseline })) === LEGAL_LOCAL_PRELEGAL_RUNTIME_REQUIRED) {
      await writeBaselineTerminal(LEGAL_LOCAL_PRELEGAL_RUNTIME_REQUIRED);
      throw Object.assign(new Error(LEGAL_LOCAL_PRELEGAL_RUNTIME_REQUIRED), { code: LEGAL_LOCAL_PRELEGAL_RUNTIME_REQUIRED });
    }
    advance("APPLY_BASELINE");
    await applyBaseline({ captureEvidence: true });
    evidence.baselineJournal = await writeCanonicalEvidence({ evidenceRoot, name: "baseline-migration-execution-journal.json", payload: { schemaVersion: "legal-local-baseline-migration-journal-v1", taskId, implementationCommit, baselineInventorySha256: baseline.baselineInventorySha256, entries: baselineJournal } });
    await writeBaselineTerminal("R6_LOCAL_PRELEGAL_BASELINE_EXECUTION_READY");
    advance("VERIFY_BASELINE");
    baselineCheckpoint = await adapter.captureBaselineCheckpoint({ task, baselineManifestSha256: evidence.baselineManifest.sha256, implementationCommit });
    validateLegalPrelegalBaselineCheckpoint(baselineCheckpoint, { taskId, implementationCommit, baselineManifestSha256: evidence.baselineManifest.sha256 });
    evidence.baselineCheckpoint = await writeCanonicalEvidence({ evidenceRoot, name: "baseline-checkpoint-terminal.json", payload: baselineCheckpoint });
    evidence.bootstrap = await writeCanonicalEvidence({ evidenceRoot, name: "local-bootstrap-fingerprint.json", payload: await adapter.captureCatalogFingerprint({ task }) });
    advance("REBUILD_AND_REAPPLY_BASELINE"); await adapter.destroyTarget({ task }); await adapter.rebuildTarget({ task }); await applyBaseline({ captureEvidence: false });
    advance("VERIFY_REBUILT_BASELINE");
    const rebuiltCheckpoint = await adapter.captureBaselineCheckpoint({ task, baselineManifestSha256: evidence.baselineManifest.sha256, implementationCommit });
    validateLegalPrelegalBaselineCheckpoint(rebuiltCheckpoint, { taskId, implementationCommit, baselineManifestSha256: evidence.baselineManifest.sha256 });
    restoreEvidence = await adapter.verifyBaselineRebuild({ task, targetBinding, targetBindingSha256: evidence.targetBinding.sha256, baselineManifestSha256: evidence.baselineManifest.sha256, baselineInventorySha256: baseline.baselineInventorySha256, initialBaselineFingerprint: JSON.parse(await readFile(evidence.bootstrap.path, "utf8")), initialCheckpoint: baselineCheckpoint, rebuiltCheckpoint });
    validateLegalLocalRebuildRestoreEvidence(restoreEvidence, { targetBinding });
    evidence.rebuild = await writeCanonicalEvidence({ evidenceRoot, name: "local-rebuild-restore-evidence.json", payload: restoreEvidence });
    evidence.baselinePostMigration = await writeCanonicalEvidence({ evidenceRoot, name: "baseline-postmigration-fingerprint.json", payload: await adapter.captureCatalogFingerprint({ task }) });
    advance("RESOLVE_12_MIGRATIONS"); evidence.inventory = await writeCanonicalEvidence({ evidenceRoot, name: "migration-inventory.json", payload: inventory });
    advance("EXECUTE_LEGAL_MIGRATIONS");
    for (const migration of inventory.entries) {
      const beforeFingerprint = await adapter.captureCatalogFingerprint({ task });
      const adapterResult = await adapter.applyMigration({ task, migration, attempt: 1 });
      const afterFingerprint = await adapter.captureCatalogFingerprint({ task });
      const diagnosticEvidence = await writeAttemptDiagnostics({ migration, attempt: 1, adapterResult });
      const journalEntry = validateMigrationAttemptDiagnostic({ ...migration, ...diagnosticEvidence, retryCount: 0, automaticRollback: false, beforeFingerprint, afterFingerprint, transactionResult: adapterResult.transactionResult, historyEntryResult: adapterResult.historyEntryResult, classification: adapterResult.success ? "READY" : "FAILED", diagnosticCaptureStatus: diagnosticEvidence.diagnostic?.diagnosticCaptureStatus ?? null }, { taskId, implementationCommit, inventorySha256: inventory.inventorySha256, evidenceRoot });
      migrationJournal.push(journalEntry);
      if (!adapterResult.success) throw Object.assign(new Error("R6_LOCAL_NONPRODUCTION_MIGRATION_REPLAY_INCOMPLETE"), { code: "R6_LOCAL_NONPRODUCTION_MIGRATION_REPLAY_INCOMPLETE", migrationJournal });
    }
    evidence.journal = await writeCanonicalEvidence({ evidenceRoot, name: "migration-execution-journal.json", payload: { schemaVersion: "legal-local-migration-journal-v2", taskId, implementationCommit, inventorySha256: inventory.inventorySha256, entries: migrationJournal } });
    migrationTerminal = { schemaVersion: "legal-local-migration-terminal-v2", taskId, implementationCommit, targetBindingSha256: evidence.targetBinding.sha256, inventorySha256: inventory.inventorySha256, journalSha256: evidence.journal.sha256, classification: "R6_LOCAL_NONPRODUCTION_MIGRATION_REPLAY_AND_SMOKE_READY", planned: 12, executed: migrationJournal.length, successful: migrationJournal.length, failed: 0, skipped: 0, retries: 0, diagnosticCaptureStatus: null, failureDiagnostic: null };
    evidence.migrationTerminal = await writeCanonicalEvidence({ evidenceRoot, name: "migration-execution-terminal.json", payload: migrationTerminal });
    advance("RUN_SMOKE"); smokeTerminal = await runLegalLocalSmoke({ adapter, taskId, implementationCommit });
    evidence.smoke = await writeCanonicalEvidence({ evidenceRoot, name: "acl-rls-consent-smoke-terminal.json", payload: smokeTerminal });
    if (!smokeTerminal.success) throw Object.assign(new Error("R6_LOCAL_NONPRODUCTION_LEGAL_SMOKE_INCOMPLETE"), { code: "R6_LOCAL_NONPRODUCTION_LEGAL_SMOKE_INCOMPLETE" });
    advance("CLEAN_TEST_DATA"); const testDataCleanup = await adapter.cleanupTestData({ taskId });
    if (testDataCleanup.remaining !== 0 || testDataCleanup.unexpectedAffected !== 0) fail("R6_LOCAL_NONPRODUCTION_TEST_DATA_CLEANUP_INCOMPLETE");
    evidence.postMigration = await writeCanonicalEvidence({ evidenceRoot, name: "local-postmigration-fingerprint.json", payload: await adapter.captureCatalogFingerprint({ task }) });
    functionalResult = "READY";
    result = { schemaVersion: LEGAL_LOCAL_ORCHESTRATOR_SCHEMA, classification: "R6_LOCAL_PREDEPLOYMENT_LIVE_ORCHESTRATION_READY", functionalResult, targetValidation, evidence, inventory, breadcrumb };
  } catch (error) {
    const classification = error.code ?? "R6_LOCAL_NONPRODUCTION_TARGET_CREATION_FAILED";
    functionalFailureClassification = classification;
    functionalFailureType = error.name ?? "Error";
    if (!evidence.baselineJournal && baselineJournal.length > 0) evidence.baselineJournal = await writeCanonicalEvidence({ evidenceRoot, name: "baseline-migration-execution-journal.json", payload: { schemaVersion: "legal-local-baseline-migration-journal-v1", taskId, implementationCommit, baselineInventorySha256: baseline.baselineInventorySha256, entries: baselineJournal } });
    await writeBaselineTerminal(classification);
    if (!evidence.journal && migrationJournal.length > 0) {
      evidence.journal = await writeCanonicalEvidence({ evidenceRoot, name: "migration-execution-journal.json", payload: { schemaVersion: "legal-local-migration-journal-v2", taskId, implementationCommit, inventorySha256: inventory.inventorySha256, entries: migrationJournal } });
    }
    if (!evidence.migrationTerminal) {
      const failedAttempt = migrationJournal.find((entry) => entry.classification === "FAILED") ?? null;
      migrationTerminal = { schemaVersion: "legal-local-migration-terminal-v2", taskId, implementationCommit, targetBindingSha256: evidence.targetBinding?.sha256 ?? null, inventorySha256: inventory.inventorySha256, journalSha256: evidence.journal?.sha256 ?? null, classification, planned: 12, executed: migrationJournal.length, successful: migrationJournal.filter((entry) => entry.classification === "READY").length, failed: migrationJournal.filter((entry) => entry.classification === "FAILED").length, skipped: 12 - migrationJournal.length, retries: 0, diagnosticCaptureStatus: failedAttempt?.diagnosticCaptureStatus ?? null, failureDiagnostic: failedAttempt?.diagnostic ?? null };
      evidence.migrationTerminal = await writeCanonicalEvidence({ evidenceRoot, name: "migration-execution-terminal.json", payload: migrationTerminal });
    }
    result = { schemaVersion: LEGAL_LOCAL_ORCHESTRATOR_SCHEMA, classification, functionalResult, targetValidation, evidence, inventory, breadcrumb };
  } finally {
    advance("CLEAN_DOCKER_RESOURCES");
    try { cleanupTerminal = await cleanupLegalLocalResources({ adapter, task, implementationCommit }); cleanupResult = "READY"; evidence.cleanup = await writeCanonicalEvidence({ evidenceRoot, name: "local-resource-cleanup-terminal.json", payload: cleanupTerminal }); } catch (error) { cleanupResult = "INCOMPLETE"; cleanupFailureClassification = error.code ?? "R6_LOCAL_NONPRODUCTION_RESOURCE_CLEANUP_INCOMPLETE"; }
    const readiness = functionalResult === "READY" && cleanupResult === "READY"
      ? evaluateLegalPredeploymentReadiness({ targetBinding, baselineManifest: baseline, baselineTerminal, baselineCheckpoint, rebuildRestoreEvidence: restoreEvidence, migrationTerminal, smokeTerminal, cleanupTerminal, implementationCommit })
      : evaluateLegalPredeploymentReadiness();
    await writeCanonicalEvidence({ evidenceRoot, name: "automatable-legal-readiness-summary.json", payload: { ...readiness, functionalResult, cleanupResult } });
    await writeCanonicalEvidence({ evidenceRoot, name: "orchestrator-breadcrumb.json", payload: { schemaVersion: "legal-local-orchestrator-breadcrumb-v1", taskId, breadcrumb } });
    const terminalClassification = functionalResult === "READY" && cleanupResult === "READY" ? "R6_LOCAL_PREDEPLOYMENT_LIVE_ORCHESTRATION_READY" : cleanupResult !== "READY" ? "R6_LOCAL_NONPRODUCTION_RESOURCE_CLEANUP_INCOMPLETE" : result.classification;
    await writeCanonicalEvidence({ evidenceRoot, name: "orchestrator-terminal.json", payload: { schemaVersion: LEGAL_LOCAL_ORCHESTRATOR_SCHEMA, functionalResult, cleanupResult, classification: terminalClassification } });
    result = { ...result, classification: terminalClassification, functionalFailureClassification, functionalFailureType, cleanupResult, cleanupFailureClassification, readiness, evidence, breadcrumb };
  }
  return result;
}
