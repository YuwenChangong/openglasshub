import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveCanonicalGitBlob } from "./canonical-git-blob.mjs";
import { TARGET_PROBE_SQL, targetProbeSha256 } from "./r6-production-reconciliation-target.mjs";
import {
  CANONICAL_FINGERPRINT_BASELINE_SHA256, CANONICAL_MIGRATION_BYTES, CANONICAL_MIGRATION_SHA256, CANONICAL_TARGET_IDENTITY_SHA256, CANONICAL_TARGET_PROBE_SHA256, MIGRATION_ARTIFACT, PACKAGE_MANIFEST_VERSION,
  PACKAGE_VERSION, POSTFLIGHT_ARTIFACT, POSTFLIGHT_SHA256, TARGET_PROBE_ARTIFACT,
  TRANSPORT_CONTRACT_VERSION, sha256Bytes, validateProductionReconciliationPackageManifest,
} from "./r6-production-reconciliation-transport-contract.mjs";

const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const migrationPath = "supabase/migrations/20260807073929_reconcile_production_schema_drift.sql";
const postflightPath = "docs/ops/legal-consent-production-schema-fingerprint.sql";

function fail(code) { throw Object.assign(new Error(code), { code }); }
function requireHash(value) { if (!HASH.test(String(value ?? ""))) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_ISSUE_INPUT_INVALID"); return value; }

export async function issueProductionReconciliationV3Package({ packageRoot, repositoryRoot, implementationCommit, launcherSha256, secureWrapperSha256, targetIdentitySha256, baselineSha256 }) {
  if (!path.isAbsolute(String(packageRoot ?? "")) || !path.isAbsolute(String(repositoryRoot ?? "")) || !COMMIT.test(String(implementationCommit ?? ""))) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_ISSUE_INPUT_INVALID");
  for (const value of [launcherSha256, secureWrapperSha256, targetIdentitySha256, baselineSha256]) requireHash(value);
  if (targetIdentitySha256 !== CANONICAL_TARGET_IDENTITY_SHA256 || baselineSha256 !== CANONICAL_FINGERPRINT_BASELINE_SHA256) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_CANONICAL_BINDING_INVALID");
  const [migration, postflight] = [
    resolveCanonicalGitBlob({ repositoryRoot, implementationCommit, repositoryRelativePath: migrationPath }),
    resolveCanonicalGitBlob({ repositoryRoot, implementationCommit, repositoryRelativePath: postflightPath }),
  ];
  const targetProbe = Buffer.from(TARGET_PROBE_SQL, "utf8");
  if (migration.sha256 !== CANONICAL_MIGRATION_SHA256 || migration.byteCount !== CANONICAL_MIGRATION_BYTES || postflight.sha256 !== POSTFLIGHT_SHA256 || sha256Bytes(targetProbe) !== targetProbeSha256() || targetProbeSha256() !== CANONICAL_TARGET_PROBE_SHA256) fail("R6_PRODUCTION_RECONCILIATION_PACKAGE_CANONICAL_BINDING_INVALID");
  await mkdir(packageRoot, { recursive: false });
  const files = [[MIGRATION_ARTIFACT, migration.bytes], [POSTFLIGHT_ARTIFACT, postflight.bytes], [TARGET_PROBE_ARTIFACT, targetProbe]];
  await Promise.all(files.map(([name, bytes]) => writeFile(path.join(packageRoot, name), bytes, { flag: "wx" })));
  const executionPackage = {
    schemaVersion: PACKAGE_VERSION, transportContractVersion: TRANSPORT_CONTRACT_VERSION,
    migration: { artifact: MIGRATION_ARTIFACT, sha256: migration.sha256, bytes: migration.byteCount },
    postflight: { artifact: POSTFLIGHT_ARTIFACT, sha256: postflight.sha256 },
    targetProbe: { artifact: TARGET_PROBE_ARTIFACT, sha256: sha256Bytes(targetProbe) },
  };
  const executionPackagePath = path.join(packageRoot, "production-reconciliation-execution-package.json");
  await writeFile(executionPackagePath, `${JSON.stringify(executionPackage)}\n`, { flag: "wx" });
  const executionPackageSha256 = sha256Bytes(await readFile(executionPackagePath));
  const manifest = {
    schemaVersion: PACKAGE_MANIFEST_VERSION, implementationCommit, transportContractVersion: TRANSPORT_CONTRACT_VERSION,
    executionPackageArtifact: path.basename(executionPackagePath), executionPackageSha256,
    migration: executionPackage.migration, postflight: executionPackage.postflight, targetProbe: executionPackage.targetProbe,
    targetIdentitySha256, baselineSha256, launcherSha256, secureWrapperSha256,
    executionEligible: false, candidateIssued: false, humanConfirmed: false, executionConsumed: false,
  };
  validateProductionReconciliationPackageManifest(manifest);
  const manifestPath = path.join(packageRoot, "production-reconciliation-package-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, { flag: "wx" });
  return Object.freeze({ packageRoot, executionPackagePath, executionPackageSha256, manifestPath, manifestSha256: sha256Bytes(await readFile(manifestPath)), migration, postflight, targetProbe: { bytes: targetProbe, sha256: sha256Bytes(targetProbe), byteCount: targetProbe.length } });
}
