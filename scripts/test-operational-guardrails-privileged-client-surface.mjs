import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  findPrivilegedClientSurfaceFindings,
} from "./lib/operational-guardrails-privileged-client-surface.mjs";
import { negativePrivilegedClientFixtures } from "../tests/fixtures/operational-guardrails-privileged-client-surface.mjs";
import { ACTIVE_CONSUMERS } from "../tests/fixtures/operational-guardrails-service-role-consumer-scope.mjs";

const allowedConsumers = ACTIVE_CONSUMERS.map((consumer) => consumer.path);

for (const fixture of negativePrivilegedClientFixtures) {
  assert(findPrivilegedClientSurfaceFindings(fixture.source, `${fixture.name}.ts`).includes(fixture.finding), fixture.name);
}

for (const [name, source] of [
  ["array from", "const bytes = Array.from(input);"],
  ["array from mapper", "const values = Array.from(items, (item) => item.id);"],
  ["declared class from", "class SomeClass { static from(value: unknown) { return value; } } SomeClass.from(value);"],
  ["literal table", 'client.from("forum_upload_attempts");'],
  ["literal rpc", 'client.rpc("ogh_fixed_rpc", args);'],
]) {
  assert.deepEqual(findPrivilegedClientSurfaceFindings(source, `${name}.ts`), [], name);
}
for (const [name, source, finding] of [
  ["dynamic client table", "client.from(tableName);", "arbitrary-table-name"],
  ["dynamic service table", "service.from(dynamicTable);", "arbitrary-table-name"],
  ["dynamic supabase table", "someSupabaseClient.from(dynamicName);", "arbitrary-table-name"],
  ["shadowed array table", "const Array = client; Array.from(tableName);", "arbitrary-table-name"],
  ["dynamic rpc", "client.rpc(rpcName, args);", "arbitrary-rpc-name"],
]) {
  assert(findPrivilegedClientSurfaceFindings(source, `${name}.ts`).includes(finding), name);
}

for (const file of allowedConsumers) {
  const source = await readFile(file, "utf8");
  assert.deepEqual(findPrivilegedClientSurfaceFindings(source, file), [], `${file} must not expose a generic privileged-client surface`);
}

const legacySource = await readFile("functions/_lib/supabase.ts", "utf8");
assert.deepEqual(findPrivilegedClientSurfaceFindings(legacySource, "functions/_lib/supabase.ts"), [], "deprecated compatibility helpers must not retain a generic privileged surface");
assert.doesNotMatch(legacySource, /SUPABASE_SERVICE_ROLE_KEY|createServiceClient|createServiceRoleClient/i);

console.log(JSON.stringify({ status: "PASS", negativeFixtures: negativePrivilegedClientFixtures.length, approvedConsumers: allowedConsumers.length }));
