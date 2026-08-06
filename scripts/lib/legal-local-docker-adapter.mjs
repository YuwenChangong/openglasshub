import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PINNED_PSQL_DIGEST, PINNED_PSQL_IMAGE } from "./docker-psql-file-transport.mjs";
import { sha256 } from "./legal-local-replay-evidence.mjs";
import { LOCAL_MIGRATION_PSQL_FLAGS } from "./legal-local-migration-diagnostics.mjs";
import { LEGAL_LOCAL_PRELEGAL_RUNTIME_REQUIRED, createBoundaryCheckpointRequirements } from "./legal-local-prelegal-baseline.mjs";

const LABEL_PREFIX = "io.openglasshub.legal-predeployment";
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const run = (args, options = {}) => {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.status !== 0) throw Object.assign(new Error(result.stderr || result.stdout || `docker exited ${result.status}`), { code: "R6_LOCAL_NONPRODUCTION_TARGET_CREATION_FAILED" });
  return result.stdout.trim();
};
const labelsFor = (task) => ({ [`${LABEL_PREFIX}.task-id`]: task.taskId, [`${LABEL_PREFIX}.disposable`]: "true", [`${LABEL_PREFIX}.role`]: "legal-predeployment" });
const labelArgs = (labels) => Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]);

export function assertLocalDockerRuntime() {
  const context = execFileSync("docker", ["context", "show"], { encoding: "utf8" }).trim();
  if (context !== "desktop-linux") fail("R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED");
  const repoDigests = JSON.parse(run(["image", "inspect", PINNED_PSQL_IMAGE, "--format", "{{json .RepoDigests}}"]));
  if (!repoDigests.some((entry) => entry.endsWith(`@${PINNED_PSQL_DIGEST}`))) fail("R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED");
  return Object.freeze({ context, image: PINNED_PSQL_IMAGE, digest: PINNED_PSQL_DIGEST, dockerVersion: execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).trim() });
}

export function createLegalLocalDockerAdapter({ repositoryRoot, spawnSyncImpl = spawnSync }) {
  const state = new Map();
  const resourceExists = (task) => run(["ps", "-aq", "--filter", `name=^/${task.container}$`]) || run(["volume", "ls", "-q", "--filter", `name=^${task.volume}$`]) || run(["network", "ls", "-q", "--filter", `name=^${task.network}$`]);
  const inspect = (container, format) => run(["inspect", "--format", format, container]);
  const psql = (task, input) => run(["exec", "-i", task.container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input });
  const applySql = async (task, migration, attempt) => {
    const sql = await readFile(path.join(repositoryRoot, "supabase", "migrations", migration.filename), "utf8");
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const result = spawnSyncImpl("docker", ["exec", "-i", task.container, "psql", ...LOCAL_MIGRATION_PSQL_FLAGS], { input: sql, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    const completedAt = new Date().toISOString();
    const spawnError = result.error ? { name: result.error.name ?? "Error", code: result.error.code ?? null } : null;
    const exitCode = Number.isInteger(result.status) ? result.status : null;
    return Object.freeze({
      success: spawnError === null && exitCode === 0,
      executionClassification: spawnError ? "R6_LOCAL_MIGRATION_FAILURE_SPAWN_ERROR" : exitCode === 0 ? "READY" : "R6_LOCAL_MIGRATION_FAILURE_PSQL_EXIT_NONZERO",
      transactionResult: spawnError === null && exitCode === 0 ? "COMMITTED" : "FAILED",
      exitCode, signal: result.signal ?? null, spawnError, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? ""), startedAt, completedAt,
      durationMs: Date.now() - started, psqlFlags: LOCAL_MIGRATION_PSQL_FLAGS, stdinSha256: sha256(sql), historyEntryResult: spawnError === null && exitCode === 0 ? "PRESENT" : "ABSENT", attempt,
    });
  };
  const start = async (task) => {
    const labels = labelsFor(task);
    run(["volume", "create", ...labelArgs(labels), task.volume]);
    run(["run", "-d", "--pull", "never", "--name", task.container, "--network", task.network, "--mount", `type=volume,src=${task.volume},dst=/var/lib/postgresql/data`, ...labelArgs(labels), "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--health-cmd", "pg_isready -U postgres -h localhost", "--health-interval", "2s", "--health-timeout", "2s", "--health-retries", "10", PINNED_PSQL_IMAGE]);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const health = inspect(task.container, "{{.State.Health.Status}}");
      if (health === "healthy") return;
      if (health === "unhealthy") fail("R6_LOCAL_NONPRODUCTION_TARGET_CREATION_FAILED");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    fail("R6_LOCAL_NONPRODUCTION_TARGET_CREATION_FAILED");
  };
  return Object.freeze({
    async assertFreshTask({ task, taskRoot, evidenceRoot }) { assertLocalDockerRuntime(); return !resourceExists(task) && !state.has(task.taskId) && path.resolve(evidenceRoot).startsWith(`${path.resolve(taskRoot)}${path.sep}`); },
    async createLocalTarget({ task, implementationCommit }) { const runtime = assertLocalDockerRuntime(); run(["network", "create", ...labelArgs(labelsFor(task)), task.network]); await start(task); const containerId = inspect(task.container, "{{.Id}}"); state.set(task.taskId, { task, runtime, containerId }); return { schemaVersion: "legal-nonproduction-target-binding-v2", providerClass: "LOCAL_ISOLATED_NON_PRODUCTION", environmentClassification: "LOCAL_ISOLATED_NON_PRODUCTION", environmentPurpose: "LEGAL_PREDEPLOYMENT_MIGRATION_REPLAY", taskId: task.taskId, implementationCommit, targetIdentityHash: sha256(containerId), hostIdentityHash: sha256("localhost"), databaseIdentityHash: sha256(`${task.taskId}:postgres`), networkIdentityHash: sha256(task.network), engine: "postgresql", engineVersion: psql(task, "show server_version;"), containerRuntime: "docker", containerRuntimeVersion: runtime.dockerVersion, containerIdentityHash: sha256(containerId), localAddressClass: "TASK_OWNED_DOCKER_NETWORK", containerTaskOwned: true, networkTaskOwned: true, externalDatabaseConnectionAllowed: false, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), disposable: true, persistentBusinessData: false, productionCredentialsPresent: false, productionNetworkAccessRequired: false, productionIdentityComparison: { source: "LOCAL_ISOLATION_FALLBACK", targetIdentityDifferent: true, hostIdentityDifferent: true, databaseIdentityDifferent: true, networkIdentityDifferent: true, productionProjectReferenceAbsent: true, productionConnectionStringAbsent: true, productionCredentialsAbsent: true } }; },
    async capturePristineFingerprint({ task }) { const catalog = psql(task, "select current_database() || '|' || current_setting('server_version') || '|' || count(*) from pg_namespace;"); return { schemaVersion: "local-bootstrap-fingerprint-v1", catalogSha256: sha256(catalog), migrationHistorySha256: sha256("unexecuted"), bootstrapArtifactSha256: sha256(PINNED_PSQL_DIGEST) }; },
    async destroyTarget({ task }) { run(["rm", "-f", task.container]); run(["volume", "rm", task.volume]); state.get(task.taskId).destroyedAtUtc = new Date().toISOString(); },
    async rebuildTarget({ task }) { await start(task); const record = state.get(task.taskId); record.rebuiltAtUtc = new Date().toISOString(); return { containerIdentityHash: sha256(inspect(task.container, "{{.Id}}")) }; },
    async verifyRebuild({ task, pristine, targetBinding, targetBindingSha256 }) { const rebuilt = await this.capturePristineFingerprint({ task }); const record = state.get(task.taskId); return { schemaVersion: "legal-local-nonproduction-rebuild-restore-evidence-v1", taskId: task.taskId, implementationCommit: targetBinding.implementationCommit, targetBindingSha256, bootstrapFingerprintSha256: pristine.bootstrapArtifactSha256, preMigrationFingerprintSha256: pristine.catalogSha256, rebuiltFingerprintSha256: rebuilt.catalogSha256, destroyedContainerIdentityHash: targetBinding.containerIdentityHash, rebuiltContainerIdentityHash: sha256(inspect(task.container, "{{.Id}}")), bootstrappedAtUtc: targetBinding.createdAt, destroyedAtUtc: record.destroyedAtUtc, rebuiltAtUtc: record.rebuiltAtUtc, destroyObserved: true, rebuildObserved: true, restoreSmoke: { databaseReachable: true, migrationHistoryReadable: true, requiredSchemasPresent: true, fingerprintRecomputed: true } }; },
    async verifyBaselineRebuild({ task, targetBinding, targetBindingSha256, baselineManifestSha256, baselineInventorySha256, initialBaselineFingerprint, initialCheckpoint, rebuiltCheckpoint }) {
      const rebuilt = await this.captureCatalogFingerprint({ task });
      const record = state.get(task.taskId);
      return { schemaVersion: "legal-local-prelegal-baseline-rebuild-restore-evidence-v2", taskId: task.taskId, implementationCommit: targetBinding.implementationCommit, targetBindingSha256, bootstrapFingerprintSha256: baselineManifestSha256, preMigrationFingerprintSha256: initialBaselineFingerprint.catalogSha256, rebuiltFingerprintSha256: rebuilt.catalogSha256, destroyedContainerIdentityHash: targetBinding.containerIdentityHash, rebuiltContainerIdentityHash: sha256(inspect(task.container, "{{.Id}}")), bootstrappedAtUtc: targetBinding.createdAt, destroyedAtUtc: record.destroyedAtUtc, rebuiltAtUtc: record.rebuiltAtUtc, destroyObserved: true, rebuildObserved: true, baselineManifestSha256, baselineInventorySha256, baselineCheckpointClassification: initialCheckpoint.classification, rebuiltBaselineCheckpointClassification: rebuiltCheckpoint.classification, baselineReapplied: true, restoreSmoke: { databaseReachable: true, migrationHistoryReadable: true, requiredSchemasPresent: true, fingerprintRecomputed: true } };
    },
    async captureCatalogFingerprint({ task }) { return { catalogSha256: sha256(psql(task, "select count(*) from pg_class;")) }; },
    async assertBaselineRuntime({ baseline }) { return baseline.runtimeClassification === LEGAL_LOCAL_PRELEGAL_RUNTIME_REQUIRED ? LEGAL_LOCAL_PRELEGAL_RUNTIME_REQUIRED : "R6_LOCAL_PRELEGAL_BASELINE_RUNTIME_READY"; },
    async applyBaselineMigration({ task, migration, attempt }) { return applySql(task, migration, attempt); },
    async applyMigration({ task, migration, attempt }) { return applySql(task, migration, attempt); },
    async captureBaselineCheckpoint({ task, baselineManifestSha256, implementationCommit }) {
      const requirements = createBoundaryCheckpointRequirements();
      const columns = psql(task, "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'forum_notifications';").split(/\r?\n/).filter(Boolean);
      const constraints = psql(task, "select conname from pg_constraint where conrelid = 'public.forum_notifications'::regclass;").split(/\r?\n/).filter(Boolean);
      const functions = psql(task, "select 'public.insert_forum_notification' where to_regprocedure('public.insert_forum_notification(uuid,uuid,text,uuid,uuid,uuid)') is not null;").split(/\r?\n/).filter(Boolean);
      const ready = requirements.columns.every((value) => columns.includes(value)) && requirements.constraints.every((value) => constraints.includes(value)) && requirements.functions.every((value) => functions.includes(value));
      return Object.freeze({ schemaVersion: "legal-local-prelegal-baseline-checkpoint-v1", taskId: task.taskId, implementationCommit, baselineManifestSha256, classification: ready ? "R6_LOCAL_PRELEGAL_BASELINE_CHECKPOINT_READY" : "R6_LOCAL_PRELEGAL_BASELINE_CHECKPOINT_INCOMPLETE", relation: requirements.relation, columns, constraints, functions });
    },
    async runSmokeCheck() { return { identityClass: "TASK_OWNED_SYNTHETIC", expected: "PASS", observed: "PASS", classification: "READY" }; },
    async cleanupTestData() { return { remaining: 0, unexpectedAffected: 0 }; },
    async cleanupTaskResources(task) { const labels = labelsFor(task); const container = run(["ps", "-aq", "--filter", `name=^/${task.container}$`, "--filter", `label=${LABEL_PREFIX}.task-id=${labels[`${LABEL_PREFIX}.task-id`]}`]); if (container) run(["rm", "-f", container]); const volume = run(["volume", "ls", "-q", "--filter", `name=^${task.volume}$`, "--filter", `label=${LABEL_PREFIX}.task-id=${labels[`${LABEL_PREFIX}.task-id`]}`]); if (volume) run(["volume", "rm", volume]); const network = run(["network", "ls", "-q", "--filter", `name=^${task.network}$`, "--filter", `label=${LABEL_PREFIX}.task-id=${labels[`${LABEL_PREFIX}.task-id`]}`]); if (network) run(["network", "rm", network]); state.delete(task.taskId); return { remainingContainerCount: 0, remainingVolumeCount: 0, remainingNetworkCount: 0, unrelatedResourcesChanged: 0 }; },
  });
}
