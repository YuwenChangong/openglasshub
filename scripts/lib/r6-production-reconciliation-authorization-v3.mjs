import { timingSafeEqual } from "node:crypto";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadProductionReconciliationV4Package } from "./r6-production-reconciliation-package-v4.mjs";

export const AUTHORIZATION_V3_VERSION = "qa-production-reconciliation-execution-authorization-v3";
export const FINAL_CONFIRMATION_V2_VERSION = "qa-production-reconciliation-final-human-confirmation-v2";
export const AUTHORIZATION_V4_VERSION = "qa-production-reconciliation-execution-authorization-v4";
export const FINAL_CONFIRMATION_V3_VERSION = "qa-production-reconciliation-final-human-confirmation-v3";
export const FINAL_CONFIRMATION_V4_VERSION = "r6-production-reconciliation-final-human-confirmation-v4";
export const LAUNCHER_BINDING_V2_VERSION = "r6-production-reconciliation-launcher-binding-v2";

const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9-]{36}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireHash = (value, code = "R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_V3_INVALID") => { if (!HASH.test(String(value ?? ""))) fail(code); };
const same = (left, right) => typeof left === "string" && typeof right === "string" && left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const sha256 = value => createHash("sha256").update(value).digest("hex");

const candidateKeys = [
  "schemaVersion", "authorizationId", "executionTaskId", "authorizationState", "executionEligible", "immutable",
  "packageSchemaVersion", "packageManifestSha256", "executionPackageSha256", "transportImplementationCommit",
  "transportLauncherSha256", "transportSha256", "targetIdentitySchemaVersion", "targetIdentityCanonicalSha256",
  "runtimeRoutingSchemaVersion", "runtimeRoutingArtifactSha256", "expectedProjectRef", "targetProbeSha256",
  "canonicalMigrationSha256", "canonicalPostflightSha256", "requiredConfirmationSha256", "attempts", "automaticRetry", "automaticRollback",
];
const finalKeys = [
  "schemaVersion", "authorizationCandidateSha256", "authorizationCandidateId", "implementationCommit", "packageSchemaVersion",
  "packageManifestSha256", "executionPackageSha256", "transportImplementationCommit", "transportLauncherSha256",
  "targetIdentitySchemaVersion", "targetIdentityCanonicalSha256", "runtimeRoutingSchemaVersion", "runtimeRoutingArtifactSha256",
  "expectedProjectRef", "targetProbeSha256", "canonicalMigrationSha256", "canonicalPostflightSha256",
  "requiredConfirmationSha256", "confirmedPhraseSha256", "singleUse", "attempts", "retry", "automaticRollback", "confirmedAt", "immutable",
];
const candidateV4Keys = [
  "schemaVersion", "authorizationId", "executionTaskId", "authorizationState", "executionEligible", "immutable",
  "packageId", "packageSchemaVersion", "packageManifestSha256", "executionPackageSha256", "transportImplementationCommit",
  "transportLauncherSha256", "transportSha256", "targetIdentitySchemaVersion", "targetIdentityCanonicalSha256",
  "runtimeRoutingSchemaVersion", "runtimeRoutingArtifactSha256", "expectedProjectRef", "targetProbeSha256",
  "canonicalMigrationSha256", "canonicalPostflightSha256", "requiredConfirmationSha256", "attempts", "automaticRetry", "automaticRollback",
];
const finalV3Keys = [
  "schemaVersion", "authorizationCandidateSha256", "authorizationCandidateId", "implementationCommit", "packageId", "packageSchemaVersion",
  "packageManifestSha256", "executionPackageSha256", "transportImplementationCommit", "transportLauncherSha256",
  "targetIdentitySchemaVersion", "targetIdentityCanonicalSha256", "runtimeRoutingSchemaVersion", "runtimeRoutingArtifactSha256",
  "expectedProjectRef", "targetProbeSha256", "canonicalMigrationSha256", "canonicalPostflightSha256",
  "requiredConfirmationSha256", "confirmedPhraseSha256", "consumptionClaimPath", "consumptionClaimSha256", "singleUseScope",
  "singleUse", "attempts", "retry", "automaticRollback", "confirmedAt", "immutable",
];
const finalV4Keys = [
  "schemaVersion", "sourceCommit", "packageId", "packageSchemaVersion", "executionPackageSha256", "manifestSha256",
  "candidateId", "candidateSha256", "targetIdentitySchemaVersion", "targetIdentityCanonicalSha256",
  "runtimeRoutingSchemaVersion", "runtimeRoutingArtifactSha256", "expectedProjectRef", "launcherBindingSchemaVersion",
  "confirmationPhraseSha256", "globalConsumptionClaimSchemaVersion", "globalConsumptionClaimPathOrKey", "globalConsumptionClaimSha256",
  "humanConfirmed", "confirmationPhraseConsumed", "issuedAtUtc", "singleUse", "immutable",
];
const launcherKeys = [
  "schemaVersion", "packageSchemaVersion", "targetIdentitySchemaVersion", "targetIdentityCanonicalSha256",
  "runtimeRoutingSchemaVersion", "runtimeRoutingArtifactSha256", "expectedProjectRef", "launcherSha256", "secureWrapperSha256",
];
const exactKeys = (value, keys, code) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) fail(code);
};
const common = (value, code = "R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_V3_INVALID") => {
  if (value.packageSchemaVersion !== "r6-production-reconciliation-execution-package-v4" || value.targetIdentitySchemaVersion !== "r6-production-target-identity-v2" || value.runtimeRoutingSchemaVersion !== "r6-production-runtime-routing-identity-v1" || !/^[a-z0-9]{20}$/.test(String(value.expectedProjectRef ?? ""))) fail(code);
  for (const key of ["packageManifestSha256", "executionPackageSha256", "transportLauncherSha256", "targetIdentityCanonicalSha256", "runtimeRoutingArtifactSha256", "targetProbeSha256", "canonicalMigrationSha256", "canonicalPostflightSha256", "requiredConfirmationSha256"]) requireHash(value[key], code);
};

export function validateAuthorizationV3(value) {
  exactKeys(value, candidateKeys, "R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_V3_INVALID");
  common(value);
  if (value.schemaVersion !== AUTHORIZATION_V3_VERSION || !UUID.test(String(value.authorizationId ?? "")) || !UUID.test(String(value.executionTaskId ?? "")) || value.authorizationState !== "AWAITING_FINAL_HUMAN_CONFIRMATION" || value.executionEligible !== false || value.immutable !== true || !COMMIT.test(String(value.transportImplementationCommit ?? "")) || !HASH.test(String(value.transportSha256 ?? "")) || value.attempts !== 1 || value.automaticRetry !== 0 || value.automaticRollback !== 0) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_V3_INVALID");
  return Object.freeze({ ...value });
}

export async function buildAuthorizationV3FromPackage({ packageRoot, repositoryRoot, transportImplementationCommit, transportLauncherSha256, transportSha256, requiredConfirmationPhrase, authorizationId = randomUUID(), executionTaskId = randomUUID() }) {
  const loaded = await loadProductionReconciliationV4Package({ packageRoot, repositoryRoot });
  const executionPackageSha256 = sha256(await readFile(path.join(packageRoot, "production-reconciliation-execution-package.json")));
  const packageManifestSha256 = sha256(await readFile(path.join(packageRoot, "production-reconciliation-package-manifest.json")));
  const candidate = {
    schemaVersion: AUTHORIZATION_V3_VERSION, authorizationId, executionTaskId,
    authorizationState: "AWAITING_FINAL_HUMAN_CONFIRMATION", executionEligible: false, immutable: true,
    packageSchemaVersion: loaded.executionPackage.schemaVersion, packageManifestSha256, executionPackageSha256,
    transportImplementationCommit, transportLauncherSha256, transportSha256,
    targetIdentitySchemaVersion: loaded.executionPackage.targetIdentitySchemaVersion,
    targetIdentityCanonicalSha256: loaded.executionPackage.targetIdentityCanonicalSha256,
    runtimeRoutingSchemaVersion: loaded.executionPackage.runtimeRoutingSchemaVersion,
    runtimeRoutingArtifactSha256: loaded.executionPackage.runtimeRoutingArtifactSha256,
    expectedProjectRef: loaded.executionPackage.expectedProjectRef,
    targetProbeSha256: loaded.executionPackage.targetProbeSha256,
    canonicalMigrationSha256: loaded.manifest.migration.sha256,
    canonicalPostflightSha256: loaded.manifest.postflight.sha256,
    requiredConfirmationSha256: sha256(requiredConfirmationPhrase),
    attempts: 1, automaticRetry: 0, automaticRollback: 0,
  };
  return validateAuthorizationV3(candidate);
}

export function validateFinalHumanConfirmationV2(value, { candidate, candidateSha256 } = {}) {
  exactKeys(value, finalKeys, "R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_V2_INVALID");
  common(value);
  if (value.schemaVersion !== FINAL_CONFIRMATION_V2_VERSION || !UUID.test(String(value.authorizationCandidateId ?? "")) || !COMMIT.test(String(value.implementationCommit ?? "")) || value.singleUse !== true || value.immutable !== true || value.attempts !== 1 || value.retry !== 0 || value.automaticRollback !== 0 || Number.isNaN(Date.parse(String(value.confirmedAt ?? ""))) || !HASH.test(String(value.authorizationCandidateSha256 ?? "")) || !HASH.test(String(value.confirmedPhraseSha256 ?? ""))) fail("R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_V2_INVALID");
  if (candidate) {
    validateAuthorizationV3(candidate);
    const bindings = ["authorizationId", "packageSchemaVersion", "packageManifestSha256", "executionPackageSha256", "transportImplementationCommit", "transportLauncherSha256", "targetIdentitySchemaVersion", "targetIdentityCanonicalSha256", "runtimeRoutingSchemaVersion", "runtimeRoutingArtifactSha256", "expectedProjectRef", "targetProbeSha256", "canonicalMigrationSha256", "canonicalPostflightSha256", "requiredConfirmationSha256"];
    if (!same(value.authorizationCandidateSha256, candidateSha256) || bindings.some(key => value[key === "authorizationId" ? "authorizationCandidateId" : key] !== candidate[key]) || !same(value.confirmedPhraseSha256, candidate.requiredConfirmationSha256)) fail("R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_V2_BINDING_FAILED");
  }
  return Object.freeze({ ...value });
}

export function validateAuthorizationV4(value) {
  exactKeys(value, candidateV4Keys, "R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_V4_INVALID");
  common(value, "R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_V4_INVALID");
  if (value.schemaVersion !== AUTHORIZATION_V4_VERSION || !UUID.test(String(value.authorizationId ?? "")) || !UUID.test(String(value.executionTaskId ?? "")) || !UUID.test(String(value.packageId ?? "")) || value.authorizationState !== "AWAITING_FINAL_HUMAN_CONFIRMATION" || value.executionEligible !== false || value.immutable !== true || !COMMIT.test(String(value.transportImplementationCommit ?? "")) || !HASH.test(String(value.transportSha256 ?? "")) || value.attempts !== 1 || value.automaticRetry !== 0 || value.automaticRollback !== 0) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_V4_INVALID");
  return Object.freeze({ ...value });
}

export async function buildAuthorizationV4FromPackage({ packageRoot, repositoryRoot, transportImplementationCommit, transportLauncherSha256, transportSha256, requiredConfirmationPhrase, authorizationId = randomUUID(), executionTaskId = randomUUID() }) {
  const loaded = await loadProductionReconciliationV4Package({ packageRoot, repositoryRoot });
  const executionPackageSha256 = sha256(await readFile(path.join(packageRoot, "production-reconciliation-execution-package.json")));
  const packageManifestSha256 = sha256(await readFile(path.join(packageRoot, "production-reconciliation-package-manifest.json")));
  return validateAuthorizationV4({
    schemaVersion: AUTHORIZATION_V4_VERSION, authorizationId, executionTaskId,
    authorizationState: "AWAITING_FINAL_HUMAN_CONFIRMATION", executionEligible: false, immutable: true,
    packageId: loaded.executionPackage.packageId, packageSchemaVersion: loaded.executionPackage.schemaVersion, packageManifestSha256, executionPackageSha256,
    transportImplementationCommit, transportLauncherSha256, transportSha256,
    targetIdentitySchemaVersion: loaded.executionPackage.targetIdentitySchemaVersion,
    targetIdentityCanonicalSha256: loaded.executionPackage.targetIdentityCanonicalSha256,
    runtimeRoutingSchemaVersion: loaded.executionPackage.runtimeRoutingSchemaVersion,
    runtimeRoutingArtifactSha256: loaded.executionPackage.runtimeRoutingArtifactSha256,
    expectedProjectRef: loaded.executionPackage.expectedProjectRef,
    targetProbeSha256: loaded.executionPackage.targetProbeSha256,
    canonicalMigrationSha256: loaded.manifest.migration.sha256,
    canonicalPostflightSha256: loaded.manifest.postflight.sha256,
    requiredConfirmationSha256: sha256(requiredConfirmationPhrase),
    attempts: 1, automaticRetry: 0, automaticRollback: 0,
  });
}

export function validateFinalHumanConfirmationV3(value, { candidate, candidateSha256 } = {}) {
  exactKeys(value, finalV3Keys, "R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_V3_INVALID");
  common(value, "R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_V3_INVALID");
  if (value.schemaVersion !== FINAL_CONFIRMATION_V3_VERSION || !UUID.test(String(value.authorizationCandidateId ?? "")) || !UUID.test(String(value.packageId ?? "")) || !COMMIT.test(String(value.implementationCommit ?? "")) || !path.isAbsolute(String(value.consumptionClaimPath ?? "")) || !HASH.test(String(value.consumptionClaimSha256 ?? "")) || value.singleUseScope !== "GLOBAL_CANDIDATE_PHRASE" || value.singleUse !== true || value.immutable !== true || value.attempts !== 1 || value.retry !== 0 || value.automaticRollback !== 0 || Number.isNaN(Date.parse(String(value.confirmedAt ?? ""))) || !HASH.test(String(value.authorizationCandidateSha256 ?? "")) || !HASH.test(String(value.confirmedPhraseSha256 ?? ""))) fail("R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_V3_INVALID");
  if (candidate) {
    validateAuthorizationV4(candidate);
    const bindings = ["packageId", "packageSchemaVersion", "packageManifestSha256", "executionPackageSha256", "transportImplementationCommit", "transportLauncherSha256", "targetIdentitySchemaVersion", "targetIdentityCanonicalSha256", "runtimeRoutingSchemaVersion", "runtimeRoutingArtifactSha256", "expectedProjectRef", "targetProbeSha256", "canonicalMigrationSha256", "canonicalPostflightSha256", "requiredConfirmationSha256"];
    if (!same(value.authorizationCandidateSha256, candidateSha256) || value.authorizationCandidateId !== candidate.authorizationId || bindings.some(key => value[key] !== candidate[key]) || !same(value.confirmedPhraseSha256, candidate.requiredConfirmationSha256)) fail("R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_V3_BINDING_FAILED");
  }
  return Object.freeze({ ...value });
}

export function validateFinalHumanConfirmationV4(value, { candidate, candidateSha256 } = {}) {
  exactKeys(value, finalV4Keys, "R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_V4_INVALID");
  if (value.schemaVersion !== FINAL_CONFIRMATION_V4_VERSION || value.sourceCommit !== candidate?.transportImplementationCommit || !UUID.test(String(value.packageId ?? "")) || value.packageSchemaVersion !== "r6-production-reconciliation-execution-package-v4" || !HASH.test(String(value.executionPackageSha256 ?? "")) || !HASH.test(String(value.manifestSha256 ?? "")) || !UUID.test(String(value.candidateId ?? "")) || !HASH.test(String(value.candidateSha256 ?? "")) || value.targetIdentitySchemaVersion !== "r6-production-target-identity-v2" || !HASH.test(String(value.targetIdentityCanonicalSha256 ?? "")) || value.runtimeRoutingSchemaVersion !== "r6-production-runtime-routing-identity-v1" || !HASH.test(String(value.runtimeRoutingArtifactSha256 ?? "")) || !/^[a-z0-9]{20}$/.test(String(value.expectedProjectRef ?? "")) || value.launcherBindingSchemaVersion !== LAUNCHER_BINDING_V2_VERSION || !HASH.test(String(value.confirmationPhraseSha256 ?? "")) || value.globalConsumptionClaimSchemaVersion !== "r6-production-reconciliation-human-confirmation-consumption-v1" || !path.isAbsolute(String(value.globalConsumptionClaimPathOrKey ?? "")) || !HASH.test(String(value.globalConsumptionClaimSha256 ?? "")) || value.humanConfirmed !== true || value.confirmationPhraseConsumed !== true || value.singleUse !== true || value.immutable !== true || Number.isNaN(Date.parse(String(value.issuedAtUtc ?? "")))) fail("R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_V4_INVALID");
  if (candidate) {
    validateAuthorizationV4(candidate);
    if (value.packageId !== candidate.packageId || value.candidateId !== candidate.authorizationId || !same(value.candidateSha256, candidateSha256) || value.executionPackageSha256 !== candidate.executionPackageSha256 || value.manifestSha256 !== candidate.packageManifestSha256 || value.targetIdentityCanonicalSha256 !== candidate.targetIdentityCanonicalSha256 || value.runtimeRoutingArtifactSha256 !== candidate.runtimeRoutingArtifactSha256 || value.expectedProjectRef !== candidate.expectedProjectRef || !same(value.confirmationPhraseSha256, candidate.requiredConfirmationSha256)) fail("R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_V4_BINDING_FAILED");
  }
  return Object.freeze({ ...value });
}

export function validateLauncherBindingV2(value) {
  exactKeys(value, launcherKeys, "R6_PRODUCTION_RECONCILIATION_LAUNCHER_BINDING_V2_INVALID");
  common({ ...value, packageManifestSha256: "a".repeat(64), executionPackageSha256: "a".repeat(64), transportLauncherSha256: value.launcherSha256, targetProbeSha256: "a".repeat(64), canonicalMigrationSha256: "a".repeat(64), canonicalPostflightSha256: "a".repeat(64), requiredConfirmationSha256: "a".repeat(64) });
  if (value.schemaVersion !== LAUNCHER_BINDING_V2_VERSION || !HASH.test(String(value.launcherSha256 ?? "")) || !HASH.test(String(value.secureWrapperSha256 ?? ""))) fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_BINDING_V2_INVALID");
  return Object.freeze({ ...value });
}
