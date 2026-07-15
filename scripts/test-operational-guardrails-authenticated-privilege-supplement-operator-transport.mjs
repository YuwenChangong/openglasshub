import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = await readFile("scripts/run-operational-guardrails-authenticated-privilege-supplement.ps1", "utf8");

assert.match(script, /docker run --rm -it --read-only/);
assert.match(script, /public\.ecr\.aws\/supabase\/postgres:17\.6\.1\.143@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453/);
assert.match(script, /type=bind,src=\$packet,dst=\$mountedPacket,readonly/);
assert.match(script, /type=bind,src=\$stagingCsv,dst=\$mountedOutput/);
assert.match(script, /\[System\.IO\.File\]::Open\(\$stagingCsv, \[System\.IO\.FileMode\]::CreateNew/);
assert.match(script, /-X -W -q --csv -v ON_ERROR_STOP=1/);
assert.match(script, /sslmode=require/);
assert.match(script, /\[System\.IO\.File\]::Move\(\$stagingCsv, \$finalCsv\)/);
assert.match(script, /\[System\.IO\.File\]::Move\(\$stagingCsv, \$quarantine\)/);
assert.match(script, /validate-operational-guardrails-authenticated-privilege-supplement\.mjs/);
assert.match(script, /PGPASSWORD/);
assert.match(script, /pooler\|supavisor/);
assert.doesNotMatch(script, /--env-file|PGPASSFILE=|PGPASSWORD=|postgresql:\/\//i);

console.log("operational-guardrails authenticated privilege operator transport static contract: PASS");
