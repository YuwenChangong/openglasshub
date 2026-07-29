import { execFileSync } from "node:child_process";

export const NORMALIZED_REPLAY_CONTRACT_VERSION = "openglass-normalized-replay-task-v1";
export const NORMALIZED_REPLAY_TASK_ENV = "OPENGLASS_NORMALIZED_REPLAY_TASK_ID";
export const NORMALIZED_REPLAY_LABELS = Object.freeze({
  project: "io.openglasshub.replay.project",
  role: "io.openglasshub.replay.role",
  taskId: "io.openglasshub.replay.task-id",
  disposable: "io.openglasshub.replay.disposable",
  contractVersion: "io.openglasshub.replay.contract-version",
});

const TASK_ID = /^r6-final-contract-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL_CONTEXTS = new Set(["desktop-linux"]);
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

export function validateNormalizedReplayTaskId(taskId) {
  if (!TASK_ID.test(String(taskId ?? ""))) fail("NORMALIZED_REPLAY_TASK_ID_INVALID");
  return String(taskId);
}

export function normalizedReplayLabelSet(taskId) {
  const id = validateNormalizedReplayTaskId(taskId);
  return Object.freeze({
    [NORMALIZED_REPLAY_LABELS.project]: "openglasshub",
    [NORMALIZED_REPLAY_LABELS.role]: "normalized-replay",
    [NORMALIZED_REPLAY_LABELS.taskId]: id,
    [NORMALIZED_REPLAY_LABELS.disposable]: "true",
    [NORMALIZED_REPLAY_LABELS.contractVersion]: NORMALIZED_REPLAY_CONTRACT_VERSION,
  });
}

export function assertLocalDockerContext(run = execFileSync) {
  const context = String(run("docker", ["context", "show"], { encoding: "utf8" })).trim();
  if (!LOCAL_CONTEXTS.has(context)) fail("NORMALIZED_REPLAY_DOCKER_CONTEXT_NOT_LOCAL");
  return context;
}

function parseLines(output) {
  return String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function labelsMatch(labels, required) {
  return Object.entries(required).every(([key, value]) => labels?.[key] === value);
}

function inspectContainer(id, run) {
  const format = "{{json .Config.Labels}}\t{{.State.Running}}\t{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}\t{{.Image}}\t{{json .NetworkSettings.Networks}}\t{{json .Mounts}}";
  const row = String(run("docker", ["inspect", "--format", format, id], { encoding: "utf8" })).trim();
  const [labelsRaw, runningRaw, healthRaw, imageId, networksRaw, mountsRaw] = row.split("\t");
  try {
    return {
      id,
      labels: JSON.parse(labelsRaw),
      running: runningRaw === "true",
      health: healthRaw,
      imageId,
      networks: JSON.parse(networksRaw),
      mounts: JSON.parse(mountsRaw),
    };
  } catch {
    fail("NORMALIZED_REPLAY_CONTAINER_METADATA_INVALID");
  }
}

export function discoverTaskScopedNormalizedReplay({ taskId = process.env[NORMALIZED_REPLAY_TASK_ENV], run = execFileSync } = {}) {
  const id = validateNormalizedReplayTaskId(taskId);
  const context = assertLocalDockerContext(run);
  const labels = normalizedReplayLabelSet(id);
  const filters = Object.entries(labels).flatMap(([key, value]) => ["--filter", `label=${key}=${value}`]);
  const candidates = parseLines(run("docker", ["ps", "-a", "--quiet", ...filters], { encoding: "utf8" }));
  if (candidates.length !== 1) fail(candidates.length === 0 ? "NORMALIZED_REPLAY_TASK_CONTAINER_MISSING" : "NORMALIZED_REPLAY_TASK_CONTAINER_CARDINALITY_INVALID");
  const container = inspectContainer(candidates[0], run);
  if (!labelsMatch(container.labels, labels)) fail("NORMALIZED_REPLAY_TASK_CONTAINER_LABELS_INVALID");
  if (!container.running) fail("NORMALIZED_REPLAY_TASK_CONTAINER_NOT_RUNNING");
  if (container.health !== "healthy") fail("NORMALIZED_REPLAY_TASK_CONTAINER_HEALTH_INVALID");
  if (!container.imageId.startsWith("sha256:")) fail("NORMALIZED_REPLAY_TASK_CONTAINER_IMAGE_INVALID");
  const networkNames = Object.keys(container.networks ?? {});
  const volumes = (container.mounts ?? []).filter((mount) => mount.Type === "volume");
  if (networkNames.length !== 1 || volumes.length !== 1 || !volumes[0].Name) fail("NORMALIZED_REPLAY_TASK_CONTAINER_ISOLATION_INVALID");
  return Object.freeze({ taskId: id, context, containerId: container.id, containerName: null, imageId: container.imageId, labels, network: networkNames[0], volume: volumes[0].Name });
}
