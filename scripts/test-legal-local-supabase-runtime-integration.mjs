import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLegalLocalDockerAdapter } from "./lib/legal-local-docker-adapter.mjs";
import { createLegalLocalExecutionApproval } from "./lib/legal-local-execution-approval.mjs";
import { runLegalLocalPredeploymentReplay, taskNames } from "./lib/legal-local-predeployment-orchestrator.mjs";

const repositoryRoot = process.cwd();
const implementationCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
const taskId = `r6-local-predeployment-${randomUUID()}`;
const task = taskNames(taskId);
const parent = await mkdtemp(path.join(os.tmpdir(), "r6-local-supabase-runtime-"));
const taskRoot = path.join(parent, "task");
const registryRoot = path.join(parent, "registry");
const adapter = createLegalLocalDockerAdapter({ repositoryRoot });
const count = (args) => execFileSync("docker", args, { encoding: "utf8" }).split(/\r?\n/).filter(Boolean).length;
const resourceCounts = () => ({
  containers: count(["ps", "-aq", "--filter", `name=^/${task.container}$`]) + count(["ps", "-aq", "--filter", `name=^/${task.storageContainer}$`]),
  volumes: count(["volume", "ls", "-q", "--filter", `name=^${task.volume}$`]),
  networks: count(["network", "ls", "-q", "--filter", `name=^${task.network}$`]),
});

try {
  const preflight = await runLegalLocalPredeploymentReplay({ repositoryRoot, taskId, implementationCommit });
  const approval = createLegalLocalExecutionApproval({ implementationCommit, taskId, migrationInventorySha256: preflight.inventory.inventorySha256, issuedAt: "2026-08-07T00:00:00.000Z" });
  const result = await runLegalLocalPredeploymentReplay({ mode: "EXECUTE", taskId, taskRoot, confirmation: approval.requiredConfirmationPhrase, confirmationSha256: approval.requiredConfirmationSha256, consumptionRegistryRoot: registryRoot, implementationCommit, repositoryRoot, adapter, testOnly: true });
  if (result.classification !== "R6_LOCAL_PREDEPLOYMENT_LIVE_ORCHESTRATION_READY") {
    const capability = result.evidence.runtimeCapability ? JSON.parse(await readFile(result.evidence.runtimeCapability.path, "utf8")) : null;
    const smoke = result.evidence.smoke ? JSON.parse(await readFile(result.evidence.smoke.path, "utf8")) : null;
    console.error(JSON.stringify({ classification: result.classification, missingCapabilities: capability?.missingCapabilities ?? [], failedSmokeCheck: smoke?.failedCheck ?? null }));
  }
  assert.equal(result.classification, "R6_LOCAL_PREDEPLOYMENT_LIVE_ORCHESTRATION_READY");
  assert.equal(result.testOnly, true); assert.equal(result.formalLegalEvidence, false);
  const baselineTerminal = JSON.parse(await readFile(result.evidence.baselineTerminal.path, "utf8"));
  const baselineCheckpoint = JSON.parse(await readFile(result.evidence.baselineCheckpoint.path, "utf8"));
  const migrationTerminal = JSON.parse(await readFile(result.evidence.migrationTerminal.path, "utf8"));
  const migrationJournal = JSON.parse(await readFile(result.evidence.journal.path, "utf8"));
  const smokeTerminal = JSON.parse(await readFile(result.evidence.smoke.path, "utf8"));
  const runtimeCapability = JSON.parse(await readFile(result.evidence.runtimeCapability.path, "utf8"));
  const rebuiltRuntimeCapability = JSON.parse(await readFile(result.evidence.rebuiltRuntimeCapability.path, "utf8"));
  assert.deepEqual({ planned: baselineTerminal.planned, successful: baselineTerminal.successful, failed: baselineTerminal.failed }, { planned: 31, successful: 31, failed: 0 });
  assert.equal(baselineCheckpoint.classification, "R6_LOCAL_PRELEGAL_BASELINE_CHECKPOINT_READY");
  assert.equal(runtimeCapability.classification, "R6_LOCAL_SUPABASE_RUNTIME_CAPABILITY_READY");
  assert.equal(rebuiltRuntimeCapability.classification, "R6_LOCAL_SUPABASE_RUNTIME_CAPABILITY_READY");
  assert.deepEqual({ planned: migrationTerminal.planned, executed: migrationTerminal.executed, successful: migrationTerminal.successful, failed: migrationTerminal.failed, skipped: migrationTerminal.skipped }, { planned: 12, executed: 12, successful: 12, failed: 0, skipped: 0 });
  const migration20260703 = migrationJournal.entries.find((entry) => entry.filename === "20260703_moderation_action_notifications.sql");
  assert.equal(migration20260703.exitCode, 0); assert.equal(migration20260703.diagnostic, null); assert.equal(migration20260703.historyEntryResult, "PRESENT");
  assert.equal(smokeTerminal.success, true); assert.equal(smokeTerminal.runtimeProfile, "LOCAL_SUPABASE_RUNTIME"); assert.equal(smokeTerminal.checks.length, 14);
  assert.deepEqual(resourceCounts(), { containers: 0, volumes: 0, networks: 0 });
  console.log(JSON.stringify({ classification: "R6_LOCAL_SUPABASE_RUNTIME_CAPABILITY_PROBE_READY", taskId, runtimeProfile: result.runtimeContract.runtimeProfile, baseline: "31/31", legal: "12/12", migration20260703: { exitCode: migration20260703.exitCode, sqlstate: null, historyEntryResult: migration20260703.historyEntryResult }, smokeChecks: smokeTerminal.checks.length, dockerPulls: 0, formalLegalEvidence: false, cleanupResidue: 0, remoteProductionOperations: 0 }));
} finally {
  try { await adapter.cleanupTaskResources(task); } catch {}
  await rm(parent, { recursive: true, force: true });
}
