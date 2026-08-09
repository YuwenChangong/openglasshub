import assert from "node:assert/strict";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const TRANSPORT_CONTRACT_VERSION = "r6-production-reconciliation-transport-v1";
export const AUTHORIZATION_VERSION = "qa-production-reconciliation-execution-authorization-v2";
export const FINAL_CONFIRMATION_VERSION = "qa-production-reconciliation-final-human-confirmation-v1";
export const PACKAGE_VERSION = "r6-production-reconciliation-execution-package-v3";
export const CANONICAL_MIGRATION_SHA256 = "f63ecb18b0b2c183c8e13f3db6526956afd2af508f02d7c89f02a912cae91cd0";
export const CANONICAL_MIGRATION_BYTES = 22730;
export const POSTFLIGHT_SHA256 = "9940c17a5da9f8fb4bb444406f3252eeac623f35a649f715163665cd696fb1f5";
export const MIGRATION_ARTIFACT = "canonical-migration.sql";
export const POSTFLIGHT_ARTIFACT = "canonical-postflight.sql";
export const TARGET_PROBE_ARTIFACT = "canonical-target-probe.sql";

const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9-]{36}$/;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const sha256Bytes = sha256;

export function fail(code) { throw Object.assign(new Error(code), { code }); }
export function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function assertNoSecretString(value, code) {
  if (typeof value !== "string" || /(?:postgres(?:ql)?:\/\/[^\s]*:|password\s*=|service_role|eyJ[a-zA-Z0-9_-]{10,})/i.test(value)) fail(code);
}

function assertExactKeys(value, allowed, code) {
  if (Object.keys(value).length !== allowed.length || Object.keys(value).some((key) => !allowed.includes(key))) fail(code);
}

const CANDIDATE_KEYS = Object.freeze([
  "schemaVersion", "authorizationId", "executionTaskId", "authorizationState", "executionEligible", "immutable",
  "packageManifestSha256", "executionPackageSha256", "transportImplementationCommit", "transportLauncherSha256",
  "transportSha256", "targetIdentitySha256", "canonicalMigrationSha256", "canonicalPostflightSha256",
  "targetProbeSha256", "requiredConfirmationSha256", "transportContractVersion", "sqlClientCapability",
  "sqlClientVersion", "sqlClientExecutablePath", "sqlClientExecutableSha256", "attempts", "automaticRetry",
  "automaticRollback",
]);

const FINAL_CONFIRMATION_KEYS = Object.freeze([
  "schemaVersion", "authorizationCandidateSha256", "authorizationCandidateId", "implementationCommit",
  "packageManifestSha256", "executionPackageSha256", "transportContractVersion", "transportImplementationCommit",
  "transportLauncherSha256", "canonicalMigrationSha256", "canonicalPostflightSha256", "targetProbeSha256",
  "approvedTargetIdentitySha256", "requiredConfirmationSha256", "confirmedPhraseSha256", "singleUse", "attempts",
  "retry", "automaticRollback", "confirmedAt", "immutable",
]);

export function validateAuthorizationV2(value, { implementationCommit, launcherSha256, transportSha256, sqlClientCapability = null } = {}) {
  if (!value || value.schemaVersion !== AUTHORIZATION_VERSION || !UUID.test(String(value.authorizationId ?? "")) || !UUID.test(String(value.executionTaskId ?? ""))) {
    fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_TRANSPORT_VERSION_MISMATCH");
  }
  assertExactKeys(value, CANDIDATE_KEYS, "R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_INVALID");
  if (value.executionEligible !== false) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ILLEGAL_EXECUTABLE_CANDIDATE");
  if (value.authorizationState !== "AWAITING_FINAL_HUMAN_CONFIRMATION" || value.immutable !== true) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_INVALID");
  const hashFields = ["packageManifestSha256", "executionPackageSha256", "transportLauncherSha256", "transportSha256", "targetIdentitySha256", "canonicalMigrationSha256", "canonicalPostflightSha256", "targetProbeSha256", "requiredConfirmationSha256", "sqlClientExecutableSha256"];
  if (hashFields.some((key) => !HASH.test(String(value[key] ?? ""))) || !COMMIT.test(value.transportImplementationCommit) || typeof value.sqlClientVersion !== "string" || !path.isAbsolute(String(value.sqlClientExecutablePath ?? "")) || value.canonicalMigrationSha256 !== CANONICAL_MIGRATION_SHA256 || value.canonicalPostflightSha256 !== POSTFLIGHT_SHA256 || value.transportContractVersion !== TRANSPORT_CONTRACT_VERSION || value.sqlClientCapability !== "PSQL_NATIVE" || value.attempts !== 1 || value.automaticRetry !== 0 || value.automaticRollback !== 0) {
    fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_INVALID");
  }
  if (implementationCommit && value.transportImplementationCommit !== implementationCommit) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_COMMIT_MISMATCH");
  if (launcherSha256 && value.transportLauncherSha256 !== launcherSha256) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_LAUNCHER_MISMATCH");
  if (transportSha256 && value.transportSha256 !== transportSha256) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_TRANSPORT_MISMATCH");
  if (sqlClientCapability && (value.sqlClientVersion !== sqlClientCapability.version || value.sqlClientExecutableSha256 !== sqlClientCapability.executableSha256 || value.sqlClientExecutablePath !== sqlClientCapability.executablePath)) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_SQL_CLIENT_MISMATCH");
  return Object.freeze({ ...value });
}

export function validateFinalHumanConfirmation(value, { candidate, candidateSha256, implementationCommit, launcherSha256 } = {}) {
  if (!value || value.schemaVersion !== FINAL_CONFIRMATION_VERSION) fail("R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_INVALID");
  assertExactKeys(value, FINAL_CONFIRMATION_KEYS, "R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_INVALID");
  const hashFields = ["authorizationCandidateSha256", "packageManifestSha256", "executionPackageSha256", "transportLauncherSha256", "canonicalMigrationSha256", "canonicalPostflightSha256", "targetProbeSha256", "approvedTargetIdentitySha256", "requiredConfirmationSha256", "confirmedPhraseSha256"];
  if (hashFields.some((key) => !HASH.test(String(value[key] ?? ""))) || !UUID.test(String(value.authorizationCandidateId ?? "")) || !COMMIT.test(String(value.implementationCommit ?? "")) || !COMMIT.test(String(value.transportImplementationCommit ?? "")) || value.transportContractVersion !== TRANSPORT_CONTRACT_VERSION || value.singleUse !== true || value.immutable !== true || value.attempts !== 1 || value.retry !== 0 || value.automaticRollback !== 0 || Number.isNaN(Date.parse(String(value.confirmedAt ?? "")))) {
    fail("R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_INVALID");
  }
  for (const [key, expected] of Object.entries({
    authorizationCandidateSha256: candidateSha256,
    authorizationCandidateId: candidate?.authorizationId,
    implementationCommit,
    packageManifestSha256: candidate?.packageManifestSha256,
    executionPackageSha256: candidate?.executionPackageSha256,
    transportContractVersion: candidate?.transportContractVersion,
    transportImplementationCommit: candidate?.transportImplementationCommit,
    transportLauncherSha256: candidate?.transportLauncherSha256,
    canonicalMigrationSha256: candidate?.canonicalMigrationSha256,
    canonicalPostflightSha256: candidate?.canonicalPostflightSha256,
    targetProbeSha256: candidate?.targetProbeSha256,
    approvedTargetIdentitySha256: candidate?.targetIdentitySha256,
    requiredConfirmationSha256: candidate?.requiredConfirmationSha256,
    confirmedPhraseSha256: candidate?.requiredConfirmationSha256,
  })) {
    if (expected !== undefined && value[key] !== expected) fail("R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_BINDING_FAILED");
  }
  if (launcherSha256 && value.transportLauncherSha256 !== launcherSha256) fail("R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_BINDING_FAILED");
  return Object.freeze({ ...value });
}

export function assertPostflightReadOnly(bytes) {
  const text = bytes.toString("utf8");
  if (!/^\s*(?:--[^\r\n]*(?:\r?\n|$)\s*)*BEGIN\s+TRANSACTION\s+READ\s+ONLY\s*;/i.test(text) || !/ROLLBACK\s*;\s*$/i.test(text)) fail("R6_PRODUCTION_RECONCILIATION_POSTFLIGHT_NOT_READ_ONLY");
  const withoutComments = text.replace(/--[^\r\n]*/g, "");
  const forbidden = /\b(?:INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE)\b/i;
  if (forbidden.test(withoutComments)) fail("R6_PRODUCTION_RECONCILIATION_POSTFLIGHT_NOT_READ_ONLY");
  return Object.freeze({ firstStatement: "BEGIN TRANSACTION READ ONLY", terminalStatement: "ROLLBACK" });
}

async function readBoundArtifact(packageRoot, name, expectedSha256, expectedBytes = null) {
  const packagePath = path.resolve(packageRoot);
  const candidate = path.resolve(packagePath, name);
  if (!candidate.startsWith(`${packagePath}${path.sep}`)) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_PATH_INVALID");
  const bytes = await readFile(candidate).catch(() => fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_ARTIFACT_MISSING"));
  if (sha256(bytes) !== expectedSha256 || (expectedBytes !== null && bytes.length !== expectedBytes)) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_BINDING_INVALID");
  return Object.freeze({ path: candidate, bytes: Buffer.from(bytes), sha256: sha256(bytes), byteCount: bytes.length });
}

export async function loadBoundExecutionPackage({ packageRoot, expectedPackageSha256 = null, expectedExecutionPackageSha256 = expectedPackageSha256, expectedPackageManifestSha256 = null }) {
  const manifestPath = path.resolve(packageRoot, "production-reconciliation-execution-package.json");
  const manifestBytes = await readFile(manifestPath).catch(() => fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_MANIFEST_MISSING"));
  if (expectedExecutionPackageSha256 && sha256(manifestBytes) !== expectedExecutionPackageSha256) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_MANIFEST_MISMATCH");
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString("utf8")); } catch { fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_MANIFEST_INVALID"); }
  if (!manifest || manifest.schemaVersion !== PACKAGE_VERSION || manifest.transportContractVersion !== TRANSPORT_CONTRACT_VERSION || manifest.migration?.artifact !== MIGRATION_ARTIFACT || manifest.migration?.sha256 !== CANONICAL_MIGRATION_SHA256 || manifest.migration?.bytes !== CANONICAL_MIGRATION_BYTES || manifest.postflight?.artifact !== POSTFLIGHT_ARTIFACT || manifest.postflight?.sha256 !== POSTFLIGHT_SHA256 || manifest.targetProbe?.artifact !== TARGET_PROBE_ARTIFACT || !HASH.test(String(manifest.targetProbe?.sha256 ?? ""))) {
    fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_MANIFEST_INVALID");
  }
  const [migration, postflight, targetProbe] = await Promise.all([
    readBoundArtifact(packageRoot, MIGRATION_ARTIFACT, CANONICAL_MIGRATION_SHA256, CANONICAL_MIGRATION_BYTES),
    readBoundArtifact(packageRoot, POSTFLIGHT_ARTIFACT, POSTFLIGHT_SHA256),
    readBoundArtifact(packageRoot, TARGET_PROBE_ARTIFACT, manifest.targetProbe.sha256),
  ]);
  assertPostflightReadOnly(postflight.bytes);
  assertNoSecretString(targetProbe.bytes.toString("utf8"), "R6_PRODUCTION_RECONCILIATION_PACKAGE_SECRET_BOUNDARY_FAILED");
  let packageManifestPath = null; let packageManifestSha256 = null;
  if (expectedPackageManifestSha256) {
    packageManifestPath = path.resolve(packageRoot, "production-reconciliation-package-manifest.json");
    const packageManifestBytes = await readFile(packageManifestPath).catch(() => fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_MANIFEST_MISSING"));
    packageManifestSha256 = sha256(packageManifestBytes);
    if (packageManifestSha256 !== expectedPackageManifestSha256) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_MANIFEST_MISMATCH");
  }
  return Object.freeze({ manifest, manifestPath, manifestSha256: sha256(manifestBytes), packageManifestPath, packageManifestSha256, migration, postflight, targetProbe });
}

export function validatePsqlCapability({ executablePath, version, help, executableSha256 }) {
  if (typeof executablePath !== "string" || !path.isAbsolute(executablePath) || !/^psql \(PostgreSQL\) \d+/i.test(String(version ?? "")) || !/ON_ERROR_STOP/.test(String(help ?? "")) || !/--no-psqlrc/.test(String(help ?? ""))) {
    fail("R6_PRODUCTION_RECONCILIATION_SQL_CLIENT_CAPABILITY_UNAVAILABLE");
  }
  if (!HASH.test(String(executableSha256 ?? ""))) fail("R6_PRODUCTION_RECONCILIATION_SQL_CLIENT_CAPABILITY_UNAVAILABLE");
  return Object.freeze({ type: "PSQL_NATIVE", executablePath, executableSha256, version, errorPropagation: "-v ON_ERROR_STOP=1", startupIsolation: "-X", transactionBehavior: "TRANSPORT_WRAPPED_TRANSACTION" });
}
