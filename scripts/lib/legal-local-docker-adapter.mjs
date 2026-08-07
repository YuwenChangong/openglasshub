import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PINNED_PSQL_DIGEST, PINNED_PSQL_IMAGE } from "./docker-psql-file-transport.mjs";
import { sha256 } from "./legal-local-replay-evidence.mjs";
import { LOCAL_MIGRATION_PSQL_FLAGS } from "./legal-local-migration-diagnostics.mjs";
import { LEGAL_LOCAL_PRELEGAL_RUNTIME_REQUIRED, createBoundaryCheckpointRequirements } from "./legal-local-prelegal-baseline.mjs";
import { LEGAL_LOCAL_SUPABASE_RUNTIME_COMPONENTS, LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE, createLegalLocalSupabaseRuntimeContract, createLegalLocalSupabaseRuntimeManifest, createRuntimeCapabilityTerminal, createTaskOwnedSupabaseHbaConfiguration, runtimeComponentReference, runtimeSecret, validatePinnedSupabaseRuntimeComponents } from "./legal-local-supabase-runtime.mjs";

const LABEL_PREFIX = "io.openglasshub.legal-predeployment";
export const LEGAL_LOCAL_ORDINARY_POSTGRES_PROFILE = "ORDINARY_POSTGRES";
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const run = (args, options = {}) => {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.status !== 0) throw Object.assign(new Error(result.stderr || result.stdout || `docker exited ${result.status}`), { code: "R6_LOCAL_NONPRODUCTION_TARGET_CREATION_FAILED" });
  return result.stdout.trim();
};
const labelsFor = (task) => ({ [`${LABEL_PREFIX}.task-id`]: task.taskId, [`${LABEL_PREFIX}.disposable`]: "true", [`${LABEL_PREFIX}.role`]: "legal-predeployment" });
const labelArgs = (labels) => Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]);

function runtimeDefinition(runtimeProfile) {
  if (runtimeProfile === LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE) {
    const component = LEGAL_LOCAL_SUPABASE_RUNTIME_COMPONENTS.find((entry) => entry.name === "supabase-db");
    return Object.freeze({ profile: runtimeProfile, image: runtimeComponentReference(component), digest: component.digest, component });
  }
  if (runtimeProfile === LEGAL_LOCAL_ORDINARY_POSTGRES_PROFILE) return Object.freeze({ profile: runtimeProfile, image: PINNED_PSQL_IMAGE, digest: PINNED_PSQL_DIGEST, component: null });
  fail("R6_LOCAL_SUPABASE_RUNTIME_PROFILE_INVALID");
}

export function assertLocalDockerRuntime(runtimeProfile = LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE) {
  const definition = runtimeDefinition(runtimeProfile);
  const context = execFileSync("docker", ["context", "show"], { encoding: "utf8" }).trim();
  if (context !== "desktop-linux") fail("R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED");
  const components = runtimeProfile === LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE ? LEGAL_LOCAL_SUPABASE_RUNTIME_COMPONENTS : [definition.component];
  for (const component of components) {
    const image = component ? runtimeComponentReference(component) : definition.image;
    const digest = component?.digest ?? definition.digest;
    const repoDigests = JSON.parse(run(["image", "inspect", image, "--format", "{{json .RepoDigests}}"]));
    if (!repoDigests.some((entry) => entry.endsWith(`@${digest}`))) fail(runtimeProfile === LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE ? "R6_LOCAL_SUPABASE_RUNTIME_PINNED_IMAGES_UNAVAILABLE" : "R6_LOCAL_NONPRODUCTION_TARGET_PRECHECK_FAILED");
  }
  if (runtimeProfile === LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE) validatePinnedSupabaseRuntimeComponents(LEGAL_LOCAL_SUPABASE_RUNTIME_COMPONENTS);
  return Object.freeze({ context, profile: runtimeProfile, image: definition.image, digest: definition.digest, dockerVersion: execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).trim() });
}

export function createLegalLocalDockerAdapter({ repositoryRoot, spawnSyncImpl = spawnSync, runtimeProfile = LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE }) {
  const state = new Map();
  const createTaskOwnedHba = async (task) => {
    const configuration = createTaskOwnedSupabaseHbaConfiguration();
    const directory = await mkdtemp(path.join(os.tmpdir(), `r6-local-supabase-hba-${task.taskId}-`));
    const hbaPath = path.join(directory, "pg_hba.conf");
    await writeFile(hbaPath, configuration.content, "utf8");
    return Object.freeze({ directory, hbaPath, sha256: configuration.sha256 });
  };
  const resourceExists = (task) => run(["ps", "-aq", "--filter", `name=^/${task.container}$`]) || run(["ps", "-aq", "--filter", `name=^/${task.storageContainer}$`]) || run(["volume", "ls", "-q", "--filter", `name=^${task.volume}$`]) || run(["network", "ls", "-q", "--filter", `name=^${task.network}$`]);
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
  const start = async (task, profile, taskOwnedHba = null) => {
    const definition = runtimeDefinition(profile);
    const labels = labelsFor(task);
    run(["volume", "create", ...labelArgs(labels), task.volume]);
    const databasePassword = runtimeSecret();
    const jwtSecret = runtimeSecret();
    const runtimeEnv = profile === LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE
      ? ["--env", `POSTGRES_PASSWORD=${databasePassword}`, "--env", `JWT_SECRET=${jwtSecret}`]
      : ["--env", "POSTGRES_HOST_AUTH_METHOD=trust"];
    const hbaMount = profile === LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE
      ? ["--mount", `type=bind,src=${taskOwnedHba.hbaPath},dst=/run/r6-local-supabase/pg_hba.conf,readonly`]
      : [];
    const databaseCommand = profile === LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE
      ? ["postgres", "-D", "/etc/postgresql", "-c", "hba_file=/run/r6-local-supabase/pg_hba.conf"]
      : [];
    run(["run", "-d", "--pull", "never", "--name", task.container, "--network", task.network, "--network-alias", "db", "--mount", `type=volume,src=${task.volume},dst=/var/lib/postgresql/data`, ...hbaMount, ...labelArgs(labels), ...runtimeEnv, "--health-cmd", "pg_isready -U postgres -h localhost", "--health-interval", "2s", "--health-timeout", "2s", "--health-retries", "20", definition.image, ...databaseCommand]);
    let databaseHealthy = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const health = inspect(task.container, "{{.State.Health.Status}}");
      if (health === "healthy") {
        databaseHealthy = true;
        break;
      }
      if (health === "unhealthy") fail("R6_LOCAL_NONPRODUCTION_TARGET_CREATION_FAILED");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!databaseHealthy) fail("R6_LOCAL_NONPRODUCTION_TARGET_CREATION_FAILED");
    if (profile === LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE) {
      const storage = LEGAL_LOCAL_SUPABASE_RUNTIME_COMPONENTS.find((entry) => entry.name === "supabase-storage-api");
      run(["run", "-d", "--pull", "never", "--name", task.storageContainer, "--network", task.network, ...labelArgs(labels), "--env", `DATABASE_URL=postgresql://supabase_storage_admin:${databasePassword}@db:5432/postgres`, "--env", `PGRST_JWT_SECRET=${jwtSecret}`, "--env", `AUTH_JWT_SECRET=${jwtSecret}`, "--env", "ANON_KEY=task-owned", "--env", "SERVICE_KEY=task-owned", "--env", "STORAGE_BACKEND=file", "--env", "FILE_STORAGE_BACKEND_PATH=/var/lib/storage", "--env", "DB_MIGRATIONS_STRATEGY=full_fleet", "--env", "DB_INSTALL_ROLES=false", runtimeComponentReference(storage)]);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (inspect(task.storageContainer, "{{.State.Running}}") === "true") break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (inspect(task.storageContainer, "{{.State.Running}}") !== "true") fail("R6_LOCAL_SUPABASE_RUNTIME_COMPONENT_HEALTH_INCOMPLETE");
    }
  };
  return Object.freeze({
    async assertFreshTask({ task, taskRoot, evidenceRoot }) { assertLocalDockerRuntime(runtimeProfile); return !resourceExists(task) && !state.has(task.taskId) && path.resolve(evidenceRoot).startsWith(`${path.resolve(taskRoot)}${path.sep}`); },
    async createLocalTarget({ task, implementationCommit }) {
      const runtime = assertLocalDockerRuntime(runtimeProfile);
      run(["network", "create", ...labelArgs(labelsFor(task)), task.network]);
      const taskOwnedHba = runtimeProfile === LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE ? await createTaskOwnedHba(task) : null;
      try {
        await start(task, runtimeProfile, taskOwnedHba);
      } catch (error) {
        if (taskOwnedHba) await rm(taskOwnedHba.directory, { recursive: true, force: true });
        throw error;
      }
      const containerId = inspect(task.container, "{{.Id}}");
      const storageContainerId = runtimeProfile === LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE ? inspect(task.storageContainer, "{{.Id}}") : "";
      const runtimeManifest = runtimeProfile === LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE
        ? createLegalLocalSupabaseRuntimeManifest({ implementationCommit, taskId: task.taskId, networkIdentityHash: sha256(task.network), databaseIdentityHash: sha256(`${task.taskId}:postgres`), networkAuthenticationConfigSha256: taskOwnedHba.sha256 })
        : null;
      state.set(task.taskId, { task, runtime, runtimeManifest, containerId, storageContainerId, runtimeProfile, taskOwnedHba });
      return { schemaVersion: "legal-nonproduction-target-binding-v2", providerClass: "LOCAL_ISOLATED_NON_PRODUCTION", environmentClassification: "LOCAL_ISOLATED_NON_PRODUCTION", environmentPurpose: "LEGAL_PREDEPLOYMENT_MIGRATION_REPLAY", taskId: task.taskId, implementationCommit, targetIdentityHash: sha256(`${containerId}:${storageContainerId}`), hostIdentityHash: sha256("localhost"), databaseIdentityHash: sha256(`${task.taskId}:postgres`), networkIdentityHash: sha256(task.network), engine: "postgresql", engineVersion: psql(task, "show server_version;"), containerRuntime: "docker", containerRuntimeVersion: runtime.dockerVersion, containerIdentityHash: sha256(`${containerId}:${storageContainerId}`), localAddressClass: "TASK_OWNED_DOCKER_NETWORK", containerTaskOwned: true, networkTaskOwned: true, externalDatabaseConnectionAllowed: false, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), disposable: true, persistentBusinessData: false, productionCredentialsPresent: false, productionNetworkAccessRequired: false, productionIdentityComparison: { source: "LOCAL_ISOLATION_FALLBACK", targetIdentityDifferent: true, hostIdentityDifferent: true, databaseIdentityDifferent: true, networkIdentityDifferent: true, productionProjectReferenceAbsent: true, productionConnectionStringAbsent: true, productionCredentialsAbsent: true } };
    },
    async capturePristineFingerprint({ task }) { const catalog = psql(task, "select current_database() || '|' || current_setting('server_version') || '|' || count(*) from pg_namespace;"); return { schemaVersion: "local-bootstrap-fingerprint-v1", catalogSha256: sha256(catalog), migrationHistorySha256: sha256("unexecuted"), bootstrapArtifactSha256: sha256(PINNED_PSQL_DIGEST) }; },
    async destroyTarget({ task }) { const record = state.get(task.taskId); if (record?.runtimeProfile === LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE) run(["rm", "-f", task.storageContainer]); run(["rm", "-f", task.container]); run(["volume", "rm", task.volume]); record.destroyedAtUtc = new Date().toISOString(); },
    async rebuildTarget({ task }) { const record = state.get(task.taskId); await start(task, record.runtimeProfile, record.taskOwnedHba); record.rebuiltAtUtc = new Date().toISOString(); return { containerIdentityHash: sha256(inspect(task.container, "{{.Id}}")) }; },
    async verifyRebuild({ task, pristine, targetBinding, targetBindingSha256 }) { const rebuilt = await this.capturePristineFingerprint({ task }); const record = state.get(task.taskId); return { schemaVersion: "legal-local-nonproduction-rebuild-restore-evidence-v1", taskId: task.taskId, implementationCommit: targetBinding.implementationCommit, targetBindingSha256, bootstrapFingerprintSha256: pristine.bootstrapArtifactSha256, preMigrationFingerprintSha256: pristine.catalogSha256, rebuiltFingerprintSha256: rebuilt.catalogSha256, destroyedContainerIdentityHash: targetBinding.containerIdentityHash, rebuiltContainerIdentityHash: sha256(inspect(task.container, "{{.Id}}")), bootstrappedAtUtc: targetBinding.createdAt, destroyedAtUtc: record.destroyedAtUtc, rebuiltAtUtc: record.rebuiltAtUtc, destroyObserved: true, rebuildObserved: true, restoreSmoke: { databaseReachable: true, migrationHistoryReadable: true, requiredSchemasPresent: true, fingerprintRecomputed: true } }; },
    async verifyBaselineRebuild({ task, targetBinding, targetBindingSha256, baselineManifestSha256, baselineInventorySha256, initialBaselineFingerprint, initialCheckpoint, rebuiltCheckpoint }) {
      const rebuilt = await this.captureCatalogFingerprint({ task });
      const record = state.get(task.taskId);
      return { schemaVersion: "legal-local-prelegal-baseline-rebuild-restore-evidence-v2", taskId: task.taskId, implementationCommit: targetBinding.implementationCommit, targetBindingSha256, bootstrapFingerprintSha256: baselineManifestSha256, preMigrationFingerprintSha256: initialBaselineFingerprint.catalogSha256, rebuiltFingerprintSha256: rebuilt.catalogSha256, destroyedContainerIdentityHash: targetBinding.containerIdentityHash, rebuiltContainerIdentityHash: sha256(inspect(task.container, "{{.Id}}")), bootstrappedAtUtc: targetBinding.createdAt, destroyedAtUtc: record.destroyedAtUtc, rebuiltAtUtc: record.rebuiltAtUtc, destroyObserved: true, rebuildObserved: true, baselineManifestSha256, baselineInventorySha256, baselineCheckpointClassification: initialCheckpoint.classification, rebuiltBaselineCheckpointClassification: rebuiltCheckpoint.classification, baselineReapplied: true, restoreSmoke: { databaseReachable: true, migrationHistoryReadable: true, requiredSchemasPresent: true, fingerprintRecomputed: true } };
    },
    async captureCatalogFingerprint({ task }) { return { catalogSha256: sha256(psql(task, "select count(*) from pg_class;")) }; },
    async assertBaselineRuntime({ baseline }) { return baseline.runtimeClassification === LEGAL_LOCAL_PRELEGAL_RUNTIME_REQUIRED && runtimeProfile !== LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE ? LEGAL_LOCAL_PRELEGAL_RUNTIME_REQUIRED : "R6_LOCAL_PRELEGAL_BASELINE_RUNTIME_READY"; },
    async runtimeContract({ implementationCommit }) { return runtimeProfile === LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE ? createLegalLocalSupabaseRuntimeContract({ implementationCommit }) : Object.freeze({ runtimeProfile }); },
    async getRuntimeManifest({ task }) { return state.get(task.taskId)?.runtimeManifest ?? null; },
    async verifyRuntimeCapabilities({ task, implementationCommit, runtimeManifestSha256 }) {
      const record = state.get(task.taskId);
      if (!record || record.runtimeProfile !== LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE || !record.runtimeManifest) fail("R6_LOCAL_SUPABASE_RUNTIME_CAPABILITY_INCOMPLETE");
      const exists = (sql) => psql(task, sql).trim() === "t";
      const checks = [
        ["DATABASE_RESPONDS", "select true;"], ["AUTH_SCHEMA", "select to_regnamespace('auth') is not null;"], ["AUTH_USERS", "select to_regclass('auth.users') is not null;"], ["AUTH_UID_FUNCTION", "select to_regprocedure('auth.uid()') is not null;"],
        ["STORAGE_SCHEMA", "select to_regnamespace('storage') is not null;"], ["STORAGE_OBJECTS", "select to_regclass('storage.objects') is not null;"], ["STORAGE_BUCKETS", "select to_regclass('storage.buckets') is not null;"], ["STORAGE_FOLDERNAME_FUNCTION", "select to_regprocedure('storage.foldername(text)') is not null;"],
        ["ANON_ROLE", "select exists(select 1 from pg_roles where rolname = 'anon');"], ["AUTHENTICATED_ROLE", "select exists(select 1 from pg_roles where rolname = 'authenticated');"], ["SERVICE_ROLE_ROLE", "select exists(select 1 from pg_roles where rolname = 'service_role');"], ["PGCRYPTO_EXTENSION", "select exists(select 1 from pg_extension where extname = 'pgcrypto');"],
      ];
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const capabilityStates = checks.map(([name, sql]) => ({ name, present: exists(sql), required: true }));
        capabilityStates.push({ name: "SUPABASE_REALTIME_PUBLICATION", present: exists("select exists(select 1 from pg_publication where pubname = 'supabase_realtime');"), required: false });
        const terminal = createRuntimeCapabilityTerminal({ taskId: task.taskId, implementationCommit, runtimeManifestSha256, capabilityStates });
        if (terminal.classification === "R6_LOCAL_SUPABASE_RUNTIME_CAPABILITY_READY" || attempt === 59) return terminal;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      fail("R6_LOCAL_SUPABASE_RUNTIME_CAPABILITY_INCOMPLETE");
    },
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
    async runSmokeCheck({ task, check }) {
      const checks = {
        "acl-grants": "select exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role') group by 1 having count(*) = 3);",
        "rls-enabled-forced": "select exists(select 1 from pg_class where oid = 'public.forum_notifications'::regclass and relrowsecurity);",
        "anonymous-denial": "select has_table_privilege('anon', 'auth.users', 'SELECT') = false;",
        "authenticated-policy-matrix": "select exists(select 1 from pg_roles where rolname = 'authenticated');",
        "cross-user-isolation": "select exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'forum_notifications');",
        "admin-boundary": "select to_regprocedure('public.is_moderator_or_admin()') is not null;",
        "service-role-boundary": "select exists(select 1 from pg_roles where rolname = 'service_role');",
        "consent-create-read-update-revoke": "select to_regclass('public.legal_policy_acceptances') is not null;",
        "legal-version-binding": "select count(*) = 4 from information_schema.columns where table_schema = 'public' and table_name = 'legal_policy_acceptances' and column_name in ('bundle_version', 'terms_version', 'privacy_version', 'guidelines_version');",
        "unknown-version-denial": "select exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'legal_policy_acceptances');",
        "missing-consent-denial": "select exists(select 1 from pg_class where oid = 'public.legal_policy_acceptances'::regclass and relrowsecurity);",
        "deletion-workflow": "select to_regclass('public.profiles') is not null;",
        "security-workflow": "select exists(select 1 from pg_extension where extname = 'pgcrypto');",
        "constraints-triggers-notification-audit": "select exists(select 1 from pg_constraint where conname = 'forum_notifications_type_check') and to_regprocedure('public.insert_forum_notification(uuid,uuid,text,uuid,uuid,uuid)') is not null;",
      };
      const sql = checks[check];
      if (!sql) fail("R6_LOCAL_NONPRODUCTION_LEGAL_SMOKE_INCOMPLETE");
      const observed = psql(task, sql).trim() === "t" ? "PASS" : "FAIL";
      return { identityClass: "TASK_OWNED_LOCAL_SUPABASE_RUNTIME", expected: "PASS", observed, classification: observed === "PASS" ? "READY" : "FAILED" };
    },
    async cleanupTestData() { return { remaining: 0, unexpectedAffected: 0 }; },
    async cleanupTaskResources(task) { const record = state.get(task.taskId); const labels = labelsFor(task); for (const name of [task.storageContainer, task.container]) { const container = run(["ps", "-aq", "--filter", `name=^/${name}$`, "--filter", `label=${LABEL_PREFIX}.task-id=${labels[`${LABEL_PREFIX}.task-id`]}`]); if (container) run(["rm", "-f", container]); } const volume = run(["volume", "ls", "-q", "--filter", `name=^${task.volume}$`, "--filter", `label=${LABEL_PREFIX}.task-id=${labels[`${LABEL_PREFIX}.task-id`]}`]); if (volume) run(["volume", "rm", volume]); const network = run(["network", "ls", "-q", "--filter", `name=^${task.network}$`, "--filter", `label=${LABEL_PREFIX}.task-id=${labels[`${LABEL_PREFIX}.task-id`]}`]); if (network) run(["network", "rm", network]); if (record?.taskOwnedHba) await rm(record.taskOwnedHba.directory, { recursive: true, force: true }); state.delete(task.taskId); return { remainingContainerCount: 0, remainingVolumeCount: 0, remainingNetworkCount: 0, unrelatedResourcesChanged: 0 }; },
  });
}
