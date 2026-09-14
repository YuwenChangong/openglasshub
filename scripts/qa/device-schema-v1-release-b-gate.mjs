import { types as utilTypes } from "node:util";

const SHA256 = /^[a-f0-9]{64}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RELEASE_B_AUTHORIZATION_ID = /^release-b-approval-[0-9]{3,}(?![\s\S])/;
const SENSITIVE_KEY = /(?:password|secret|token|api[_-]?key|service[_-]?role|anon[_-]?key|dsn|credential|connection[_-]?string|pgpassword|private[_-]?key|access[_-]?key|client[_-]?secret)/i;
const SENSITIVE_VALUE = /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/|-----BEGIN [^-\r\n]*PRIVATE KEY-----|\b(?:sk|rk|pk|ghp|xox[baprs])[-_][a-z0-9_-]{16,}\b|\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/i;
const CREDENTIAL_HTTP_URL = /\bhttps?:\/\/[^\s\/@]+@/i;

export const RELEASE_B_PACKET = Object.freeze({
  sourceCommit: "4787375a84cb55b3fb3fc86bdab66ae6dc565fbc",
  projectRef: "xcbnxzjlsvtgzixurcof",
  fingerprints: Object.freeze({
    normalizedYaml: "a4da41f5011911ddbc9f602a7bd3322148a71314955303f67d08ef2d95bddc9b",
    sourceMetadata: "1a46f7676847d9064e53c5031af065f5d0e306bd2c3e002bcbdf3e8ecd3dc1f2",
    conflictMap: "056d89a95abce13b898913bed7ce2712bd738cd5dec5560a4143cfc48bba4a28",
    identityMap: "82801dc594469010c70dcf086396824f86ae22e55e35896015045a9af1b0a2b2",
    definitionRegistry: "be0ce61f4a15f2d39c3c16e14b9ad978ed358f64150ed4fd81235315601c691f",
    normalizedModel: "b9cf3dc49010200f5b5d3b2fa4e2edae1a4e9d89c02e47e7327680febbf27451",
    normalizedPayload: "c4b2bbaca63376402fcd4ca00af108a953a0b94d0975db2c579698e8a08aa333",
    recoveryPlan: "c1583080fdffa004861c70ab9c2987a19839b87b30846cbf9983994e6b64e5e7",
    importerCode: "ee78b01ecdeb63161978bf91791e05c9ea56cef1fbba4d8761d6fd332f7c32c9",
  }),
  expectedAfterCounts: Object.freeze({
    devices: 24,
    uniqueSlugs: 24,
    publishedDevices: 24,
    definitions: 92,
    specs: 1488,
    sources: 39,
    sourceLinks: 46,
    evidence: 15,
    auditEvents: 0,
  }),
});

const OPERATIONS = Object.freeze({ definition: 92, device: 24, source: 39, sourceLink: 46, spec: 1488, evidence: 15, compatibility: 24 });
const EMPTY_TARGET_ROWS = Object.freeze({ devices: 0, definitions: 0, specs: 0, sources: 0, sourceLinks: 0, evidence: 0, auditEvents: 0 });

function fail(message) {
  throw new TypeError(message);
}

function isPlainObject(value) {
  if (utilTypes.isProxy(value)) return false;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoSensitive(value, key = "", seen = new Set()) {
  if (typeof key !== "string") fail("INVALID_RELEASE_B_GATE_INPUT");
  if (SENSITIVE_KEY.test(key) || (typeof value === "string" && (SENSITIVE_VALUE.test(value) || CREDENTIAL_HTTP_URL.test(value)))) fail("SECRET_OR_DSN_REJECTED");
  if (typeof value === "function") fail("INVALID_RELEASE_B_GATE_INPUT");
  if (!value || typeof value !== "object") return;
  if (!isPlainObject(value) || seen.has(value)) fail("INVALID_RELEASE_B_GATE_INPUT");
  seen.add(value);
  for (const childKey of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, childKey);
    if (typeof childKey !== "string" || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail("INVALID_RELEASE_B_GATE_INPUT");
    assertNoSensitive(descriptor.value, childKey, seen);
  }
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
    && ownKeys.every((key) => {
      const descriptor = typeof key === "string" ? Object.getOwnPropertyDescriptor(value, key) : null;
      return typeof key === "string" && descriptor?.enumerable && Object.hasOwn(descriptor, "value");
    });
}

function exactObject(value, expected) {
  return hasExactKeys(value, Object.keys(expected)) && Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

function exactFingerprints(value) {
  return hasExactKeys(value, Object.keys(RELEASE_B_PACKET.fingerprints))
    && Object.entries(RELEASE_B_PACKET.fingerprints).every(([key, expected]) => typeof value[key] === "string" && SHA256.test(value[key]) && value[key].toLowerCase() === expected);
}

function validAuthorization(value) {
  return hasExactKeys(value, ["authorizationId", "authorizedAt"])
    && typeof value.authorizationId === "string" && value.authorizationId.length <= 128
    && RELEASE_B_AUTHORIZATION_ID.test(value.authorizationId)
    && typeof value.authorizedAt === "string" && ISO_TIMESTAMP.test(value.authorizedAt)
    && !Number.isNaN(Date.parse(value.authorizedAt)) && new Date(value.authorizedAt).toISOString() === value.authorizedAt;
}

function validReleaseA(value) {
  return hasExactKeys(value, ["status", "migrationHistory", "schemaPostconditions", "migrationSha256"])
    && value.status === "PASS" && value.migrationHistory === 1 && value.schemaPostconditions === "PASS"
    && value.migrationSha256 === "a117631dd7a1ffa848b1df8dfbc8286bc7f901a1375961b3d4fe9ad5b2a2d215";
}

function validCandidate(value) {
  return hasExactKeys(value, ["sourceCommit", "clean", "isolated", "committedOnly"])
    && value.sourceCommit === RELEASE_B_PACKET.sourceCommit && value.clean === true && value.isolated === true && value.committedOnly === true;
}

function validIdentity(value) {
  return hasExactKeys(value, ["yamlDeviceCount", "yamlBrandCount", "identityMapCount", "uniqueTargetSlugs", "unresolvedIdentities", "rayBanIdentityStatus", "rayBanCanonicalSlug"])
    && value.yamlDeviceCount === 24 && value.yamlBrandCount === 8 && value.identityMapCount === 24
    && value.uniqueTargetSlugs === 24 && value.unresolvedIdentities === 0
    && value.rayBanIdentityStatus === "OPERATOR_APPROVED_GEN2" && value.rayBanCanonicalSlug === "ray-ban-meta";
}

function identityMissingCode(value) {
  const keys = ["yamlDeviceCount", "yamlBrandCount", "identityMapCount", "uniqueTargetSlugs", "unresolvedIdentities", "rayBanIdentityStatus", "rayBanCanonicalSlug"];
  if (!hasExactKeys(value, keys)) return "EXACT_IDENTITY_COUNTS_REQUIRED";
  return value.rayBanIdentityStatus !== "OPERATOR_APPROVED_GEN2" || value.rayBanCanonicalSlug !== "ray-ban-meta"
    ? "RAY_BAN_IDENTITY_REQUIRED"
    : "EXACT_IDENTITY_COUNTS_REQUIRED";
}

function validMapping(value) {
  return hasExactKeys(value, ["unmappedSourceUrls", "ambiguousSourceUrls", "unresolvedEvidenceMaps", "trueValueConflictCount", "trueValueConflictsValid"])
    && value.unmappedSourceUrls === 0 && value.ambiguousSourceUrls === 0 && value.unresolvedEvidenceMaps === 0
    && value.trueValueConflictCount === 7 && value.trueValueConflictsValid === true;
}

function validPayload(value) {
  return hasExactKeys(value, ["normalizedDeviceCount", "normalizedSpecCount", "duplicateDeviceIdentities", "duplicateSpecIdentities", "duplicateSourceIdentities", "duplicateEvidenceIdentities", "rebuildSha256", "independentRebuildSha256"])
    && value.normalizedDeviceCount === 24 && value.normalizedSpecCount === 1488
    && value.duplicateDeviceIdentities === 0 && value.duplicateSpecIdentities === 0
    && value.duplicateSourceIdentities === 0 && value.duplicateEvidenceIdentities === 0
    && value.rebuildSha256 === RELEASE_B_PACKET.fingerprints.normalizedPayload
    && value.independentRebuildSha256 === RELEASE_B_PACKET.fingerprints.normalizedPayload;
}

function validOperations(value) {
  return exactObject(value, OPERATIONS);
}

function validDryRun(value) {
  return hasExactKeys(value, ["blocked", "delete", "conflicts", "operations"])
    && value.blocked === 0 && value.delete === "NONE" && value.conflicts === 0 && validOperations(value.operations);
}

function validLocalRehearsal(value) {
  return hasExactKeys(value, ["status", "constraints", "repaired", "idempotent", "secondDryRunBlocked", "secondDryRunDelete", "operations"])
    && value.status === "PASS" && value.constraints === "PASS" && value.repaired === false && value.idempotent === true
    && value.secondDryRunBlocked === 0 && value.secondDryRunDelete === "NONE" && validOperations(value.operations);
}

function validLocalSqlRehearsal(value) {
  return hasExactKeys(value, ["status", "target", "constraints", "repaired", "idempotent", "secondDryRunBlocked", "secondDryRunDelete", "operations"])
    && value.status === "PASS" && value.target === "LOCAL_DISPOSABLE_SQL" && value.constraints === "PASS"
    && value.repaired === false && value.idempotent === true
    && value.secondDryRunBlocked === 0 && value.secondDryRunDelete === "NONE" && validOperations(value.operations);
}

function validCompatibility(value) {
  return hasExactKeys(value, ["status", "productsRoute", "brandGrouping", "rayBanMetaRoute", "yamlDerivedSpecs"])
    && Object.values(value).every((item) => item === "PASS");
}

function validReleaseQa(value) {
  return hasExactKeys(value, ["status", "productionConnections", "providerWrites"])
    && value.status === "PASS" && value.productionConnections === 0 && value.providerWrites === 0;
}

function validProductionPrecheck(value) {
  return hasExactKeys(value, ["projectRef", "releaseAHistory", "targetTableCount", "targetEnumCount", "targetRlsEnabledCount", "deviceSchemaV1ColumnCount", "targetPolicyCount", "functions", "triggers", "targetRows"])
    && value.projectRef === RELEASE_B_PACKET.projectRef && value.releaseAHistory === 1
    && value.targetTableCount === 6 && value.targetEnumCount === 7 && value.targetRlsEnabledCount === 6
    && value.deviceSchemaV1ColumnCount === 7 && value.targetPolicyCount === 22
    && value.functions === "PASS" && value.triggers === "PASS" && exactObject(value.targetRows, EMPTY_TARGET_ROWS);
}

function validExecution(value) {
  return hasExactKeys(value, ["transaction", "attempts", "retry", "failureDisposition"])
    && value.transaction === "ONE" && value.attempts === 1 && value.retry === "FORBIDDEN" && value.failureDisposition === "STOP_UNKNOWN_STATE";
}

/** Evaluate a value-blind, supplied Release B packet; it performs no I/O or mutation. */
export function assertReleaseBProductionGate(input) {
  assertNoSensitive(input);
  const keys = ["releaseA", "candidate", "fingerprints", "identity", "mapping", "payload", "dryRun", "localRehearsal", "localSqlRehearsal", "compatibility", "releaseQa", "productionPrecheck", "expectedAfterCounts", "execution", "authorization"];
  if (!hasExactKeys(input, keys)) fail("INVALID_RELEASE_B_GATE_INPUT");
  const missing = [];
  if (!validReleaseA(input.releaseA)) missing.push("RELEASE_A_VERIFICATION_REQUIRED");
  if (!validCandidate(input.candidate)) missing.push("CLEAN_COMMITTED_CANDIDATE_REQUIRED");
  if (!exactFingerprints(input.fingerprints)) missing.push("LOCKED_SOURCE_FINGERPRINTS_REQUIRED");
  if (!validIdentity(input.identity)) missing.push(identityMissingCode(input.identity));
  if (!validMapping(input.mapping)) missing.push("COMPLETE_SOURCE_AND_CONFLICT_MAPPING_REQUIRED");
  if (!validPayload(input.payload)) missing.push("LOCKED_NORMALIZED_PAYLOAD_REQUIRED");
  if (!validDryRun(input.dryRun)) missing.push("NON_DESTRUCTIVE_DRY_RUN_REQUIRED");
  if (!validLocalRehearsal(input.localRehearsal)) missing.push("LOCAL_TRANSACTIONAL_REHEARSAL_REQUIRED");
  if (!validLocalSqlRehearsal(input.localSqlRehearsal)) missing.push("LOCAL_SQL_TRANSACTIONAL_REHEARSAL_REQUIRED");
  if (!validCompatibility(input.compatibility)) missing.push("LEGACY_READER_COMPATIBILITY_REQUIRED");
  if (!validReleaseQa(input.releaseQa)) missing.push("RELEASE_QA_PASS_REQUIRED");
  if (!validProductionPrecheck(input.productionPrecheck)) missing.push("EMPTY_PRODUCTION_TARGET_REQUIRED");
  if (!exactObject(input.expectedAfterCounts, RELEASE_B_PACKET.expectedAfterCounts)) missing.push("EXACT_PRODUCTION_AFTER_COUNTS_REQUIRED");
  if (!validExecution(input.execution)) missing.push("ONE_TRANSACTION_ONE_ATTEMPT_REQUIRED");
  if (!validAuthorization(input.authorization)) missing.push("RELEASE_B_PRODUCTION_AUTHORIZATION_REQUIRED");
  return Object.freeze({ allowed: missing.length === 0, missing: Object.freeze(missing) });
}
