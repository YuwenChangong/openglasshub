import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  findPrivilegedClientSurfaceFindings,
} from "./lib/operational-guardrails-privileged-client-surface.mjs";
import { negativePrivilegedClientFixtures } from "../tests/fixtures/operational-guardrails-privileged-client-surface.mjs";

const allowedConsumers = [
  "src/lib/server/legal-consent-repository.server.ts",
  "src/lib/server/moderation-notifications.server.ts",
  "src/lib/server/consume-forum-rate-limit.server.ts",
];

for (const fixture of negativePrivilegedClientFixtures) {
  assert(findPrivilegedClientSurfaceFindings(fixture.source, `${fixture.name}.ts`).includes(fixture.finding), fixture.name);
}

for (const file of allowedConsumers) {
  const source = await readFile(file, "utf8");
  assert.deepEqual(findPrivilegedClientSurfaceFindings(source, file), [], `${file} must not expose a generic privileged-client surface`);
}

const legacySource = await readFile("functions/_lib/supabase.ts", "utf8");
assert.deepEqual(findPrivilegedClientSurfaceFindings(legacySource, "functions/_lib/supabase.ts"), [], "deprecated compatibility helpers must not retain a generic privileged surface");
assert.doesNotMatch(legacySource, /SUPABASE_SERVICE_ROLE_KEY|createServiceClient|createServiceRoleClient/i);

console.log(JSON.stringify({ status: "PASS", negativeFixtures: negativePrivilegedClientFixtures.length, approvedConsumers: allowedConsumers.length }));
