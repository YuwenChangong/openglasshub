import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { loadCandidateAuthority } from "./r6-production-reconciliation-candidate-authority.mjs";
import { FINAL_CONFIRMATION_V5_VERSION, validateFinalHumanConfirmationV5 } from "./r6-production-reconciliation-authorization-v3.mjs";
import { loadExecutionBindingV2 } from "./r6-production-reconciliation-execution-binding-v2.mjs";
import { loadProductionReconciliationV4Package } from "./r6-production-reconciliation-package-v4.mjs";
import { loadCanonicalLauncherTemplateAuthority } from "./r6-canonical-launcher-template-authority.mjs";
import { CANONICAL_FINGERPRINT_BASELINE_SHA256, CANONICAL_MIGRATION_BYTES, CANONICAL_MIGRATION_SHA256, POSTFLIGHT_SHA256 } from "./r6-production-reconciliation-transport-contract.mjs";

export const EXECUTE_APPROVAL_V2_VERSION = "r6-production-reconciliation-execute-approval-v2";
export const GLOBAL_CONFIRMATION_CLAIM_V1_VERSION = "r6-production-reconciliation-human-confirmation-consumption-v1";

const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9-]{36}$/;
const PROJECT_REF = "xcbnxzjlsvtgzixurcof";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };
const keys = [
  "schemaVersion", "sourceCommit", "packageId", "packageSchemaVersion", "executionPackageSha256", "manifestSha256",
  "candidateId", "candidateSchemaVersion", "candidateSha256", "candidateTerminalSha256", "candidateInventorySha256",
  "finalConfirmationSchemaVersion", "finalConfirmationSha256", "globalConsumptionClaimSha256",
  "targetIdentitySchemaVersion", "targetIdentityCanonicalSha256", "runtimeRoutingSchemaVersion", "runtimeRoutingArtifactSha256", "runtimeRoutingCanonicalSha256", "expectedProjectRef",
  "launcherBindingSchemaVersion", "launcherBindingSha256", "canonicalLauncherTemplateSha256", "secureWrapperSha256",
  "canonicalMigrationSha256", "canonicalMigrationBytes", "postflightSha256", "baselineSha256",
  "executionAuthorized", "executionAttemptConsumed", "SQL_SUBMITTED", "ProductionMutationSubmissions", "singleUse", "issuedAtUtc",
];

const exact = value => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const readJson = async (artifactPath, missingCode, invalidCode) => {
  const bytes = await readFile(artifactPath).catch(() => fail(missingCode));
  try { return Object.freeze({ path: artifactPath, bytes, sha256: hash(bytes), value: JSON.parse(bytes.toString("utf8")) }); }
  catch { fail(invalidCode); }
};

export function validateExecuteApprovalV2(value) {
  if (!exact(value)
    || value.schemaVersion !== EXECUTE_APPROVAL_V2_VERSION
    || !COMMIT.test(String(value.sourceCommit))
    || !UUID.test(String(value.packageId))
    || value.packageSchemaVersion !== "r6-production-reconciliation-execution-package-v4"
    || value.candidateSchemaVersion !== "qa-production-reconciliation-execution-authorization-v4"
    || value.finalConfirmationSchemaVersion !== FINAL_CONFIRMATION_V5_VERSION
    || value.targetIdentitySchemaVersion !== "r6-production-target-identity-v2"
    || value.runtimeRoutingSchemaVersion !== "r6-production-runtime-routing-identity-v1"
    || value.launcherBindingSchemaVersion !== "r6-production-reconciliation-launcher-binding-v2"
    || value.expectedProjectRef !== PROJECT_REF
    || value.canonicalMigrationSha256 !== CANONICAL_MIGRATION_SHA256
    || value.canonicalMigrationBytes !== CANONICAL_MIGRATION_BYTES
    || value.postflightSha256 !== POSTFLIGHT_SHA256
    || value.baselineSha256 !== CANONICAL_FINGERPRINT_BASELINE_SHA256
    || value.executionAuthorized !== true || value.executionAttemptConsumed !== false || value.SQL_SUBMITTED !== false
    || value.ProductionMutationSubmissions !== 0 || value.singleUse !== true || Number.isNaN(Date.parse(String(value.issuedAtUtc)))
    || ["executionPackageSha256", "manifestSha256", "candidateSha256", "candidateTerminalSha256", "candidateInventorySha256", "finalConfirmationSha256", "globalConsumptionClaimSha256", "targetIdentityCanonicalSha256", "runtimeRoutingArtifactSha256", "runtimeRoutingCanonicalSha256", "launcherBindingSha256", "canonicalLauncherTemplateSha256", "secureWrapperSha256"].some(key => !HASH.test(String(value[key])))) fail("R6_PRODUCTION_RECONCILIATION_EXECUTE_APPROVAL_V2_INVALID");
  return Object.freeze({ ...value });
}

async function loadGlobalClaim({ finalConfirmation, authority }) {
  const artifact = await readJson(finalConfirmation.globalConsumptionClaimPathOrKey, "R6_PRODUCTION_RECONCILIATION_GLOBAL_CONFIRMATION_CLAIM_MISSING", "R6_PRODUCTION_RECONCILIATION_GLOBAL_CONFIRMATION_CLAIM_INVALID");
  const { candidate } = authority;
  const claim = artifact.value;
  if (artifact.sha256 !== finalConfirmation.globalConsumptionClaimSha256
    || claim?.schemaVersion !== GLOBAL_CONFIRMATION_CLAIM_V1_VERSION
    || claim.sourceCommit !== candidate.transportImplementationCommit || claim.packageId !== candidate.packageId
    || claim.candidateId !== candidate.authorizationId || claim.candidateSha256 !== authority.candidateArtifact.sha256
    || claim.confirmationPhraseSha256 !== finalConfirmation.confirmationPhraseSha256 || claim.consumed !== true
    || claim.singleUseScope !== "GLOBAL_CANDIDATE_PHRASE" || claim.claimState !== "CONSUMED"
    || Number.isNaN(Date.parse(String(claim.consumedAt)))) fail("R6_PRODUCTION_RECONCILIATION_GLOBAL_CONFIRMATION_CLAIM_INVALID");
  return artifact;
}

export async function loadExecuteApprovalV2({ approvalPath, repositoryRoot, packageRoot, candidateRoot, finalConfirmationPath, executionBindingPath }) {
  const artifact = await readJson(approvalPath, "R6_PRODUCTION_RECONCILIATION_EXECUTE_APPROVAL_V2_MISSING", "R6_PRODUCTION_RECONCILIATION_EXECUTE_APPROVAL_V2_INVALID");
  const approval = validateExecuteApprovalV2(artifact.value);
  const expected = await buildExecuteApprovalV2({ repositoryRoot, packageRoot, candidateRoot, finalConfirmationPath, executionBindingPath, now: approval.issuedAtUtc });
  if (JSON.stringify(approval) !== JSON.stringify(expected)) fail("R6_PRODUCTION_RECONCILIATION_EXECUTE_APPROVAL_V2_BINDING_FAILED");
  return Object.freeze({ artifact, approval });
}

export async function buildExecuteApprovalV2({ repositoryRoot, packageRoot, candidateRoot, finalConfirmationPath, executionBindingPath, now = new Date().toISOString() }) {
  const canonicalLauncher = await loadCanonicalLauncherTemplateAuthority({ repositoryRoot });
  const authority = await loadCandidateAuthority({ candidateRoot });
  const finalArtifact = await readJson(finalConfirmationPath, "R6_PRODUCTION_RECONCILIATION_FINAL_HUMAN_CONFIRMATION_REQUIRED", "R6_PRODUCTION_RECONCILIATION_FINAL_CONFIRMATION_V5_INVALID");
  const finalConfirmation = validateFinalHumanConfirmationV5(finalArtifact.value, { authority });
  const [claimArtifact, executionBinding, loaded] = await Promise.all([
    loadGlobalClaim({ finalConfirmation, authority }),
    loadExecutionBindingV2({ executionBindingPath, repositoryRoot, packageRoot, candidateRoot }),
    loadProductionReconciliationV4Package({ packageRoot, repositoryRoot }),
  ]);
  const { candidate } = authority;
  const pkg = loaded.executionPackage;
  if (pkg.sourceCommit !== candidate.transportImplementationCommit || pkg.packageId !== candidate.packageId
    || hash(await readFile(path.join(packageRoot, "production-reconciliation-execution-package.json"))) !== candidate.executionPackageSha256
    || pkg.manifestSha256 !== candidate.packageManifestSha256 || loaded.manifest.packageId !== candidate.packageId
    || loaded.manifest.baselineSha256 !== CANONICAL_FINGERPRINT_BASELINE_SHA256
    || pkg.targetIdentitySchemaVersion !== candidate.targetIdentitySchemaVersion
    || pkg.targetIdentityCanonicalSha256 !== candidate.targetIdentityCanonicalSha256
    || pkg.runtimeRoutingSchemaVersion !== candidate.runtimeRoutingSchemaVersion
    || pkg.runtimeRoutingArtifactSha256 !== candidate.runtimeRoutingArtifactSha256
    || pkg.expectedProjectRef !== candidate.expectedProjectRef || pkg.expectedProjectRef !== PROJECT_REF
    || pkg.runtimeRoutingCanonicalSha256 !== loaded.manifest.runtimeRouting.canonicalSha256
    || executionBinding.value.launcherSha256 !== loaded.manifest.launcherSha256
    || executionBinding.value.secureWrapperSha256 !== loaded.manifest.secureWrapperSha256
    || candidate.canonicalMigrationSha256 !== CANONICAL_MIGRATION_SHA256
    || candidate.canonicalPostflightSha256 !== POSTFLIGHT_SHA256) fail("R6_PRODUCTION_RECONCILIATION_EXECUTE_APPROVAL_V2_BINDING_FAILED");
  return validateExecuteApprovalV2({
    schemaVersion: EXECUTE_APPROVAL_V2_VERSION, sourceCommit: candidate.transportImplementationCommit,
    packageId: candidate.packageId, packageSchemaVersion: candidate.packageSchemaVersion,
    executionPackageSha256: candidate.executionPackageSha256, manifestSha256: candidate.packageManifestSha256,
    candidateId: candidate.authorizationId, candidateSchemaVersion: candidate.schemaVersion,
    candidateSha256: authority.candidateArtifact.sha256, candidateTerminalSha256: authority.terminalArtifact.sha256, candidateInventorySha256: authority.inventoryArtifact.sha256,
    finalConfirmationSchemaVersion: finalConfirmation.schemaVersion, finalConfirmationSha256: finalArtifact.sha256,
    globalConsumptionClaimSha256: claimArtifact.sha256,
    targetIdentitySchemaVersion: candidate.targetIdentitySchemaVersion, targetIdentityCanonicalSha256: candidate.targetIdentityCanonicalSha256,
    runtimeRoutingSchemaVersion: candidate.runtimeRoutingSchemaVersion, runtimeRoutingArtifactSha256: candidate.runtimeRoutingArtifactSha256, runtimeRoutingCanonicalSha256: pkg.runtimeRoutingCanonicalSha256,
    expectedProjectRef: candidate.expectedProjectRef, launcherBindingSchemaVersion: executionBinding.value.schemaVersion,
    launcherBindingSha256: executionBinding.sha256, canonicalLauncherTemplateSha256: canonicalLauncher.canonicalLauncherTemplateSha256, secureWrapperSha256: executionBinding.value.secureWrapperSha256,
    canonicalMigrationSha256: candidate.canonicalMigrationSha256, canonicalMigrationBytes: CANONICAL_MIGRATION_BYTES,
    postflightSha256: candidate.canonicalPostflightSha256, baselineSha256: loaded.manifest.baselineSha256,
    executionAuthorized: true, executionAttemptConsumed: false, SQL_SUBMITTED: false, ProductionMutationSubmissions: 0, singleUse: true, issuedAtUtc: now,
  });
}

export async function issueExecuteApprovalV2({ outputPath, ...inputs }) {
  const approval = await buildExecuteApprovalV2(inputs);
  await mkdir(path.dirname(outputPath), { recursive: true });
  let handle;
  try {
    handle = await open(outputPath, "wx", 0o600);
    const bytes = Buffer.from(`${JSON.stringify(approval)}\n`, "utf8");
    await handle.writeFile(bytes); await handle.sync();
    return Object.freeze({ approval, path: outputPath, sha256: hash(bytes) });
  } catch (error) { if (error?.code === "EEXIST") fail("R6_PRODUCTION_RECONCILIATION_EXECUTE_APPROVAL_V2_REPLAY"); throw error; }
  finally { await handle?.close(); }
}
