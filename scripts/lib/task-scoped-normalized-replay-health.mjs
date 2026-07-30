export const NORMALIZED_REPLAY_HEALTHCHECK = Object.freeze({
  command: "pg_isready -U postgres -h localhost",
  interval: "2s",
  timeout: "2s",
  retries: "10",
  startPeriod: "0s",
  pollMilliseconds: 250,
  maximumWaitMilliseconds: 30000,
});

const fail = (code) => { throw Object.assign(new Error(code), { code }); };

export function normalizedReplayHealthcheckDockerArgs() {
  return Object.freeze([
    "--health-cmd", NORMALIZED_REPLAY_HEALTHCHECK.command,
    "--health-interval", NORMALIZED_REPLAY_HEALTHCHECK.interval,
    "--health-timeout", NORMALIZED_REPLAY_HEALTHCHECK.timeout,
    "--health-retries", NORMALIZED_REPLAY_HEALTHCHECK.retries,
    "--health-start-period", NORMALIZED_REPLAY_HEALTHCHECK.startPeriod,
  ]);
}

export async function waitForNormalizedReplayHealthy({ inspect, sleep = async () => {}, maximumWaitMilliseconds = NORMALIZED_REPLAY_HEALTHCHECK.maximumWaitMilliseconds, pollMilliseconds = NORMALIZED_REPLAY_HEALTHCHECK.pollMilliseconds }) {
  const transitions = [];
  for (let elapsedMilliseconds = 0; elapsedMilliseconds <= maximumWaitMilliseconds; elapsedMilliseconds += pollMilliseconds) {
    let state;
    try {
      state = inspect();
    } catch {
      fail("NORMALIZED_REPLAY_TASK_HEALTH_INSPECT_FAILED");
    }
    if (!state || typeof state !== "object" || typeof state.running !== "boolean" || typeof state.health !== "string") fail("NORMALIZED_REPLAY_TASK_HEALTH_INSPECT_FAILED");
    if (!transitions.includes(state.health)) transitions.push(state.health);
    if (!state.running) fail("NORMALIZED_REPLAY_TASK_CONTAINER_EXITED");
    if (state.health === "healthy") return Object.freeze({ health: state.health, transitions: Object.freeze(transitions), elapsedMilliseconds });
    if (state.health === "missing" || state.health === "none") fail("NORMALIZED_REPLAY_TASK_HEALTHCHECK_MISSING");
    if (state.health === "unhealthy") fail("NORMALIZED_REPLAY_TASK_HEALTH_UNHEALTHY");
    if (state.health !== "starting") fail("NORMALIZED_REPLAY_TASK_HEALTH_INSPECT_FAILED");
    if (elapsedMilliseconds === maximumWaitMilliseconds) break;
    await sleep(Math.min(pollMilliseconds, maximumWaitMilliseconds - elapsedMilliseconds));
  }
  fail("NORMALIZED_REPLAY_TASK_HEALTH_START_TIMEOUT");
}
