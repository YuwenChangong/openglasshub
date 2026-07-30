import assert from "node:assert/strict";
import { NORMALIZED_REPLAY_CONTRACT_VERSION, NORMALIZED_REPLAY_LABELS, discoverTaskScopedNormalizedReplay, normalizedReplayLabelSet, validateNormalizedReplayTaskId } from "./lib/task-scoped-normalized-replay.mjs";

const taskId = "r6-final-contract-11111111-1111-4111-8111-111111111111";
const otherTask = "r6-final-contract-22222222-2222-4222-8222-222222222222";
const labels = (id, overrides = {}) => ({ ...normalizedReplayLabelSet(id), ...overrides });
const container = (id, labelSet = labels(taskId), overrides = {}) => ({ id, labels: labelSet, running: true, health: "healthy", imageId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", networks: { [`openglass-${taskId}`]: {} }, mounts: [{ Type: "volume", Name: `openglass-${taskId}` }], ...overrides });

function fakeDocker(containers, context = "desktop-linux") {
  return (command, args) => {
    assert.equal(command, "docker");
    if (args.join(" ") === "context show") return context;
    if (args[0] === "ps") {
      const filters = args.filter((value) => value.startsWith("label=")).map((value) => value.slice("label=".length));
      return `${containers.filter((candidate) => filters.every((filter) => {
        const index = filter.indexOf("=");
        return candidate.labels[filter.slice(0, index)] === filter.slice(index + 1);
      })).map((candidate) => candidate.id).join("\n")}\n`;
    }
    if (args[0] === "inspect") {
      const value = containers.find((candidate) => candidate.id === args.at(-1));
      return `${JSON.stringify(value.labels)}\t${value.running}\t${value.health}\t${value.imageId}\t${JSON.stringify(value.networks)}\t${JSON.stringify(value.mounts)}\n`;
    }
    throw new Error("unexpected docker command");
  };
}

const current = container("current");
const oldPrefix = container("old-prefix", { "com.docker.compose.project": "local-supabase-normalized-replay-2026071" });
assert.equal(discoverTaskScopedNormalizedReplay({ taskId, run: fakeDocker([oldPrefix, current]) }).containerId, "current");
assert.throws(() => discoverTaskScopedNormalizedReplay({ taskId, run: fakeDocker([]) }), /NORMALIZED_REPLAY_TASK_CONTAINER_MISSING/);
assert.throws(() => discoverTaskScopedNormalizedReplay({ taskId, run: fakeDocker([current, container("duplicate")]) }), /NORMALIZED_REPLAY_TASK_CONTAINER_CARDINALITY_INVALID/);
assert.throws(() => discoverTaskScopedNormalizedReplay({ taskId, run: fakeDocker([oldPrefix]) }), /NORMALIZED_REPLAY_TASK_CONTAINER_MISSING/);
assert.equal(discoverTaskScopedNormalizedReplay({ taskId, run: fakeDocker([oldPrefix, current, container("other", labels(otherTask))]) }).containerId, "current");
assert.throws(() => discoverTaskScopedNormalizedReplay({ taskId, run: fakeDocker([container("role", labels(taskId, { [NORMALIZED_REPLAY_LABELS.role]: "wrong" }))]) }), /NORMALIZED_REPLAY_TASK_CONTAINER_MISSING/);
assert.throws(() => discoverTaskScopedNormalizedReplay({ taskId, run: fakeDocker([container("disposable", labels(taskId, { [NORMALIZED_REPLAY_LABELS.disposable]: "false" }))]) }), /NORMALIZED_REPLAY_TASK_CONTAINER_MISSING/);
assert.throws(() => discoverTaskScopedNormalizedReplay({ taskId, run: fakeDocker([container("version", labels(taskId, { [NORMALIZED_REPLAY_LABELS.contractVersion]: "unsupported" }))]) }), /NORMALIZED_REPLAY_TASK_CONTAINER_MISSING/);
assert.throws(() => discoverTaskScopedNormalizedReplay({ taskId, run: fakeDocker([container("stopped", labels(taskId), { running: false })]) }), /NORMALIZED_REPLAY_TASK_CONTAINER_NOT_RUNNING/);
assert.throws(() => discoverTaskScopedNormalizedReplay({ taskId, run: fakeDocker([container("missing-health", labels(taskId), { health: "missing" })]) }), /NORMALIZED_REPLAY_TASK_CONTAINER_HEALTH_INVALID/);
assert.throws(() => discoverTaskScopedNormalizedReplay({ taskId, run: fakeDocker([container("starting", labels(taskId), { health: "starting" })]) }), /NORMALIZED_REPLAY_TASK_CONTAINER_HEALTH_INVALID/);
assert.throws(() => discoverTaskScopedNormalizedReplay({ taskId, run: fakeDocker([container("unhealthy", labels(taskId), { health: "unhealthy" })]) }), /NORMALIZED_REPLAY_TASK_CONTAINER_HEALTH_INVALID/);
assert.throws(() => discoverTaskScopedNormalizedReplay({ taskId, run: fakeDocker([current], "remote-prod") }), /NORMALIZED_REPLAY_DOCKER_CONTEXT_NOT_LOCAL/);
assert.throws(() => discoverTaskScopedNormalizedReplay({ taskId, run: fakeDocker([container("remote-target", labels(taskId), { networks: { remote: {}, local: {} } })]) }), /NORMALIZED_REPLAY_TASK_CONTAINER_ISOLATION_INVALID/);
assert.throws(() => validateNormalizedReplayTaskId(""), /NORMALIZED_REPLAY_TASK_ID_INVALID/);
assert.throws(() => validateNormalizedReplayTaskId("r6-final-contract-not-a-uuid"), /NORMALIZED_REPLAY_TASK_ID_INVALID/);
assert.throws(() => discoverTaskScopedNormalizedReplay({ taskId, run: fakeDocker([container("prefix-spoof", { name: "supabase_db_local-supabase-normalized-replay-spoof" })]) }), /NORMALIZED_REPLAY_TASK_CONTAINER_MISSING/);
assert.equal(NORMALIZED_REPLAY_CONTRACT_VERSION, "openglass-normalized-replay-task-v1");
console.log(JSON.stringify({ classification: "NORMALIZED_REPLAY_TASK_SCOPING_FIXTURES_PASSED", scenarios: 16, realDockerOperations: 0 }));
