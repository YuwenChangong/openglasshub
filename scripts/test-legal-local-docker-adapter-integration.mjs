import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LEGAL_LOCAL_ORDINARY_POSTGRES_PROFILE, createLegalLocalDockerAdapter } from "./lib/legal-local-docker-adapter.mjs";
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
const adapter = createLegalLocalDockerAdapter({ repositoryRoot: syntheticRoot, runtimeProfile: LEGAL_LOCAL_ORDINARY_POSTGRES_PROFILE });

try {
  await mkdir(path.join(syntheticRoot, "supabase"), { recursive: true });
  await cp(path.join(sourceRoot, "supabase", "migrations"), path.join(syntheticRoot, "supabase", "migrations"), { recursive: true });
  const preflight = await runLegalLocalPredeploymentReplay({ repositoryRoot: syntheticRoot, taskId, implementationCommit });
  const approval = createLegalLocalExecutionApproval({ implementationCommit, taskId, migrationInventorySha256: preflight.inventory.inventorySha256, issuedAt: "2026-08-06T00:00:00.000Z" });
  const result = await runLegalLocalPredeploymentReplay({ mode: "EXECUTE", taskId, taskRoot, confirmation: approval.requiredConfirmationPhrase, confirmationSha256: approval.requiredConfirmationSha256, consumptionRegistryRoot: registryRoot, implementationCommit, repositoryRoot: syntheticRoot, adapter });
  assert.equal(result.classification, "R6_LOCAL_PRELEGAL_BASELINE_REQUIRES_LOCAL_SUPABASE_RUNTIME");
  const terminal = JSON.parse(await readFile(result.evidence.baselineTerminal.path, "utf8"));
  assert.equal(result.evidence.baselineManifest, undefined); assert.equal(result.evidence.targetBinding, undefined);
  assert.equal(terminal.schemaVersion, "legal-local-prelegal-baseline-terminal-v1"); assert.equal(terminal.classification, "R6_LOCAL_PRELEGAL_BASELINE_REQUIRES_LOCAL_SUPABASE_RUNTIME"); assert.equal(terminal.executed, 0); assert.equal(result.evidence.journal, undefined);
  assert.equal(result.breadcrumb.some((entry) => entry.stage === "RUN_SMOKE"), false); assert.deepEqual(resourceCounts(), { containers: 0, volumes: 0, networks: 0 });
  console.log(JSON.stringify({ classification: "R6_LOCAL_PRELEGAL_BASELINE_DOCKER_RUNTIME_GATE_READY", baselineRuntimeRequired: true, baselineMigrationsExecuted: 0, legalMigrationsExecuted: 0, smokeExecuted: 0, dockerPulls: 0, taskOwnedResourcesCleaned: true, formalLegalEvidence: false, remoteProductionOperations: 0 }));
} finally {
  try { await adapter.cleanupTaskResources(task); } catch {}
  await rm(parent, { recursive: true, force: true });
}
