import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  BINDING_NAME,
  CLASSIFICATIONS,
  ENVIRONMENTS,
  packetForClassification,
  proofCases,
  validPacket,
} from "../tests/fixtures/operational-guardrails-service-role-binding-proof.mjs";
import { inspectServiceRoleBindingPacket, validateServiceRoleBindingPacket } from "./operational-guardrails-service-role-binding-proof-core.mjs";

const files = {
  legal: "src/lib/server/legal-consent-repository.server.ts",
  moderation: "src/lib/server/moderation-notifications.server.ts",
  browser: "src/lib/supabase-browser.ts",
  rateLimit: "src/lib/server/rate-limit.ts",
  writer: "scripts/write-operational-guardrails-service-role-binding-proof.mjs",
  validator: "scripts/validate-operational-guardrails-service-role-binding-proof.mjs",
  core: "scripts/operational-guardrails-service-role-binding-proof-core.mjs",
  identity: "docs/ops/reconciliation/operational-guardrails-rate-limit-rpc-trusted-identity.md",
  readiness: "docs/ops/reconciliation/operational-guardrails-service-role-binding-r1-readiness.md",
};
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await readFile(file, "utf8")])));

assert.equal(BINDING_NAME, "SUPABASE_SERVICE_ROLE_KEY");
assert.match(source.legal, /createLegalConsentServiceClient[\s\S]*SUPABASE_SERVICE_ROLE_KEY/);
assert.match(source.moderation, /createModerationNotificationServiceClient[\s\S]*SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(source.browser, /SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(source.rateLimit, /SUPABASE_SERVICE_ROLE_KEY|createClient\(/);
assert.doesNotMatch(`${source.legal}\n${source.moderation}`, /console\.(?:log|warn|error).*SUPABASE_SERVICE_ROLE_KEY/);
assert.match(source.identity, /EXISTING_BINDING_NAME_SOURCE_PROVEN/);
assert.match(source.readiness, /Local[\s\S]*CONFIGURATION_REQUIRED/);
assert.match(source.readiness, /Preview[\s\S]*BINDING_PROOF_REQUIRED/);
assert.match(source.readiness, /Production[\s\S]*BINDING_PROOF_REQUIRED/);
assert.match(source.readiness, /BLOCKED_RUNTIME_MIGRATION_REQUIRED/);

for (const environment of ENVIRONMENTS) assert.equal(validateServiceRoleBindingPacket(validPacket(environment)).environment, environment);
for (const classification of CLASSIFICATIONS) assert.equal(inspectServiceRoleBindingPacket(packetForClassification(classification)).classification, classification);
for (const packet of Object.values(proofCases)) assert.throws(() => validateServiceRoleBindingPacket(packet));
assert.throws(() => validateServiceRoleBindingPacket({ ...validPacket(), secret_value: "forbidden" }));
for (const text of [source.writer, source.validator, source.core]) assert.doesNotMatch(text, /fetch\(|https?:\/\/|wrangler|child_process|exec\(/i);
assert.match(source.writer, /flag: "wx"/);
assert.match(source.writer, /outside the repository/);
assert.match(source.writer, /classification must be one approved metadata result/);

async function collectClientSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return collectClientSources(file);
    return /\.(?:tsx|jsx)$/.test(entry.name) ? [await readFile(file, "utf8")] : [];
  }));
  return nested.flat();
}
const clientSources = (await collectClientSources("src/components")).join("\n");
assert.doesNotMatch(clientSources, /legal-consent-repository\.server|moderation-notifications\.server|SUPABASE_SERVICE_ROLE_KEY/);
console.log("operational-guardrails service-role binding proof: PASS offline-cases=8");
