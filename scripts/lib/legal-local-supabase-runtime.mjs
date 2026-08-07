import { randomBytes } from "node:crypto";
import { sha256, stableJson } from "./legal-local-replay-evidence.mjs";

export const LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE = "LOCAL_SUPABASE_RUNTIME";
export const LEGAL_LOCAL_SUPABASE_RUNTIME_MANIFEST_SCHEMA = "legal-local-supabase-runtime-manifest-v1";
export const LEGAL_LOCAL_SUPABASE_RUNTIME_CAPABILITY_SCHEMA = "legal-local-supabase-runtime-capability-terminal-v1";

export const LEGAL_LOCAL_SUPABASE_RUNTIME_COMPONENTS = Object.freeze([
  Object.freeze({
    name: "supabase-db",
    image: "public.ecr.aws/supabase/postgres",
    tag: "17.6.1.143",
    digest: "sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453",
    purpose: "Supabase database platform schemas, roles, extensions, and migration execution",
    healthCheck: "pg_isready -U postgres -h localhost",
  }),
  Object.freeze({
    name: "supabase-storage-api",
    image: "public.ecr.aws/supabase/storage-api",
    tag: "v1.62.5",
    digest: "sha256:1dbe962d9862ef12e20357f9d7ba5431989c1daf4a556d6cb20ee4efd1c57320",
    purpose: "Official Storage API migration owner for storage schema, objects, buckets, and functions",
    healthCheck: "running plus database capability validation",
  }),
]);

export const LEGAL_LOCAL_SUPABASE_REQUIRED_CAPABILITIES = Object.freeze([
  "DATABASE_RESPONDS",
  "AUTH_SCHEMA",
  "AUTH_USERS",
  "AUTH_UID_FUNCTION",
  "STORAGE_SCHEMA",
  "STORAGE_OBJECTS",
  "STORAGE_BUCKETS",
  "STORAGE_FOLDERNAME_FUNCTION",
  "ANON_ROLE",
  "AUTHENTICATED_ROLE",
  "SERVICE_ROLE_ROLE",
  "PGCRYPTO_EXTENSION",
]);

export const LEGAL_LOCAL_SUPABASE_OPTIONAL_CAPABILITIES = Object.freeze(["SUPABASE_REALTIME_PUBLICATION"]);

const TASK_OWNED_SUPABASE_HBA = [
  "# Task-owned local Supabase runtime only.",
  "local all all trust",
  "host all all 0.0.0.0/0 trust",
  "host all all ::0/0 trust",
  "",
].join("\n");

const HASH = /^[a-f0-9]{64}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

export function runtimeComponentReference(component) {
  return `${component.image}:${component.tag}`;
}

export function runtimeComponentSetSha256() {
  return sha256(stableJson(LEGAL_LOCAL_SUPABASE_RUNTIME_COMPONENTS));
}

export function runtimeCapabilityContractSha256() {
  return sha256(stableJson({ required: LEGAL_LOCAL_SUPABASE_REQUIRED_CAPABILITIES, optional: LEGAL_LOCAL_SUPABASE_OPTIONAL_CAPABILITIES }));
}

export function createTaskOwnedSupabaseHbaConfiguration() {
  return Object.freeze({
    networkAuthentication: "TASK_OWNED_ISOLATED_TRUST_HBA",
    content: TASK_OWNED_SUPABASE_HBA,
    sha256: sha256(TASK_OWNED_SUPABASE_HBA),
  });
}

export function validateLegalLocalSupabaseRuntimeContract(contract) {
  if (!contract || contract.runtimeProfile !== LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE || contract.runtimeManifestSchema !== LEGAL_LOCAL_SUPABASE_RUNTIME_MANIFEST_SCHEMA) fail("R6_LOCAL_SUPABASE_RUNTIME_CONTRACT_INVALID");
  if (contract.runtimeComponentSetSha256 !== runtimeComponentSetSha256() || contract.runtimeCapabilityContractSha256 !== runtimeCapabilityContractSha256()) fail("R6_LOCAL_SUPABASE_RUNTIME_CONTRACT_INVALID");
  return Object.freeze({ classification: "R6_LOCAL_SUPABASE_RUNTIME_CONTRACT_READY" });
}

export function createLegalLocalSupabaseRuntimeContract({ implementationCommit }) {
  if (!/^[a-f0-9]{40}$/.test(String(implementationCommit ?? ""))) fail("R6_LOCAL_SUPABASE_RUNTIME_COMMIT_INVALID");
  const contract = Object.freeze({
    runtimeProfile: LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE,
    runtimeManifestSchema: LEGAL_LOCAL_SUPABASE_RUNTIME_MANIFEST_SCHEMA,
    runtimeComponentSetSha256: runtimeComponentSetSha256(),
    runtimeCapabilityContractSha256: runtimeCapabilityContractSha256(),
    implementationCommit,
  });
  validateLegalLocalSupabaseRuntimeContract(contract);
  return contract;
}

export function validatePinnedSupabaseRuntimeComponents(components) {
  if (!Array.isArray(components) || components.length !== LEGAL_LOCAL_SUPABASE_RUNTIME_COMPONENTS.length) fail("R6_LOCAL_SUPABASE_RUNTIME_COMPONENT_SET_INVALID");
  for (const [index, expected] of LEGAL_LOCAL_SUPABASE_RUNTIME_COMPONENTS.entries()) {
    const actual = components[index];
    if (!actual || actual.name !== expected.name || actual.image !== expected.image || actual.tag !== expected.tag || actual.digest !== expected.digest || actual.tag === "latest" || !DIGEST.test(actual.digest)) fail("R6_LOCAL_SUPABASE_RUNTIME_COMPONENT_SET_INVALID");
  }
  return Object.freeze({ classification: "R6_LOCAL_SUPABASE_RUNTIME_COMPONENT_SET_READY", runtimeComponentSetSha256: runtimeComponentSetSha256() });
}

export function createLegalLocalSupabaseRuntimeManifest({ implementationCommit, taskId, networkIdentityHash, databaseIdentityHash, networkAuthenticationConfigSha256 = createTaskOwnedSupabaseHbaConfiguration().sha256, createdAt = new Date().toISOString() }) {
  if (!/^[a-f0-9]{40}$/.test(String(implementationCommit ?? "")) || typeof taskId !== "string" || !HASH.test(String(networkIdentityHash ?? "")) || !HASH.test(String(databaseIdentityHash ?? "")) || networkAuthenticationConfigSha256 !== createTaskOwnedSupabaseHbaConfiguration().sha256) fail("R6_LOCAL_SUPABASE_RUNTIME_MANIFEST_INVALID");
  const manifest = Object.freeze({
    schemaVersion: LEGAL_LOCAL_SUPABASE_RUNTIME_MANIFEST_SCHEMA,
    implementationCommit,
    runtimeProfile: LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE,
    runtimeVersion: LEGAL_LOCAL_SUPABASE_RUNTIME_COMPONENTS[0].tag,
    taskId,
    components: LEGAL_LOCAL_SUPABASE_RUNTIME_COMPONENTS,
    runtimeComponentSetSha256: runtimeComponentSetSha256(),
    runtimeCapabilityContractSha256: runtimeCapabilityContractSha256(),
    networkIdentityHash,
    databaseIdentityHash,
    networkAuthentication: "TASK_OWNED_ISOLATED_TRUST_HBA",
    networkAuthenticationConfigSha256,
    requiredCapabilities: LEGAL_LOCAL_SUPABASE_REQUIRED_CAPABILITIES,
    optionalCapabilities: LEGAL_LOCAL_SUPABASE_OPTIONAL_CAPABILITIES,
    createdAt,
  });
  validateLegalLocalSupabaseRuntimeManifest(manifest, { implementationCommit, taskId });
  return manifest;
}

export function validateLegalLocalSupabaseRuntimeManifest(manifest, { implementationCommit, taskId } = {}) {
  if (!manifest || manifest.schemaVersion !== LEGAL_LOCAL_SUPABASE_RUNTIME_MANIFEST_SCHEMA || manifest.runtimeProfile !== LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE) fail("R6_LOCAL_SUPABASE_RUNTIME_MANIFEST_INVALID");
  if (implementationCommit && manifest.implementationCommit !== implementationCommit) fail("R6_LOCAL_SUPABASE_RUNTIME_MANIFEST_INVALID");
  if (taskId && manifest.taskId !== taskId) fail("R6_LOCAL_SUPABASE_RUNTIME_MANIFEST_INVALID");
  if (!HASH.test(String(manifest.networkIdentityHash ?? "")) || !HASH.test(String(manifest.databaseIdentityHash ?? "")) || manifest.networkAuthentication !== "TASK_OWNED_ISOLATED_TRUST_HBA" || manifest.networkAuthenticationConfigSha256 !== createTaskOwnedSupabaseHbaConfiguration().sha256 || manifest.runtimeComponentSetSha256 !== runtimeComponentSetSha256() || manifest.runtimeCapabilityContractSha256 !== runtimeCapabilityContractSha256()) fail("R6_LOCAL_SUPABASE_RUNTIME_MANIFEST_INVALID");
  validatePinnedSupabaseRuntimeComponents(manifest.components);
  return Object.freeze({ classification: "R6_LOCAL_SUPABASE_RUNTIME_MANIFEST_READY" });
}

export function createRuntimeCapabilityTerminal({ taskId, implementationCommit, runtimeManifestSha256, capabilityStates, checkedAt = new Date().toISOString() }) {
  if (!HASH.test(String(runtimeManifestSha256 ?? "")) || !Array.isArray(capabilityStates)) fail("R6_LOCAL_SUPABASE_RUNTIME_CAPABILITY_INVALID");
  const states = capabilityStates.map((entry) => Object.freeze({ name: entry.name, present: entry.present === true, required: entry.required === true }));
  const known = new Set([...LEGAL_LOCAL_SUPABASE_REQUIRED_CAPABILITIES, ...LEGAL_LOCAL_SUPABASE_OPTIONAL_CAPABILITIES]);
  if (states.length !== known.size || states.some((entry) => !known.has(entry.name))) fail("R6_LOCAL_SUPABASE_RUNTIME_CAPABILITY_INVALID");
  const missing = states.filter((entry) => entry.required && !entry.present).map((entry) => entry.name);
  return Object.freeze({
    schemaVersion: LEGAL_LOCAL_SUPABASE_RUNTIME_CAPABILITY_SCHEMA,
    taskId,
    implementationCommit,
    runtimeManifestSha256,
    runtimeProfile: LEGAL_LOCAL_SUPABASE_RUNTIME_PROFILE,
    classification: missing.length === 0 ? "R6_LOCAL_SUPABASE_RUNTIME_CAPABILITY_READY" : "R6_LOCAL_SUPABASE_RUNTIME_CAPABILITY_INCOMPLETE",
    capabilities: states,
    missingCapabilities: missing,
    checkedAt,
  });
}

export function runtimeSecret() {
  return randomBytes(32).toString("hex");
}
