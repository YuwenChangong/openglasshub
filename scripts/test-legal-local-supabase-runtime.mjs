import assert from "node:assert/strict";
import { LEGAL_LOCAL_SUPABASE_REQUIRED_CAPABILITIES, createLegalLocalSupabaseRuntimeContract, createLegalLocalSupabaseRuntimeManifest, createRuntimeCapabilityTerminal, createTaskOwnedSupabaseHbaConfiguration, runtimeCapabilityContractSha256, runtimeComponentSetSha256, validateLegalLocalSupabaseRuntimeManifest, validatePinnedSupabaseRuntimeComponents } from "./lib/legal-local-supabase-runtime.mjs";

const implementationCommit = "43d2106e030919b74cfb5b6fb7fbd4da5ec86ffa";
const taskId = "r6-local-predeployment-11111111-2222-4333-8444-555555555555";
const hash = (character) => character.repeat(64);
const contract = createLegalLocalSupabaseRuntimeContract({ implementationCommit });
assert.equal(contract.runtimeComponentSetSha256, runtimeComponentSetSha256());
assert.equal(contract.runtimeCapabilityContractSha256, runtimeCapabilityContractSha256());
const manifest = createLegalLocalSupabaseRuntimeManifest({ implementationCommit, taskId, networkIdentityHash: hash("a"), databaseIdentityHash: hash("b"), createdAt: "2026-08-07T00:00:00.000Z" });
assert.equal(validateLegalLocalSupabaseRuntimeManifest(manifest, { implementationCommit, taskId }).classification, "R6_LOCAL_SUPABASE_RUNTIME_MANIFEST_READY");
assert.throws(() => validatePinnedSupabaseRuntimeComponents([{ ...manifest.components[0], tag: "latest" }]), /R6_LOCAL_SUPABASE_RUNTIME_COMPONENT_SET_INVALID/);
assert.throws(() => validatePinnedSupabaseRuntimeComponents([{ ...manifest.components[0], digest: `sha256:${"f".repeat(64)}` }, manifest.components[1]]), /R6_LOCAL_SUPABASE_RUNTIME_COMPONENT_SET_INVALID/);
assert.equal(createTaskOwnedSupabaseHbaConfiguration().networkAuthentication, "TASK_OWNED_ISOLATED_TRUST_HBA");
const names = [...manifest.requiredCapabilities, ...manifest.optionalCapabilities];
const ready = createRuntimeCapabilityTerminal({ taskId, implementationCommit, runtimeManifestSha256: hash("c"), capabilityStates: names.map((name) => ({ name, present: true, required: manifest.requiredCapabilities.includes(name) })) });
assert.equal(ready.classification, "R6_LOCAL_SUPABASE_RUNTIME_CAPABILITY_READY");
const missingAuth = createRuntimeCapabilityTerminal({ taskId, implementationCommit, runtimeManifestSha256: hash("c"), capabilityStates: names.map((name) => ({ name, present: name !== "AUTH_UID_FUNCTION", required: manifest.requiredCapabilities.includes(name) })) });
assert.equal(missingAuth.classification, "R6_LOCAL_SUPABASE_RUNTIME_CAPABILITY_INCOMPLETE");
assert.deepEqual(missingAuth.missingCapabilities, ["AUTH_UID_FUNCTION"]);
for (const capability of ["AUTH_SCHEMA", "STORAGE_OBJECTS", "ANON_ROLE", "SERVICE_ROLE_ROLE", "PGCRYPTO_EXTENSION"]) {
  const incomplete = createRuntimeCapabilityTerminal({ taskId, implementationCommit, runtimeManifestSha256: hash("d"), capabilityStates: names.map((name) => ({ name, present: name !== capability, required: LEGAL_LOCAL_SUPABASE_REQUIRED_CAPABILITIES.includes(name) })) });
  assert.deepEqual(incomplete.missingCapabilities, [capability]);
}
console.log(JSON.stringify({ classification: "R6_LOCAL_SUPABASE_RUNTIME_CONTRACT_TESTS_READY", componentCount: manifest.components.length, requiredCapabilityCount: manifest.requiredCapabilities.length, realOperations: 0 }));
