import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLegalLocalDockerAdapter } from "./lib/legal-local-docker-adapter.mjs";
import { createLegalLocalExecutionApproval } from "./lib/legal-local-execution-approval.mjs";
import { runLegalLocalPredeploymentReplay, taskNames } from "./lib/legal-local-predeployment-orchestrator.mjs";

const sourceRoot = process.cwd();
const implementationCommit = "9b489d37183fa9b172933ae32fe9d57432b995d2";
const taskId = `r6-local-predeployment-${randomUUID()}`;
const task = taskNames(taskId);
const count = (args) => execFileSync("docker", args, { encoding: "utf8" }).split(/\r?\n/).filter(Boolean).length;
const resourceCounts = () => ({
  containers: count(["ps", "-aq", "--filter", `name=^/${task.container}$`]),
  volumes: count(["volume", "ls", "-q", "--filter", `name=^${task.volume}$`]),
  networks: count(["network", "ls", "-q", "--filter", `name=^${task.network}$`]),
});
const parent = await mkdtemp(path.join(os.tmpdir(), "r6-local-diagnostic-docker-"));
const syntheticRoot = path.join(parent, "repository");
const taskRoot = path.join(parent, "task");
const registryRoot = path.join(parent, "registry");
const adapter = createLegalLocalDockerAdapter({ repositoryRoot: syntheticRoot });

try {
  await mkdir(path.join(syntheticRoot, "supabase"), { recursive: true });
  await cp(path.join(sourceRoot, "supabase", "migrations"), path.join(syntheticRoot, "supabase", "migrations"), { recursive: true });
  await writeFile(path.join(syntheticRoot, "supabase", "migrations", "20260703_moderation_action_notifications.sql"), "alter table public.r6_synthetic_missing_table drop column example;\n", "utf8");
  const preflight = await runLegalLocalPredeploymentReplay({ repositoryRoot: syntheticRoot, taskId, implementationCommit });
  const approval = createLegalLocalExecutionApproval({ implementationCommit, taskId, migrationInventorySha256: preflight.inventory.inventorySha256, issuedAt: "2026-08-06T00:00:00.000Z" });
  const result = await runLegalLocalPredeploymentReplay({ mode: "EXECUTE", taskId, taskRoot, confirmation: approval.requiredConfirmationPhrase, confirmationSha256: approval.requiredConfirmationSha256, consumptionRegistryRoot: registryRoot, implementationCommit, repositoryRoot: syntheticRoot, adapter });
  assert.equal(result.classification, "R6_LOCAL_NONPRODUCTION_MIGRATION_REPLAY_INCOMPLETE");
  const journal = JSON.parse(await readFile(result.evidence.journal.path, "utf8"));
  const terminal = JSON.parse(await readFile(result.evidence.migrationTerminal.path, "utf8"));
  const stderr = await readFile(journal.entries[0].stderrArtifact.path, "utf8");
  assert.equal(journal.schemaVersion, "legal-local-migration-journal-v2"); assert.equal(terminal.schemaVersion, "legal-local-migration-terminal-v2");
  assert.equal(journal.entries.length, 1); assert.equal(journal.entries[0].exitCode !== 0, true); assert.equal(journal.entries[0].diagnostic.sqlState, "42P01"); assert.equal(journal.entries[0].diagnostic.primaryMessage.includes("does not exist"), true); assert.equal(stderr.includes("42P01"), true); assert.equal(terminal.diagnosticCaptureStatus, "R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_CAPTURE_READY");
  assert.equal(result.breadcrumb.some((entry) => entry.stage === "RUN_SMOKE"), false); assert.deepEqual(resourceCounts(), { containers: 0, volumes: 0, networks: 0 });
  console.log(JSON.stringify({ classification: "R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_DOCKER_INTEGRATION_READY", psqlExitNonzero: true, sqlState: "42P01", stderrLogRedactedAndBound: true, laterMigrationsExecuted: 0, smokeExecuted: 0, dockerPulls: 0, taskOwnedResourcesCleaned: true, formalLegalEvidence: false, remoteProductionOperations: 0 }));
} finally {
  try { await adapter.cleanupTaskResources(task); } catch {}
  await rm(parent, { recursive: true, force: true });
}
