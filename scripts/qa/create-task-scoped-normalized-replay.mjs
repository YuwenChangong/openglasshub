import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLocalSupabaseReplayMirror } from "../build-local-supabase-replay-mirror.mjs";
import { PINNED_PSQL_DIGEST, PINNED_PSQL_IMAGE } from "../lib/docker-psql-file-transport.mjs";
import { assertLocalDockerContext, normalizedReplayLabelSet, validateNormalizedReplayTaskId } from "../lib/task-scoped-normalized-replay.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const run = (args, options = {}) => {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `docker exited ${result.status}`);
  return result.stdout.trim();
};
const arg = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1] ?? null; };
const namesFor = (taskId) => {
  const suffix = taskId.slice("r6-final-contract-".length);
  return {
    container: `openglass-normalized-replay-${suffix}`,
    network: `openglass-normalized-replay-net-${suffix}`,
    volume: `openglass-normalized-replay-data-${suffix}`,
  };
};
const labelArgs = (labels) => Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]);
const supabaseEnv = () => {
  const env = { ...process.env, SUPABASE_DISABLE_TELEMETRY: "1" };
  delete env.SUPABASE_ACCESS_TOKEN;
  delete env.SUPABASE_DB_PASSWORD;
  delete env.SUPABASE_URL;
  return env;
};
const runSupabase = (args) => {
  const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--offline", "supabase", ...args], { encoding: "utf8", env: supabaseEnv(), shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message || `supabase exited ${result.status}`);
  return result.stdout.trim();
};

async function waitForReady(container) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", "postgres"], { encoding: "utf8" });
    if (ready.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("NORMALIZED_REPLAY_TASK_CONTAINER_NOT_READY");
}

function removeOwned(names, labels) {
  const container = spawnSync("docker", ["ps", "-aq", "--filter", `name=^/${names.container}$`, "--filter", `label=io.openglasshub.replay.task-id=${labels["io.openglasshub.replay.task-id"]}`], { encoding: "utf8" }).stdout?.trim();
  if (container) run(["rm", "-f", container]);
  const volume = spawnSync("docker", ["volume", "ls", "-q", "--filter", `name=^${names.volume}$`, "--filter", `label=io.openglasshub.replay.task-id=${labels["io.openglasshub.replay.task-id"]}`], { encoding: "utf8" }).stdout?.trim();
  if (volume) run(["volume", "rm", volume]);
  const network = spawnSync("docker", ["network", "ls", "-q", "--filter", `name=^${names.network}$`, "--filter", `label=io.openglasshub.replay.task-id=${labels["io.openglasshub.replay.task-id"]}`], { encoding: "utf8" }).stdout?.trim();
  if (network) run(["network", "rm", network]);
}

const taskId = validateNormalizedReplayTaskId(arg("--task-id"));
const labels = normalizedReplayLabelSet(taskId);
const names = namesFor(taskId);
assertLocalDockerContext(execFileSync);
const imageId = run(["image", "inspect", PINNED_PSQL_IMAGE, "--format", "{{.Id}}"]);
if (imageId !== PINNED_PSQL_DIGEST) throw new Error("NORMALIZED_REPLAY_PINNED_IMAGE_MISMATCH");
for (const name of Object.values(names)) {
  if (run(["ps", "-aq", "--filter", `name=^/${name}$`]) || run(["volume", "ls", "-q", "--filter", `name=^${name}$`]) || run(["network", "ls", "-q", "--filter", `name=^${name}$`])) {
    throw new Error("NORMALIZED_REPLAY_TASK_RESOURCE_ALREADY_EXISTS");
  }
}

let mirrorRoot;
let bootstrapProjectId;
let created = false;
try {
  mirrorRoot = await mkdtemp(path.join(os.tmpdir(), "openglass-normalized-replay-"));
  bootstrapProjectId = `r6p${taskId.slice("r6-final-contract-".length).replaceAll("-", "").slice(0, 12)}`;
  runSupabase(["init", "--yes", "--workdir", mirrorRoot]);
  const configPath = path.join(mirrorRoot, "supabase", "config.toml");
  const config = await readFile(configPath, "utf8");
  await writeFile(configPath, config.replace(/^project_id\s*=\s*"[^"]+"/m, `project_id = "${bootstrapProjectId}"`), "utf8");
  const migrations = path.join(mirrorRoot, "supabase", "migrations");
  const mapping = path.join(mirrorRoot, "mapping.json");
  const report = await buildLocalSupabaseReplayMirror({ canonicalDirectory: path.join(root, "supabase", "migrations"), outputDirectory: migrations, mappingPath: mapping, repositoryRoot: root });
  runSupabase(["start", "--workdir", mirrorRoot, "--exclude", "edge-runtime,gotrue,imgproxy,kong,logflare,mailpit,postgres-meta,postgrest,realtime,storage-api,studio,supavisor,vector"]);
  runSupabase(["db", "reset", "--local", "--no-seed", "--workdir", mirrorRoot]);
  const bootstrapContainer = run(["ps", "-q", "--filter", `name=^/supabase_db_${bootstrapProjectId}$`]);
  if (!bootstrapContainer || bootstrapContainer.includes("\n")) throw new Error("NORMALIZED_REPLAY_BOOTSTRAP_DATABASE_CARDINALITY_INVALID");
  const bootstrapVolume = run(["inspect", "--format", "{{range .Mounts}}{{if eq .Destination \"/var/lib/postgresql/data\"}}{{.Name}}{{end}}{{end}}", bootstrapContainer]);
  if (!bootstrapVolume) throw new Error("NORMALIZED_REPLAY_BOOTSTRAP_VOLUME_MISSING");
  runSupabase(["stop", "--workdir", mirrorRoot]);
  run(["network", "create", ...labelArgs(labels), names.network]);
  run(["volume", "create", ...labelArgs(labels), names.volume]);
  run(["run", "--rm", "--network", "none", "--mount", `type=volume,src=${bootstrapVolume},dst=/from,readonly`, "--mount", `type=volume,src=${names.volume},dst=/to`, "--entrypoint", "sh", PINNED_PSQL_IMAGE, "-ec", "cp -a /from/. /to/"]);
  run(["volume", "rm", bootstrapVolume]);
  bootstrapProjectId = null;
  run(["run", "-d", "--name", names.container, "--network", names.network, "--mount", `type=volume,src=${names.volume},dst=/var/lib/postgresql/data`, ...labelArgs(labels), "--env", "POSTGRES_HOST_AUTH_METHOD=trust", PINNED_PSQL_IMAGE]);
  created = true;
  await waitForReady(names.container);
  process.stdout.write(`${JSON.stringify({ classification: "NORMALIZED_REPLAY_TASK_CONTAINER_READY", taskId, containerId: run(["inspect", "--format", "{{.Id}}", names.container]), containerName: names.container, imageId, labels, network: names.network, volume: names.volume, migrationCount: report.migrationCount, bomTransformedFiles: report.bomTransformedFiles, dockerPulls: 0, remoteOperations: 0 })}\n`);
} catch (error) {
  if (created) removeOwned(names, labels);
  throw error;
} finally {
  if (bootstrapProjectId && mirrorRoot) {
    try { runSupabase(["stop", "--no-backup", "--workdir", mirrorRoot]); } catch { /* Preserve the original initialization failure. */ }
  }
  if (mirrorRoot) await rm(mirrorRoot, { recursive: true, force: true });
}
