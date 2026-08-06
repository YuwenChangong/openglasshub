export const LEGAL_NONPRODUCTION_TARGET_BINDING_SCHEMA = "legal-nonproduction-target-binding-v2";
export const LOCAL_NONPRODUCTION_TARGET_CLASS = "LOCAL_ISOLATED_NON_PRODUCTION";
export const REMOTE_NONPRODUCTION_TARGET_CLASS = "REMOTE_ISOLATED_NON_PRODUCTION";
export const LEGAL_PREDEPLOYMENT_PURPOSE = "LEGAL_PREDEPLOYMENT_MIGRATION_REPLAY";

const HASH = /^[a-f0-9]{64}$/;
const TASK_ID = /^r6-(?:final-contract|local-predeployment)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROVIDERS = new Set([LOCAL_NONPRODUCTION_TARGET_CLASS, REMOTE_NONPRODUCTION_TARGET_CLASS]);
const LOCAL_ADDRESS_CLASSES = new Set(["LOOPBACK", "TASK_OWNED_DOCKER_NETWORK"]);
const COMPARISON_SOURCES = new Set(["FORMAL_ARTIFACT", "LOCAL_ISOLATION_FALLBACK"]);
const COMMON_FIELDS = new Set(["schemaVersion", "providerClass", "environmentClassification", "environmentPurpose", "taskId", "implementationCommit", "targetIdentityHash", "hostIdentityHash", "databaseIdentityHash", "networkIdentityHash", "engine", "engineVersion", "createdAt", "expiresAt", "disposable", "persistentBusinessData", "productionCredentialsPresent", "productionNetworkAccessRequired", "productionIdentityComparison"]);
const LOCAL_FIELDS = new Set(["localAddressClass", "containerRuntime", "containerRuntimeVersion", "containerIdentityHash", "containerTaskOwned", "networkTaskOwned", "externalDatabaseConnectionAllowed"]);
const REMOTE_FIELDS = new Set(["localAddressClass", "containerRuntime", "containerRuntimeVersion", "containerIdentityHash", "remoteIsolationVerified"]);

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const requireString = (value, code) => {
  if (typeof value !== "string" || value.trim() === "") fail(code);
  return value;
};
const requireHash = (value, code) => {
  if (!HASH.test(String(value ?? ""))) fail(code);
  return value;
};
const requireBoolean = (value, expected, code) => {
  if (value !== expected) fail(code);
  return value;
};
const requireUtc = (value, code) => {
  const timestamp = Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp) || !String(value).endsWith("Z")) fail(code);
  return timestamp;
};

function validateProductionInequality(comparison, providerClass) {
  if (!isObject(comparison) || !COMPARISON_SOURCES.has(comparison.source)) fail("R6_NONPRODUCTION_TARGET_COMPARISON_SOURCE_INVALID");
  for (const field of ["targetIdentityDifferent", "hostIdentityDifferent", "databaseIdentityDifferent", "networkIdentityDifferent", "productionProjectReferenceAbsent", "productionConnectionStringAbsent", "productionCredentialsAbsent"]) {
    requireBoolean(comparison[field], true, `R6_NONPRODUCTION_TARGET_INEQUALITY_INVALID:${field}`);
  }
  if (providerClass === LOCAL_NONPRODUCTION_TARGET_CLASS && comparison.source === "LOCAL_ISOLATION_FALLBACK") return comparison;
  if (comparison.source !== "FORMAL_ARTIFACT") fail("R6_NONPRODUCTION_TARGET_FORMAL_COMPARISON_REQUIRED");
  return comparison;
}

export function validateLegalNonproductionTargetBinding(binding, { now = Date.now() } = {}) {
  if (!isObject(binding)) fail("R6_NONPRODUCTION_TARGET_BINDING_INVALID");
  if (binding.schemaVersion !== LEGAL_NONPRODUCTION_TARGET_BINDING_SCHEMA) fail("R6_NONPRODUCTION_TARGET_BINDING_SCHEMA_INVALID");
  if (!PROVIDERS.has(binding.providerClass)) fail("R6_NONPRODUCTION_TARGET_PROVIDER_CLASS_INVALID");
  const allowedFields = binding.providerClass === LOCAL_NONPRODUCTION_TARGET_CLASS ? new Set([...COMMON_FIELDS, ...LOCAL_FIELDS]) : new Set([...COMMON_FIELDS, ...REMOTE_FIELDS]);
  if (Object.keys(binding).some((field) => !allowedFields.has(field))) fail("R6_NONPRODUCTION_TARGET_BINDING_UNKNOWN_FIELD");
  if (binding.environmentClassification !== binding.providerClass) fail("R6_NONPRODUCTION_TARGET_CLASSIFICATION_INVALID");
  if (binding.environmentPurpose !== LEGAL_PREDEPLOYMENT_PURPOSE) fail("R6_NONPRODUCTION_TARGET_PURPOSE_INVALID");
  if (!TASK_ID.test(String(binding.taskId ?? ""))) fail("R6_NONPRODUCTION_TARGET_TASK_ID_INVALID");
  if (!/^[a-f0-9]{40}$/.test(String(binding.implementationCommit ?? ""))) fail("R6_NONPRODUCTION_TARGET_IMPLEMENTATION_COMMIT_INVALID");
  for (const field of ["targetIdentityHash", "hostIdentityHash", "databaseIdentityHash", "networkIdentityHash"]) requireHash(binding[field], `R6_NONPRODUCTION_TARGET_IDENTITY_HASH_INVALID:${field}`);
  requireString(binding.engine, "R6_NONPRODUCTION_TARGET_ENGINE_INVALID");
  requireString(binding.engineVersion, "R6_NONPRODUCTION_TARGET_ENGINE_VERSION_INVALID");
  const createdAt = requireUtc(binding.createdAt, "R6_NONPRODUCTION_TARGET_CREATED_AT_INVALID");
  const expiresAt = requireUtc(binding.expiresAt, "R6_NONPRODUCTION_TARGET_EXPIRES_AT_INVALID");
  if (expiresAt <= createdAt || expiresAt <= now) fail("R6_NONPRODUCTION_TARGET_EXPIRED");
  requireBoolean(binding.disposable, true, "R6_NONPRODUCTION_TARGET_NOT_DISPOSABLE");
  requireBoolean(binding.persistentBusinessData, false, "R6_NONPRODUCTION_TARGET_PERSISTENT_DATA_FORBIDDEN");
  requireBoolean(binding.productionCredentialsPresent, false, "R6_NONPRODUCTION_TARGET_PRODUCTION_CREDENTIALS_FORBIDDEN");
  requireBoolean(binding.productionNetworkAccessRequired, false, "R6_NONPRODUCTION_TARGET_PRODUCTION_NETWORK_FORBIDDEN");
  validateProductionInequality(binding.productionIdentityComparison, binding.providerClass);

  if (binding.providerClass === LOCAL_NONPRODUCTION_TARGET_CLASS) {
    if (!LOCAL_ADDRESS_CLASSES.has(binding.localAddressClass)) fail("R6_LOCAL_NONPRODUCTION_TARGET_ADDRESS_INVALID");
    if (binding.containerRuntime !== "docker") fail("R6_LOCAL_NONPRODUCTION_TARGET_RUNTIME_INVALID");
    requireString(binding.containerRuntimeVersion, "R6_LOCAL_NONPRODUCTION_TARGET_RUNTIME_VERSION_INVALID");
    requireHash(binding.containerIdentityHash, "R6_LOCAL_NONPRODUCTION_TARGET_CONTAINER_HASH_INVALID");
    requireBoolean(binding.containerTaskOwned, true, "R6_LOCAL_NONPRODUCTION_TARGET_CONTAINER_OWNERSHIP_INVALID");
    requireBoolean(binding.networkTaskOwned, true, "R6_LOCAL_NONPRODUCTION_TARGET_NETWORK_OWNERSHIP_INVALID");
    requireBoolean(binding.externalDatabaseConnectionAllowed, false, "R6_LOCAL_NONPRODUCTION_TARGET_EXTERNAL_CONNECTION_FORBIDDEN");
    return Object.freeze({ classification: "R6_LOCAL_ISOLATED_NONPRODUCTION_TARGET_BINDING_READY", providerClass: binding.providerClass, taskId: binding.taskId, expiresAt: binding.expiresAt });
  }

  if (binding.localAddressClass !== null || binding.containerRuntime !== null || binding.containerRuntimeVersion !== null || binding.containerIdentityHash !== null) fail("R6_REMOTE_NONPRODUCTION_TARGET_LOCAL_FIELD_INVALID");
  requireBoolean(binding.remoteIsolationVerified, true, "R6_REMOTE_NONPRODUCTION_TARGET_ISOLATION_INVALID");
  return Object.freeze({ classification: "R6_NONPRODUCTION_TARGET_BINDING_READY", providerClass: binding.providerClass, taskId: binding.taskId, expiresAt: binding.expiresAt });
}

export function evaluateLegalNonproductionTargetProvisioning(binding, options) {
  if (binding === null || binding === undefined) return Object.freeze({ classification: "R6_LOCAL_NONPRODUCTION_TARGET_CREATION_REQUIRED", targetReady: false });
  const validated = validateLegalNonproductionTargetBinding(binding, options);
  if (validated.providerClass === LOCAL_NONPRODUCTION_TARGET_CLASS) return Object.freeze({ classification: "R6_LOCAL_NONPRODUCTION_TARGET_PROVISIONING_READY", targetReady: true });
  return Object.freeze({ classification: "R6_NONPRODUCTION_TARGET_PROVISIONING_READY", targetReady: true });
}
