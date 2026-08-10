import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveCanonicalGitBlob } from "./canonical-git-blob.mjs";
import {
  CANONICAL_PRODUCTION_PROJECT_REF, RUNTIME_ROUTING_IDENTITY_VERSION,
  TARGET_IDENTITY_V2_VERSION, TARGET_PROBE_V2_SQL,
  canonicalTargetIdentityV2, canonicalTargetIdentityV2Sha256,
  parseSupabaseProjectRefAuthority,
} from "./r6-production-target-identity-v2.mjs";
import {
  CANONICAL_FINGERPRINT_BASELINE_SHA256, CANONICAL_MIGRATION_BYTES,
  CANONICAL_MIGRATION_SHA256, POSTFLIGHT_SHA256,
} from "./r6-production-reconciliation-transport-contract.mjs";

export const PACKAGE_V4_VERSION = "r6-production-reconciliation-execution-package-v4";
export const PACKAGE_V4_MANIFEST_VERSION = "r6-production-reconciliation-package-manifest-v4";
export const TARGET_IDENTITY_ARTIFACT = "canonical-target-identity-v2.json";
export const RUNTIME_ROUTING_ARTIFACT = "canonical-runtime-routing-identity.json";
export const TARGET_PROBE_ARTIFACT_V2 = "canonical-target-probe-v2.sql";
export const EXECUTION_PACKAGE_ARTIFACT_V4 = "production-reconciliation-execution-package.json";
export const PACKAGE_MANIFEST_ARTIFACT_V4 = "production-reconciliation-package-manifest.json";

const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9-]{36}$/;
const migrationPath = "supabase/migrations/20260807073929_reconcile_production_schema_drift.sql";
const postflightPath = "docs/ops/legal-consent-production-schema-fingerprint.sql";
const hashBytes = value => createHash("sha256").update(value).digest("hex");
const hashJson = value => hashBytes(JSON.stringify(value));
const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireHash = value => {
  if (!HASH.test(String(value ?? ""))) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_V4_INVALID");
  return value;
};
const leaf = value => typeof value === "string" && value === path.basename(value) && value.length > 0 && !value.includes("..") && !value.includes("/") && !value.includes("\\");
const jsonBytes = value => Buffer.from(`${JSON.stringify(value)}\n`, "utf8");

export async function productionProjectRefFromRepository(repositoryRoot) {
  const text = await readFile(path.join(repositoryRoot, "wrangler.toml"), "utf8").catch(() => fail("R6_PRODUCTION_RECONCILIATION_APPROVED_ROUTING_AUTHORITY_MISMATCH"));
  const match = /^SUPABASE_URL\s*=\s*"([^"]+)"\s*$/m.exec(text);
  if (!match) fail("R6_PRODUCTION_RECONCILIATION_APPROVED_ROUTING_AUTHORITY_MISMATCH");
  return parseSupabaseProjectRefAuthority(match[1]);
}

export function buildPackageV4Identity({ projectRef }) {
  if (typeof projectRef !== "string" || projectRef !== CANONICAL_PRODUCTION_PROJECT_REF) fail("R6_PRODUCTION_RECONCILIATION_APPROVED_ROUTING_AUTHORITY_MISMATCH");
  const targetIdentity = { schemaVersion: TARGET_IDENTITY_V2_VERSION, provider: "supabase", projectRef };
  const routingIdentity = { schemaVersion: RUNTIME_ROUTING_IDENTITY_VERSION, provider: "supabase", projectRef, database: "postgres" };
  const targetCanonical = canonicalTargetIdentityV2(targetIdentity);
  const routingCanonical = JSON.stringify(routingIdentity);
  return Object.freeze({
    targetIdentity,
    targetIdentityCanonicalSha256: canonicalTargetIdentityV2Sha256(targetIdentity),
    routingIdentity,
    routingIdentityCanonicalSha256: hashBytes(routingCanonical),
    targetIdentityArtifact: jsonBytes(targetIdentity),
    routingIdentityArtifact: Buffer.from(`${routingCanonical}\n`, "utf8"),
    targetIdentitySchemaVersion: TARGET_IDENTITY_V2_VERSION,
    runtimeRoutingSchemaVersion: RUNTIME_ROUTING_IDENTITY_VERSION,
    targetCanonical,
    routingCanonical,
  });
}

export function validatePackageV4Identity(value) {
  const requiredPaths = ["targetIdentityArtifactPath", "runtimeRoutingArtifactPath", "targetProbePath"];
  const requiredHashes = ["targetIdentityArtifactSha256", "targetIdentityCanonicalSha256", "runtimeRoutingArtifactSha256", "runtimeRoutingCanonicalSha256", "targetProbeSha256", "manifestSha256"];
  if (!value || value.schemaVersion !== PACKAGE_V4_VERSION || !UUID.test(String(value.packageId ?? "")) || value.targetIdentitySchemaVersion !== TARGET_IDENTITY_V2_VERSION || value.runtimeRoutingSchemaVersion !== RUNTIME_ROUTING_IDENTITY_VERSION || value.expectedProjectRef !== CANONICAL_PRODUCTION_PROJECT_REF || requiredPaths.some(key => !leaf(value[key])) || requiredHashes.some(key => !HASH.test(String(value[key] ?? "")))) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_V4_INVALID");
  return value;
}

export async function issueProductionReconciliationV4Package({ packageRoot, repositoryRoot, implementationCommit, launcherSha256, secureWrapperSha256, baselineSha256, packageId = randomUUID() }) {
  if (!path.isAbsolute(String(packageRoot ?? "")) || !path.isAbsolute(String(repositoryRoot ?? "")) || !COMMIT.test(String(implementationCommit ?? "")) || !UUID.test(String(packageId ?? ""))) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_V4_INVALID");
  for (const value of [launcherSha256, secureWrapperSha256, baselineSha256]) requireHash(value);
  if (baselineSha256 !== CANONICAL_FINGERPRINT_BASELINE_SHA256) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_V4_INVALID");

  const expectedProjectRef = await productionProjectRefFromRepository(repositoryRoot);
  const identity = buildPackageV4Identity({ projectRef: expectedProjectRef });
  const [migration, postflight] = [
    resolveCanonicalGitBlob({ repositoryRoot, implementationCommit, repositoryRelativePath: migrationPath }),
    resolveCanonicalGitBlob({ repositoryRoot, implementationCommit, repositoryRelativePath: postflightPath }),
  ];
  const targetProbe = Buffer.from(TARGET_PROBE_V2_SQL, "utf8");
  if (migration.sha256 !== CANONICAL_MIGRATION_SHA256 || migration.byteCount !== CANONICAL_MIGRATION_BYTES || postflight.sha256 !== POSTFLIGHT_SHA256) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_V4_INVALID");
  await mkdir(packageRoot, { recursive: false });
  const artifacts = [
    ["canonical-forward-reconciliation.sql", migration.bytes],
    ["canonical-postflight-fingerprint.sql", postflight.bytes],
    [TARGET_PROBE_ARTIFACT_V2, targetProbe],
    [TARGET_IDENTITY_ARTIFACT, identity.targetIdentityArtifact],
    [RUNTIME_ROUTING_ARTIFACT, identity.routingIdentityArtifact],
  ];
  await Promise.all(artifacts.map(([name, bytes]) => writeFile(path.join(packageRoot, name), bytes, { flag: "wx" })));
  const artifactHashes = Object.fromEntries(await Promise.all(artifacts.map(async ([name]) => [name, hashBytes(await readFile(path.join(packageRoot, name)))])));
  const manifest = {
    schemaVersion: PACKAGE_V4_MANIFEST_VERSION, packageId,
    implementationCommit,
    expectedProjectRef,
    targetIdentity: { artifact: TARGET_IDENTITY_ARTIFACT, sha256: artifactHashes[TARGET_IDENTITY_ARTIFACT], canonicalSha256: identity.targetIdentityCanonicalSha256, schemaVersion: TARGET_IDENTITY_V2_VERSION },
    runtimeRouting: { artifact: RUNTIME_ROUTING_ARTIFACT, sha256: artifactHashes[RUNTIME_ROUTING_ARTIFACT], canonicalSha256: identity.routingIdentityCanonicalSha256, schemaVersion: RUNTIME_ROUTING_IDENTITY_VERSION },
    targetProbe: { artifact: TARGET_PROBE_ARTIFACT_V2, sha256: artifactHashes[TARGET_PROBE_ARTIFACT_V2] },
    migration: { artifact: "canonical-forward-reconciliation.sql", sha256: migration.sha256, bytes: migration.byteCount },
    postflight: { artifact: "canonical-postflight-fingerprint.sql", sha256: postflight.sha256 },
    baselineSha256, launcherSha256, secureWrapperSha256,
    executionEligible: false, candidateIssued: false, humanConfirmed: false, executionConsumed: false,
  };
  const manifestPath = path.join(packageRoot, PACKAGE_MANIFEST_ARTIFACT_V4);
  await writeFile(manifestPath, jsonBytes(manifest), { flag: "wx" });
  const manifestSha256 = hashBytes(await readFile(manifestPath));
  const executionPackage = {
    schemaVersion: PACKAGE_V4_VERSION, packageId, sourceCommit: implementationCommit,
    targetIdentitySchemaVersion: TARGET_IDENTITY_V2_VERSION, targetIdentityArtifactPath: TARGET_IDENTITY_ARTIFACT,
    targetIdentityArtifactSha256: artifactHashes[TARGET_IDENTITY_ARTIFACT], targetIdentityCanonicalSha256: identity.targetIdentityCanonicalSha256,
    runtimeRoutingSchemaVersion: RUNTIME_ROUTING_IDENTITY_VERSION, runtimeRoutingArtifactPath: RUNTIME_ROUTING_ARTIFACT,
    runtimeRoutingArtifactSha256: artifactHashes[RUNTIME_ROUTING_ARTIFACT], runtimeRoutingCanonicalSha256: identity.routingIdentityCanonicalSha256,
    expectedProjectRef, targetProbePath: TARGET_PROBE_ARTIFACT_V2, targetProbeSha256: artifactHashes[TARGET_PROBE_ARTIFACT_V2],
    manifestSha256,
  };
  validatePackageV4Identity(executionPackage);
  const executionPackagePath = path.join(packageRoot, EXECUTION_PACKAGE_ARTIFACT_V4);
  await writeFile(executionPackagePath, jsonBytes(executionPackage), { flag: "wx" });
  return Object.freeze({ packageId, packageRoot, executionPackagePath, executionPackageSha256: hashBytes(await readFile(executionPackagePath)), manifestPath, manifestSha256, expectedProjectRef });
}

export async function loadProductionReconciliationV4Package({ packageRoot, repositoryRoot }) {
  const packagePath = path.join(packageRoot, EXECUTION_PACKAGE_ARTIFACT_V4);
  const executionPackage = JSON.parse(await readFile(packagePath, "utf8").catch(() => fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_V4_INVALID")));
  validatePackageV4Identity(executionPackage);
  if (executionPackage.expectedProjectRef !== await productionProjectRefFromRepository(repositoryRoot)) fail("R6_PRODUCTION_RECONCILIATION_APPROVED_ROUTING_AUTHORITY_MISMATCH");
  const readArtifact = async (name, expectedHash) => {
    const bytes = await readFile(path.join(packageRoot, name)).catch(() => fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_V4_INVALID"));
    if (hashBytes(bytes) !== expectedHash) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_V4_INVALID");
    return bytes;
  };
  const targetBytes = await readArtifact(executionPackage.targetIdentityArtifactPath, executionPackage.targetIdentityArtifactSha256);
  const routingBytes = await readArtifact(executionPackage.runtimeRoutingArtifactPath, executionPackage.runtimeRoutingArtifactSha256);
  await readArtifact(executionPackage.targetProbePath, executionPackage.targetProbeSha256);
  const targetIdentity = JSON.parse(targetBytes.toString("utf8"));
  const routingIdentity = JSON.parse(routingBytes.toString("utf8"));
  if (canonicalTargetIdentityV2(targetIdentity) !== JSON.stringify({ schemaVersion: TARGET_IDENTITY_V2_VERSION, provider: "supabase", projectRef: executionPackage.expectedProjectRef }) || canonicalTargetIdentityV2Sha256(targetIdentity) !== executionPackage.targetIdentityCanonicalSha256) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_V4_INVALID");
  if (routingIdentity.schemaVersion !== RUNTIME_ROUTING_IDENTITY_VERSION || routingIdentity.provider !== "supabase" || routingIdentity.projectRef !== executionPackage.expectedProjectRef || routingIdentity.database !== "postgres" || hashJson(routingIdentity) !== executionPackage.runtimeRoutingCanonicalSha256) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_V4_INVALID");
  const manifestBytes = await readFile(path.join(packageRoot, PACKAGE_MANIFEST_ARTIFACT_V4)).catch(() => fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_V4_INVALID"));
  if (hashBytes(manifestBytes) !== executionPackage.manifestSha256) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_V4_INVALID");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schemaVersion !== PACKAGE_V4_MANIFEST_VERSION || manifest.packageId !== executionPackage.packageId || manifest.expectedProjectRef !== executionPackage.expectedProjectRef || manifest.targetIdentity?.sha256 !== executionPackage.targetIdentityArtifactSha256 || manifest.targetIdentity?.canonicalSha256 !== executionPackage.targetIdentityCanonicalSha256 || manifest.runtimeRouting?.sha256 !== executionPackage.runtimeRoutingArtifactSha256 || manifest.runtimeRouting?.canonicalSha256 !== executionPackage.runtimeRoutingCanonicalSha256 || manifest.targetProbe?.sha256 !== executionPackage.targetProbeSha256) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_V4_INVALID");
  return Object.freeze({ executionPackage, manifest, targetIdentity, routingIdentity });
}
