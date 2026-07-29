import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("scripts/test-circles-visibility-reconciliation.mjs", "utf8");

assert.match(source, /import\s+\{\s*discoverTaskScopedNormalizedReplay\s*\}\s+from\s+"\.\/lib\/task-scoped-normalized-replay\.mjs"/);
assert.match(source, /const\s+\{\s*containerId:\s*container\s*\}\s*=\s*discoverTaskScopedNormalizedReplay\(\);/);
assert.doesNotMatch(source, /supabase_db_local-supabase-normalized-replay-/);
assert.doesNotMatch(source, /docker",\s*\["ps",\s*"--format",\s*"\{\{\.Names\}\}"/);

console.log(JSON.stringify({ classification: "CIRCLES_VISIBILITY_TASK_SCOPED_DISCOVERY_FIXTURE_PASSED", realDockerOperations: 0 }));
