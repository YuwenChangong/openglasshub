import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("scripts/qa/create-task-scoped-normalized-replay.mjs", "utf8");
const cleanup = await readFile("scripts/qa/cleanup-task-scoped-normalized-replay.mjs", "utf8");

assert.match(source, /normalizedReplayLabelSet/);
assert.match(source, /npx\.cmd[\s\S]*--offline[\s\S]*supabase/);
assert.match(source, /buildLocalSupabaseReplayMirror/);
assert.match(source, /db", "reset", "--local", "--no-seed/);
assert.match(source, /type=volume,src=\$\{bootstrapVolume\},dst=\/from,readonly/);
assert.match(source, /type=volume,src=\$\{names\.volume\},dst=\/to/);
assert.match(source, /"--network", "none"/);
assert.match(source, /PINNED_PSQL_DIGEST/);
assert.match(source, /normalizedReplayHealthcheckDockerArgs/);
assert.match(source, /waitForNormalizedReplayHealthy/);
assert.match(source, /discoverTaskScopedNormalizedReplay\(\{ taskId \}\)/);
assert.match(source, /inspectedContainerId\.startsWith\(discovered\.containerId\)/);
assert.match(source, /healthStatus: health\.health/);
assert.match(source, /healthTransitions: health\.transitions/);
assert.match(source, /volume=\$\{volume\}/);
assert.match(source, /function removeBootstrapVolumes\(projectId\)/);
assert.match(source, /label=com\.supabase\.cli\.project=\$\{projectId\}/);
assert.match(source, /removeBootstrapVolumes\(bootstrapProjectId\)/);
assert.doesNotMatch(source, /docker", \["pull"|supabase login|--linked|--db-url|cloudflare/i);
assert.match(cleanup, /NORMALIZED_REPLAY_TASK_CONTAINER_CLEANED/);
assert.doesNotMatch(cleanup, /system prune|container prune|volume prune|network prune/i);
console.log(JSON.stringify({ classification: "NORMALIZED_REPLAY_TASK_FACTORY_STATIC_CONTRACT_PASSED", dockerPulls: 0, remoteOperations: 0 }));
