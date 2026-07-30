import assert from "node:assert/strict";
import { NORMALIZED_REPLAY_HEALTHCHECK, normalizedReplayHealthcheckDockerArgs, waitForNormalizedReplayHealthy } from "./lib/task-scoped-normalized-replay-health.mjs";

assert.deepEqual(normalizedReplayHealthcheckDockerArgs(), ["--health-cmd", "pg_isready -U postgres -h localhost", "--health-interval", "2s", "--health-timeout", "2s", "--health-retries", "10", "--health-start-period", "0s"]);
assert.equal(NORMALIZED_REPLAY_HEALTHCHECK.maximumWaitMilliseconds, 30000);

const sequence = (values) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
};
const sleep = async () => {};

const ready = await waitForNormalizedReplayHealthy({ inspect: sequence([{ running: true, health: "starting" }, { running: true, health: "healthy" }]), sleep });
assert.deepEqual(ready, { health: "healthy", transitions: ["starting", "healthy"], elapsedMilliseconds: 250 });
for (const [state, code] of [
  [{ running: true, health: "missing" }, "NORMALIZED_REPLAY_TASK_HEALTHCHECK_MISSING"],
  [{ running: true, health: "unhealthy" }, "NORMALIZED_REPLAY_TASK_HEALTH_UNHEALTHY"],
  [{ running: false, health: "starting" }, "NORMALIZED_REPLAY_TASK_CONTAINER_EXITED"],
]) {
  await assert.rejects(() => waitForNormalizedReplayHealthy({ inspect: sequence([state]), sleep }), { message: code });
}
await assert.rejects(() => waitForNormalizedReplayHealthy({ inspect: sequence([{ running: true, health: "starting" }]), sleep, maximumWaitMilliseconds: 500, pollMilliseconds: 250 }), { message: "NORMALIZED_REPLAY_TASK_HEALTH_START_TIMEOUT" });
await assert.rejects(() => waitForNormalizedReplayHealthy({ inspect: () => { throw new Error("inspect"); }, sleep }), { message: "NORMALIZED_REPLAY_TASK_HEALTH_INSPECT_FAILED" });

console.log(JSON.stringify({ classification: "NORMALIZED_REPLAY_TASK_HEALTH_FIXTURES_PASSED", scenarios: 7, realDockerOperations: 0 }));
