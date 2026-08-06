import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLegalLocalDockerAdapter } from "./lib/legal-local-docker-adapter.mjs";
import { LEGAL_LOCAL_EXECUTION_APPROVAL, runLegalLocalPredeploymentReplay, taskNames } from "./lib/legal-local-predeployment-orchestrator.mjs";
import { sha256 } from "./lib/legal-local-replay-evidence.mjs";

const implementationCommit = "9b489d37183fa9b172933ae32fe9d57432b995d2";
const resources = () => execFileSync("docker", ["ps", "-a", "--format", "{{.Names}}"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean).filter((name) => name.startsWith("r6-local-predeployment-")).sort();
const root = process.cwd();

async function runScenario({ migrationFailureAt = null, smokeFailure = false, cleanupFailure = false } = {}) {
  const taskId = `r6-local-predeployment-${randomUUID()}`;
  const parent = await mkdtemp(path.join(os.tmpdir(), "r6-local-docker-orchestrator-"));
  const taskRoot = path.join(parent, "fresh-task");
  const concrete = createLegalLocalDockerAdapter({ repositoryRoot: root });
  const calls = [];
  const adapter = {
    ...concrete,
    async applyMigration({ migration }) {
      calls.push(`migration-${migration.sequence}`);
      return { success: migrationFailureAt !== migration.sequence, transactionResult: migrationFailureAt === migration.sequence ? "FAILED" : "COMMITTED", exitCode: migrationFailureAt === migration.sequence ? 1 : 0, historyEntryResult: migrationFailureAt === migration.sequence ? "ABSENT" : "PRESENT" };
    },
    async runSmokeCheck({ check }) {
      calls.push(`smoke-${check}`);
      const failed = smokeFailure && check === "admin-boundary";
      return { identityClass: "TASK_OWNED_SYNTHETIC", expected: "PASS", observed: failed ? "FAIL" : "PASS", classification: failed ? "FAILED" : "READY" };
    },
    async cleanupTaskResources(task) {
      const cleaned = await concrete.cleanupTaskResources(task);
      return cleanupFailure ? { ...cleaned, remainingContainerCount: 1 } : cleaned;
    },
  };
  try {
    const result = await runLegalLocalPredeploymentReplay({ mode: "EXECUTE", taskId, taskRoot, confirmation: LEGAL_LOCAL_EXECUTION_APPROVAL, confirmationSha256: sha256(LEGAL_LOCAL_EXECUTION_APPROVAL), implementationCommit, repositoryRoot: root, adapter });
    return { taskId, taskRoot, result, calls, adapter };
  } finally {
    await concrete.cleanupTaskResources(taskNames(taskId));
    await rm(parent, { recursive: true, force: true });
  }
}

const before = resources();
const complete = await runScenario();
assert.equal(complete.result.classification, "R6_LOCAL_PREDEPLOYMENT_LIVE_ORCHESTRATION_READY");
assert.equal(complete.result.functionalResult, "READY");
assert.equal(complete.result.cleanupResult, "READY");
assert.equal(complete.calls.filter((call) => call.startsWith("migration-")).length, 12);
assert.equal(complete.calls.filter((call) => call.startsWith("smoke-")).length, 14);

const migrationFailure = await runScenario({ migrationFailureAt: 4 });
assert.equal(migrationFailure.result.classification, "R6_LOCAL_NONPRODUCTION_MIGRATION_REPLAY_INCOMPLETE");
assert.equal(migrationFailure.calls.includes("migration-5"), false);
assert.equal(migrationFailure.calls.some((call) => call.startsWith("smoke-")), false);

const smokeFailure = await runScenario({ smokeFailure: true });
assert.equal(smokeFailure.result.classification, "R6_LOCAL_NONPRODUCTION_LEGAL_SMOKE_INCOMPLETE");

const cleanupFailure = await runScenario({ cleanupFailure: true });
assert.equal(cleanupFailure.result.functionalResult, "READY");
assert.equal(cleanupFailure.result.cleanupResult, "INCOMPLETE");
assert.equal(cleanupFailure.result.classification, "R6_LOCAL_NONPRODUCTION_RESOURCE_CLEANUP_INCOMPLETE");

const repeatedId = `r6-local-predeployment-${randomUUID()}`;
const repeatedParent = await mkdtemp(path.join(os.tmpdir(), "r6-local-docker-repeat-"));
const repeatedRoot = path.join(repeatedParent, "fresh-task");
const repeatedAdapter = { async assertFreshTask() { return true; } };
await rm(repeatedRoot, { recursive: true, force: true });
await assert.rejects(() => runLegalLocalPredeploymentReplay({ mode: "EXECUTE", taskId: repeatedId, taskRoot: repeatedParent, confirmation: LEGAL_LOCAL_EXECUTION_APPROVAL, confirmationSha256: sha256(LEGAL_LOCAL_EXECUTION_APPROVAL), implementationCommit, repositoryRoot: root, adapter: repeatedAdapter }), (error) => error.code === "R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED");
await rm(repeatedParent, { recursive: true, force: true });

assert.deepEqual(resources(), before);
console.log(JSON.stringify({ classification: "R6_LOCAL_DOCKER_ADAPTER_INTEGRATION_READY", scenarios: 5, dockerPulls: 0, taskOwnedResourcesCleaned: true, realProductionOperations: 0 }));
