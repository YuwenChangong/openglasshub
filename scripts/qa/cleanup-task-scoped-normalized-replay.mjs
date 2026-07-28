import { execFileSync, spawnSync } from "node:child_process";
import { assertLocalDockerContext, normalizedReplayLabelSet, validateNormalizedReplayTaskId } from "../lib/task-scoped-normalized-replay.mjs";

const taskId = validateNormalizedReplayTaskId(process.argv[process.argv.indexOf("--task-id") + 1]);
const labels = normalizedReplayLabelSet(taskId);
const suffix = taskId.slice("r6-final-contract-".length);
const names = { container: `openglass-normalized-replay-${suffix}`, network: `openglass-normalized-replay-net-${suffix}`, volume: `openglass-normalized-replay-data-${suffix}` };
const run = (args) => { const result = spawnSync("docker", args, { encoding: "utf8" }); if (result.status !== 0) throw new Error(result.stderr || result.stdout || `docker exited ${result.status}`); return result.stdout.trim(); };
const find = (kind, name) => run([kind, "ls", "-q", "--filter", `name=^${name}$`, "--filter", `label=io.openglasshub.replay.task-id=${labels["io.openglasshub.replay.task-id"]}`]);
assertLocalDockerContext(execFileSync);
const container = run(["ps", "-aq", "--filter", `name=^/${names.container}$`, "--filter", `label=io.openglasshub.replay.task-id=${labels["io.openglasshub.replay.task-id"]}`]);
if (container) run(["rm", "-f", container]);
const volume = find("volume", names.volume); if (volume) run(["volume", "rm", volume]);
const network = find("network", names.network); if (network) run(["network", "rm", network]);
process.stdout.write(`${JSON.stringify({ classification: "NORMALIZED_REPLAY_TASK_CONTAINER_CLEANED", taskId, removedContainer: Boolean(container), removedVolume: Boolean(volume), removedNetwork: Boolean(network), dockerPulls: 0, remoteOperations: 0 })}\n`);
