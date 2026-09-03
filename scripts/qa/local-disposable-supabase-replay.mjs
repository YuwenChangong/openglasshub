import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildLocalSupabaseReplayMirror } from "../build-local-supabase-replay-mirror.mjs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const INHERITED_DATABASE_CONNECTION_VARIABLES = ["POSTGRES_URL", "DATABASE_URL", "PGHOST", "PGPORT", "PGSERVICE"];
const REMOTE_CONNECTION_VARIABLES = ["SUPABASE_DB_URL", "SUPABASE_URL", "PUBLIC_SUPABASE_URL"];
const LINKED_PROJECT_VARIABLES = ["SUPABASE_PROJECT_REF", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"];
const PORT_FIELDS = [
  ["api", "port", 1], ["db", "port", 2], ["db", "shadow_port", 0], ["studio", "port", 3],
  ["local_smtp", "port", 4], ["analytics", "port", 7], ["db.pooler", "port", 9], ["edge_runtime", "inspector_port", 83],
];
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

function assertRunId(runId) {
  if (!/^[a-f0-9]{8}$/i.test(runId)) throw new Error("Disposable replay run id must be eight hexadecimal characters");
  return runId.toLowerCase();
}

function isWithin(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function assertOwnedDisposableRoot({ disposableRoot, repositoryRoot }) {
  const root = path.resolve(disposableRoot);
  const temp = path.resolve(os.tmpdir());
  if (!isWithin(root, temp) || isWithin(root, repositoryRoot) || root === temp) throw new Error("Disposable replay root must be an owned temporary directory outside the repository");
  return root;
}

export function assertLocalReplayTarget(target, { ownedNetworkHosts = new Set() } = {}) {
  let host;
  try { host = new URL(target).hostname.toLowerCase().replace(/^\[|\]$/g, ""); } catch { throw new Error("Refusing malformed local replay target"); }
  if (!LOCAL_HOSTS.has(host) && !ownedNetworkHosts.has(host)) throw new Error("Refusing non-local Supabase replay target");
  return true;
}

export function assertSafeLocalReplayEnvironment(environment = process.env) {
  for (const name of INHERITED_DATABASE_CONNECTION_VARIABLES) {
    if (environment[name]) throw new Error(`Refusing inherited database connection variable ${name}`);
  }
  for (const name of REMOTE_CONNECTION_VARIABLES) {
    const value = environment[name];
    if (!value) continue;
    try { assertLocalReplayTarget(value); } catch { throw new Error(`Refusing remote connection variable ${name}`); }
  }
  for (const [name, value] of Object.entries(environment)) {
    if (!value || !/^postgres(?:ql)?:\/\//i.test(value)) continue;
    try { assertLocalReplayTarget(value); } catch { throw new Error(`Refusing remote connection variable ${name}`); }
  }
  for (const name of LINKED_PROJECT_VARIABLES) if (environment[name]) throw new Error(`Refusing linked-project variable ${name}`);
  return true;
}

export function sanitizedChildEnvironment(environment = process.env) {
  assertSafeLocalReplayEnvironment(environment);
  return {
    ...environment,
    POSTGRES_URL: "",
    DATABASE_URL: "",
    PGHOST: "",
    PGPORT: "",
    PGSERVICE: "",
    SUPABASE_DB_URL: "",
    SUPABASE_URL: "",
    PUBLIC_SUPABASE_URL: "",
    SUPABASE_PROJECT_REF: "",
    SUPABASE_ACCESS_TOKEN: "",
    SUPABASE_DB_PASSWORD: "",
    SUPABASE_WORKDIR: "",
  };
}

function projectIdFor(runId) {
  return `ogl-replay-${assertRunId(runId)}`;
}

function rootTemplateFor(runId) {
  return path.join(os.tmpdir(), `openglass-local-disposable-supabase-${assertRunId(runId)}-`);
}

function supabaseArgs(action, root, extra = []) {
  return ["--no-install", "supabase", action, ...extra, "--workdir", root];
}

export function buildLocalDisposableReplayPlan({ root = process.cwd(), runId = randomUUID().replace(/-/g, "").slice(0, 8) } = {}) {
  const id = assertRunId(runId);
  const projectId = projectIdFor(id);
  const runtimeRoot = rootTemplateFor(id);
  const command = (name, executable, args) => ({ name, command: executable, args });
  return {
    dryRun: true,
    repositoryRoot: path.resolve(root),
    runtimeRoot,
    projectId,
    remoteConnections: 0,
    steps: [
      command("supabase-init-owned-root", "npx", supabaseArgs("init", runtimeRoot, ["--yes"])),
      command("build-current-canonical-mirror", "node", ["scripts/build-local-supabase-replay-mirror.mjs", "--output", path.join(runtimeRoot, "supabase", "migrations"), "--mapping", path.join(runtimeRoot, "mapping.json")]),
      command("supabase-start-owned-root", "npx", supabaseArgs("start", runtimeRoot)),
      command("validate-local-status-target", "npx", supabaseArgs("status", runtimeRoot, ["--output", "json"])),
      command("validate-owned-postgres-container", "docker", ["exec", "<owned-container-id>", "psql", "-X", "-U", "postgres", "-d", "postgres", "--csv"]),
      command("validate-migration-ledger", "docker", ["exec", "<owned-container-id>", "psql", "-X", "-U", "postgres", "-d", "postgres", "--csv"]),
      command("fingerprint-through-owned-container-unix-socket", "docker", ["exec", "<owned-container-id>", "psql", "-X", "-U", "postgres", "-d", "postgres", "--csv"]),
      command("supabase-stop-owned-root-no-backup", "npx", supabaseArgs("stop", runtimeRoot, ["--no-backup"])),
      command("remove-verified-owned-root", "node", ["owned-root-cleanup", runtimeRoot]),
    ],
  };
}

function runCommand(executable, args, { cwd, env, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable), stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${executable} exited ${code}: ${stderr || stdout}`));
    });
    if (input) child.stdin.end(input);
  });
}

function replaceConfigField(text, section, key, value) {
  const escapedSection = section.replace(/[.]/g, "\\.");
  const pattern = section
    ? new RegExp(`(\\[${escapedSection}\\][\\s\\S]*?\\n${key}\\s*=\\s*)\\d+`, "m")
    : new RegExp(`(^${key}\\s*=\\s*)"[^"]*"`, "m");
  const replacement = section ? `$1${value}` : `$1"${value}"`;
  const changed = text.replace(pattern, replacement);
  if (changed === text) throw new Error(`Generated Supabase config lacks ${section ? `${section}.${key}` : key}`);
  return changed;
}

async function portIsFree(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(true));
  });
}

async function selectPortBundle(runId) {
  const seed = Number.parseInt(assertRunId(runId).slice(0, 4), 16) % 500;
  for (let offset = 0; offset < 500; offset += 1) {
    const base = 56000 + ((seed + offset) % 500) * 10;
    const ports = PORT_FIELDS.map(([, , portOffset]) => base + portOffset);
    if (ports.every((port) => port > 0 && port < 65536) && (await Promise.all(ports.map(portIsFree))).every(Boolean)) return { base, ports };
  }
  throw new Error("No complete local Supabase port bundle is available");
}

async function initializeOwnedConfig({ runtimeRoot, projectId, runId, execute, environment }) {
  await execute(NPX, supabaseArgs("init", runtimeRoot, ["--yes"]), { cwd: runtimeRoot, env: environment });
  const configPath = path.join(runtimeRoot, "supabase", "config.toml");
  let config = await readFile(configPath, "utf8");
  const bundle = await selectPortBundle(runId);
  config = replaceConfigField(config, "", "project_id", projectId);
  for (let index = 0; index < PORT_FIELDS.length; index += 1) {
    const [section, key] = PORT_FIELDS[index];
    config = replaceConfigField(config, section, key, bundle.ports[index]);
  }
  await writeFile(configPath, config, "utf8");
  return { configPath, ports: bundle.ports };
}

function parseCsvRows(csv) {
  const lines = String(csv).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 1 || lines[0] !== "version,name") throw new Error("Malformed local migration ledger CSV");
  return lines.slice(1).map((line) => {
    const [version, name, ...extra] = line.split(",");
    if (!version || !name || extra.length) throw new Error("Malformed local migration ledger row");
    return { version, name };
  });
}

function expectedLedgerRows(mappings) {
  return mappings.map(({ temporaryVersion, temporaryFile }) => ({
    version: temporaryVersion,
    name: temporaryFile.replace(/^\d+_/, "").replace(/\.sql$/, ""),
  }));
}

export function verifyLocalMigrationLedger({ mappings, rows }) {
  const expected = expectedLedgerRows(mappings);
  if (rows.length !== expected.length) throw new Error(`Local migration ledger count differs: expected ${expected.length}, received ${rows.length}`);
  for (let index = 0; index < expected.length; index += 1) {
    if (rows[index]?.version !== expected[index].version || rows[index]?.name !== expected[index].name) {
      throw new Error(`Local migration ledger order differs at position ${index + 1}`);
    }
  }
  return true;
}

async function listContainers(execute, environment) {
  const { stdout } = await execute("docker", ["ps", "--format", "{{.ID}}\t{{.Names}}"], { env: environment });
  return new Map(stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [id, name] = line.split("\t");
    return [name, id];
  }));
}

function resolveOwnedContainer({ before, after, projectId }) {
  const name = `supabase_db_${projectId}`;
  const id = after.get(name);
  if (!id || before.has(name)) throw new Error("Owned disposable Supabase database container was not created");
  return { id, name };
}

async function executeUnixSocketPsql({ execute, environment, containerId, sql }) {
  const { stdout } = await execute("docker", ["exec", "-i", containerId, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "--csv"], { env: environment, input: sql });
  return stdout;
}

export async function cleanupOwnedDisposableReplay({ runtimeRoot, repositoryRoot, startAttempted, execute, environment, removeRoot = rm }) {
  const ownedRoot = assertOwnedDisposableRoot({ disposableRoot: runtimeRoot, repositoryRoot });
  let cleanupError;
  try {
    if (startAttempted) await execute(NPX, supabaseArgs("stop", ownedRoot, ["--no-backup"]), { cwd: ownedRoot, env: environment });
  } catch (error) { cleanupError = error; }
  try {
    await removeRoot(ownedRoot, { recursive: true, force: true });
  } catch (error) { cleanupError ??= error; }
  if (cleanupError) throw new Error(`Disposable Supabase replay cleanup failed: ${cleanupError.message}`);
  return true;
}

export async function runLocalDisposableReplay({ root = process.cwd(), runId = randomUUID().replace(/-/g, "").slice(0, 8), environment = process.env, execute = runCommand, dryRun = false } = {}) {
  const plan = buildLocalDisposableReplayPlan({ root, runId });
  if (dryRun) return plan;
  const repositoryRoot = path.resolve(root);
  const safeEnvironment = sanitizedChildEnvironment(environment);
  const runtimeRoot = await mkdtemp(rootTemplateFor(runId));
  const projectId = projectIdFor(runId);
  assertOwnedDisposableRoot({ disposableRoot: runtimeRoot, repositoryRoot });
  let startAttempted = false;
  try {
    const before = await listContainers(execute, safeEnvironment);
    await initializeOwnedConfig({ runtimeRoot, projectId, runId, execute, environment: safeEnvironment });
    const mirror = await buildLocalSupabaseReplayMirror({
      canonicalDirectory: path.join(repositoryRoot, "supabase", "migrations"),
      outputDirectory: path.join(runtimeRoot, "supabase", "migrations"),
      mappingPath: path.join(runtimeRoot, "mapping.json"),
      repositoryRoot,
    });
    startAttempted = true;
    await execute(NPX, supabaseArgs("start", runtimeRoot), { cwd: runtimeRoot, env: safeEnvironment });
    const status = JSON.parse((await execute(NPX, supabaseArgs("status", runtimeRoot, ["--output", "json"]), { cwd: runtimeRoot, env: safeEnvironment })).stdout);
    assertLocalReplayTarget(status.API_URL);
    const container = resolveOwnedContainer({ before, after: await listContainers(execute, safeEnvironment), projectId });
    const ledger = parseCsvRows(await executeUnixSocketPsql({
      execute,
      environment: safeEnvironment,
      containerId: container.id,
      sql: "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;\n",
    }));
    verifyLocalMigrationLedger({ mappings: mirror.mappings, rows: ledger });
    await execute("node", ["scripts/test-production-schema-fingerprint.mjs"], {
      cwd: repositoryRoot,
      env: {
        ...safeEnvironment,
        OPENGLASS_LOCAL_DISPOSABLE_DB_CONTAINER: container.id,
        OPENGLASS_LOCAL_DISPOSABLE_PROJECT_ID: projectId,
        OPENGLASS_LOCAL_DISPOSABLE_FINGERPRINT_CANDIDATE: path.join(runtimeRoot, "fingerprint-candidate.json"),
        OPENGLASS_LOCAL_DISPOSABLE_FINGERPRINT_REVIEW: path.join(runtimeRoot, "fingerprint-review.json"),
      },
    });
    return {
      localReplay: "PASS",
      localReplayTarget: "DISPOSABLE",
      schemaFingerprintTarget: "LOCAL_DISPOSABLE",
      schemaFingerprintProductionConnection: false,
      canonicalMigrationCount: mirror.migrationCount,
      migrationLedger: "PASS",
      remoteConnections: 0,
    };
  } finally {
    await cleanupOwnedDisposableReplay({ runtimeRoot, repositoryRoot, startAttempted, execute, environment: safeEnvironment });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== "--dry-run")) throw new Error("Only --dry-run is accepted; linked and remote Supabase options are forbidden");
  const result = await runLocalDisposableReplay({ dryRun: args.includes("--dry-run") });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
