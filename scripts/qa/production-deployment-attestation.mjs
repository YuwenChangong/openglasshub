import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const ATTESTATION_SCHEMA_VERSION = "r6-production-deployment-attestation-v1";
export const ATTESTATION_PROVIDER = "cloudflare-pages";
export const ATTESTATION_PROJECT = "openglasshub";
export const ATTESTATION_ENVIRONMENT = "production";
export const CANONICAL_PRODUCTION_URL = "https://openglasshub.pages.dev";
export const DEPLOYMENT_ATTESTATION_ROOT = "C:\\Users\\1\\OpenGlassHub-R6-Proof\\deployment-attestations";
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const DEPLOYMENT_HOST = /^[a-z0-9-]+\.openglasshub\.pages\.dev$/;
const MAX_ATTESTATION_WINDOW_MS = 15 * 60 * 1000;
const PROJECT_EVIDENCE_TYPE = "CLOUDFLARE_PAGES_PROJECT_GET_V1";
const PROJECT_R2_EVIDENCE_TYPE = "CLOUDFLARE_PAGES_PROJECT_GET_V2";
const DEPLOYMENT_EVIDENCE_TYPE = "CLOUDFLARE_PAGES_DEPLOYMENT_GET_V1";
const PROJECT_R2_SOURCE_CONTRACT_HASHES = Object.freeze([
  "7d3a3650c5c6c47296164335aa41f4020ca5d34e148f9045fe62ef86d6ba81a0",
  "10d35dd1fa3d42e48a0abf9b585d93673941f5336fa18f66bec09d2d222c0793",
  "2ab54ab5f18040ec80caeaa2dea7cd202f3f696ac4b589fc4874282a74590d63",
  "d663755d742e7f75c22a6aa77ddda4fb9401ae23815b7d50a23d0f80be4b771d",
  "89beea55ff2cee9ffeac79703ee56558761dbbbe34dc68d52a2a7e563519b27e",
]);
const PROJECT_R2_COMMON_KEYS = Object.freeze([
  "schemaVersion", "evidenceType", "provider", "classification", "projectName", "projectId", "projectSubdomain", "productionBranch",
  "deploymentId", "canonicalDeploymentProjectId", "canonicalDeploymentProjectName", "environment", "canonicalBaseUrl", "immutableDeploymentUrl", "immutableDeploymentUrlNormalizationVersion",
  "aliasesObservedType", "canonicalTargetProofMode", "triggerBranch", "sourceCommit", "isSkipped", "latestStageName", "latestStageStatus",
  "queryOrProviderEvidenceSha256", "sanitizedMetadataSha256", "projectSourceContractSha256s", "targetIdentityHash", "toolingCommit", "wrapperSha256",
  "wrapperVersion", "transportSha256", "parserSelectorSha256", "endpointSha256", "accountIdSha256", "observedAt", "expiresAt",
]);

export const PRODUCTION_TARGET_IDENTITY_HASH = createHash("sha256")
  .update(`${ATTESTATION_PROVIDER}|${ATTESTATION_PROJECT}|${ATTESTATION_ENVIRONMENT}|${CANONICAL_PRODUCTION_URL}`)
  .digest("hex");

function requireExactSha(value, errorCode) {
  const text = String(value ?? "");
  if (!SHA256.test(text)) throw new Error(errorCode);
  return text;
}

function requireExactCommit(value, errorCode) {
  const text = String(value ?? "");
  if (!COMMIT.test(text)) throw new Error(errorCode);
  return text;
}

function requireUtcTimestamp(value, errorCode) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)) throw new Error(errorCode);
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds)) throw new Error(errorCode);
  return milliseconds;
}

function containsSecretLikeValue(raw) {
  return /(?:service[_-]?role|access[_-]?token|refresh[_-]?token|authorization|password|postgres(?:ql)?:\/\/|eyJ[A-Za-z0-9_-]{12,})/i.test(raw);
}

function requireExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
}

function validateAttestationShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  if (value.schemaVersion !== ATTESTATION_SCHEMA_VERSION) throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  if (value.provider !== ATTESTATION_PROVIDER || value.projectName !== ATTESTATION_PROJECT || value.environment !== ATTESTATION_ENVIRONMENT) {
    throw new Error("QA_CANARY_DEPLOYMENT_TARGET_MISMATCH");
  }
  if (value.canonicalBaseUrl !== CANONICAL_PRODUCTION_URL) throw new Error("QA_CANARY_DEPLOYMENT_TARGET_MISMATCH");
  let immutable;
  try { immutable = new URL(String(value.immutableDeploymentUrl ?? "")); } catch { throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID"); }
  if (immutable.protocol !== "https:" || immutable.username || immutable.password || immutable.port || !DEPLOYMENT_HOST.test(immutable.hostname) || immutable.pathname !== "/" || immutable.search || immutable.hash) {
    throw new Error("QA_CANARY_DEPLOYMENT_TARGET_MISMATCH");
  }
  if (!/^[a-z0-9-]{8,}$/i.test(String(value.deploymentId ?? ""))) throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  requireExactCommit(value.sourceCommit, "QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  requireExactSha(value.queryOrProviderEvidenceSha256, "QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  if (value.targetIdentityHash !== PRODUCTION_TARGET_IDENTITY_HASH) throw new Error("QA_CANARY_DEPLOYMENT_TARGET_MISMATCH");
  if (value.classification !== "PRODUCTION_DEPLOYMENT_IDENTITY_EXACT") throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  // Legacy deployment attestations predate the explicit evidence discriminator.
  // Project evidence is deliberately stricter because it becomes a shared
  // ValidateOnly input without changing the legacy deployment contract.
  if (value.evidenceType !== undefined && value.evidenceType !== DEPLOYMENT_EVIDENCE_TYPE && value.evidenceType !== PROJECT_EVIDENCE_TYPE && value.evidenceType !== PROJECT_R2_EVIDENCE_TYPE) {
    throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  }
  if (value.evidenceType === PROJECT_EVIDENCE_TYPE) {
    for (const key of ["toolingCommit", "wrapperSha256", "transportSha256", "parserSelectorSha256", "endpointSha256", "accountIdSha256", "projectSourceContractSha256", "sanitizedMetadataSha256"]) {
      if (key === "toolingCommit") requireExactCommit(value[key], "QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
      else requireExactSha(value[key], "QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
    }
    if (value.productionBranch !== "main" || value.triggerBranch !== "main" || value.isSkipped !== false || value.latestStageName !== "deploy" || value.latestStageStatus !== "success") {
      throw new Error("QA_CANARY_DEPLOYMENT_TARGET_MISMATCH");
    }
  }
  if (value.evidenceType === PROJECT_R2_EVIDENCE_TYPE) {
    const expectedKeys = value.aliasesObservedType === "array" ? [...PROJECT_R2_COMMON_KEYS, "canonicalAlias"] : PROJECT_R2_COMMON_KEYS;
    requireExactKeys(value, expectedKeys);
    for (const key of ["toolingCommit", "wrapperSha256", "transportSha256", "parserSelectorSha256", "endpointSha256", "accountIdSha256", "sanitizedMetadataSha256"]) {
      if (key === "toolingCommit") requireExactCommit(value[key], "QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
      else requireExactSha(value[key], "QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
    }
    if (value.wrapperVersion !== "r6-consumed-run-wrapper-v1") throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
    if (value.immutableDeploymentUrlNormalizationVersion !== "canonical-deployment-url-v1") throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
    if (value.productionBranch !== "main" || value.triggerBranch !== "main" || value.isSkipped !== false || value.latestStageName !== "deploy" || value.latestStageStatus !== "success" || value.projectName !== ATTESTATION_PROJECT || value.canonicalDeploymentProjectName !== ATTESTATION_PROJECT || value.canonicalDeploymentProjectId !== value.projectId) {
      throw new Error("QA_CANARY_DEPLOYMENT_TARGET_MISMATCH");
    }
    if (value.aliasesObservedType !== "array" && value.aliasesObservedType !== "null") throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
    if (value.aliasesObservedType === "array" && (value.canonicalTargetProofMode !== "CANONICAL_DEPLOYMENT_ALIASES_V1" || value.canonicalAlias !== CANONICAL_PRODUCTION_URL || (value.projectSubdomain !== null && value.projectSubdomain !== "openglasshub.pages.dev"))) throw new Error("QA_CANARY_DEPLOYMENT_TARGET_MISMATCH");
    if (value.aliasesObservedType === "null" && (value.canonicalTargetProofMode !== "PROJECT_SUBDOMAIN_PRODUCTION_BINDING_V1" || value.canonicalAlias !== undefined || value.projectSubdomain !== "openglasshub.pages.dev")) throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
    if (!Array.isArray(value.projectSourceContractSha256s) || value.projectSourceContractSha256s.length !== PROJECT_R2_SOURCE_CONTRACT_HASHES.length || value.projectSourceContractSha256s.some((entry, index) => !SHA256.test(String(entry)) || entry !== PROJECT_R2_SOURCE_CONTRACT_HASHES[index])) throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  }
  return value;
}

async function assertAttestationPath(attestationPath, root = DEPLOYMENT_ATTESTATION_ROOT) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(String(attestationPath ?? ""));
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (!attestationPath || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  let entry;
  try { entry = await lstat(resolvedPath); } catch (error) { if (error?.code === "ENOENT") throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_MISSING"); throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID"); }
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  const [realRoot, realFile] = await Promise.all([realpath(resolvedRoot), realpath(resolvedPath)]).catch(() => { throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID"); });
  const realRelative = path.relative(realRoot, realFile);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  const finalStat = await stat(realFile);
  if (!finalStat.isFile()) throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  return realFile;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function validateDeploymentAttestation({ attestationPath, expectedSha256, expectedCommit, expectedToolingCommit = null, now = Date.now(), root = DEPLOYMENT_ATTESTATION_ROOT }) {
  const expectedHash = requireExactSha(expectedSha256, "QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  const expectedSourceCommit = requireExactCommit(expectedCommit, "QA_CANARY_DEPLOYED_COMMIT_MISMATCH");
  const actualPath = await assertAttestationPath(attestationPath, root);
  const raw = await readFile(actualPath);
  if (sha256(raw) !== expectedHash) throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  const text = raw.toString("utf8");
  if (containsSecretLikeValue(text)) throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  let attestation;
  try { attestation = JSON.parse(text); } catch { throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID"); }
  validateAttestationShape(attestation);
  if (attestation.sourceCommit !== expectedSourceCommit) throw new Error("QA_CANARY_DEPLOYED_COMMIT_MISMATCH");
  if (attestation.evidenceType === PROJECT_EVIDENCE_TYPE || attestation.evidenceType === PROJECT_R2_EVIDENCE_TYPE) {
    if (expectedToolingCommit === null || attestation.toolingCommit !== requireExactCommit(expectedToolingCommit, "QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID")) {
      throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
    }
  }
  const observedAt = requireUtcTimestamp(attestation.observedAt, "QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  const expiresAt = requireUtcTimestamp(attestation.expiresAt, "QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID");
  if (expiresAt <= observedAt || expiresAt - observedAt > MAX_ATTESTATION_WINDOW_MS || observedAt > now) throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_STALE");
  if (now > expiresAt) throw new Error("QA_CANARY_DEPLOYMENT_ATTESTATION_STALE");
  return { path: actualPath, evidenceType: attestation.evidenceType ?? DEPLOYMENT_EVIDENCE_TYPE, sourceCommit: attestation.sourceCommit, toolingCommit: attestation.toolingCommit ?? null, deploymentId: attestation.deploymentId, immutableDeploymentUrl: attestation.immutableDeploymentUrl, observedAt: attestation.observedAt, expiresAt: attestation.expiresAt };
}

export function validateExpectedRunnerCommit(value) {
  return requireExactCommit(value, "QA_CANARY_RUNNER_COMMIT_MISMATCH");
}
