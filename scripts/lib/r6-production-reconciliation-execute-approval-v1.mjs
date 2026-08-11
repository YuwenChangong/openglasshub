import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { validateAuthorizationV4, validateFinalHumanConfirmationV4, validateLauncherBindingV2 } from "./r6-production-reconciliation-authorization-v3.mjs";
import { loadProductionReconciliationV4Package } from "./r6-production-reconciliation-package-v4.mjs";

export const EXECUTE_APPROVAL_V1_VERSION = "r6-production-reconciliation-execute-approval-v1";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const HASH = /^[a-f0-9]{64}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const keys = ["schemaVersion","sourceCommit","packageId","packageSchemaVersion","executionPackageSha256","manifestSha256","candidateId","candidateSha256","finalConfirmationSchemaVersion","finalConfirmationSha256","globalConsumptionClaimSha256","targetIdentitySchemaVersion","targetIdentityCanonicalSha256","runtimeRoutingSchemaVersion","runtimeRoutingArtifactSha256","expectedProjectRef","launcherBindingSchemaVersion","launcherBindingSha256","launcherSha256","secureWrapperSha256","canonicalMigrationSha256","canonicalMigrationBytes","postflightSha256","baselineSha256","executionAuthorized","executionAttemptConsumed","SQL_SUBMITTED","ProductionMutationSubmissions","singleUse","issuedAtUtc"];
const exact = value => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));

export function validateExecuteApprovalV1(value) {
  if (!exact(value) || value.schemaVersion !== EXECUTE_APPROVAL_V1_VERSION || !/^[a-f0-9]{40}$/.test(String(value.sourceCommit)) || !/^[a-f0-9-]{36}$/.test(String(value.packageId)) || value.packageSchemaVersion !== "r6-production-reconciliation-execution-package-v4" || value.finalConfirmationSchemaVersion !== "r6-production-reconciliation-final-human-confirmation-v4" || value.targetIdentitySchemaVersion !== "r6-production-target-identity-v2" || value.runtimeRoutingSchemaVersion !== "r6-production-runtime-routing-identity-v1" || value.launcherBindingSchemaVersion !== "r6-production-reconciliation-launcher-binding-v2" || !/^[a-z0-9]{20}$/.test(String(value.expectedProjectRef)) || value.canonicalMigrationBytes !== 22730 || value.executionAuthorized !== true || value.executionAttemptConsumed !== false || value.SQL_SUBMITTED !== false || value.ProductionMutationSubmissions !== 0 || value.singleUse !== true || Number.isNaN(Date.parse(String(value.issuedAtUtc))) || ["executionPackageSha256","manifestSha256","candidateSha256","finalConfirmationSha256","globalConsumptionClaimSha256","targetIdentityCanonicalSha256","runtimeRoutingArtifactSha256","launcherBindingSha256","launcherSha256","secureWrapperSha256","canonicalMigrationSha256","postflightSha256","baselineSha256"].some(key => !HASH.test(String(value[key])))) fail("R6_PRODUCTION_RECONCILIATION_EXECUTE_APPROVAL_V1_INVALID");
  return Object.freeze({ ...value });
}

export async function buildExecuteApprovalV1({ repositoryRoot, packageRoot, candidatePath, finalConfirmationPath, launcherBindingPath, launcherSha256, secureWrapperSha256, now = new Date().toISOString() }) {
  const [candidateBytes, finalBytes, bindingBytes] = await Promise.all([readFile(candidatePath), readFile(finalConfirmationPath), readFile(launcherBindingPath)]);
  const candidate = validateAuthorizationV4(JSON.parse(candidateBytes));
  const finalConfirmation = validateFinalHumanConfirmationV4(JSON.parse(finalBytes), { candidate, candidateSha256: hash(candidateBytes) });
  const launcherBinding = validateLauncherBindingV2(JSON.parse(bindingBytes));
  const loaded = await loadProductionReconciliationV4Package({ packageRoot, repositoryRoot });
  if (launcherBinding.launcherSha256 !== launcherSha256 || launcherBinding.secureWrapperSha256 !== secureWrapperSha256 || finalConfirmation.packageId !== loaded.executionPackage.packageId) fail("R6_PRODUCTION_RECONCILIATION_EXECUTE_APPROVAL_V1_BINDING_FAILED");
  return validateExecuteApprovalV1({ schemaVersion: EXECUTE_APPROVAL_V1_VERSION, sourceCommit: candidate.transportImplementationCommit, packageId: candidate.packageId, packageSchemaVersion: candidate.packageSchemaVersion, executionPackageSha256: candidate.executionPackageSha256, manifestSha256: candidate.packageManifestSha256, candidateId: candidate.authorizationId, candidateSha256: hash(candidateBytes), finalConfirmationSchemaVersion: finalConfirmation.schemaVersion, finalConfirmationSha256: hash(finalBytes), globalConsumptionClaimSha256: finalConfirmation.globalConsumptionClaimSha256, targetIdentitySchemaVersion: candidate.targetIdentitySchemaVersion, targetIdentityCanonicalSha256: candidate.targetIdentityCanonicalSha256, runtimeRoutingSchemaVersion: candidate.runtimeRoutingSchemaVersion, runtimeRoutingArtifactSha256: candidate.runtimeRoutingArtifactSha256, expectedProjectRef: candidate.expectedProjectRef, launcherBindingSchemaVersion: launcherBinding.schemaVersion, launcherBindingSha256: hash(bindingBytes), launcherSha256, secureWrapperSha256, canonicalMigrationSha256: candidate.canonicalMigrationSha256, canonicalMigrationBytes: 22730, postflightSha256: candidate.canonicalPostflightSha256, baselineSha256: loaded.manifest.baselineSha256, executionAuthorized: true, executionAttemptConsumed: false, SQL_SUBMITTED: false, ProductionMutationSubmissions: 0, singleUse: true, issuedAtUtc: now });
}

export async function issueExecuteApprovalV1({ outputPath, ...inputs }) {
  const approval = await buildExecuteApprovalV1(inputs);
  await mkdir(path.dirname(outputPath), { recursive: true });
  let handle;
  try { handle = await open(outputPath, "wx", 0o600); const bytes = Buffer.from(`${JSON.stringify(approval)}\n`, "utf8"); await handle.writeFile(bytes); await handle.sync(); return Object.freeze({ approval, path: outputPath, sha256: hash(bytes) }); }
  catch (error) { if (error?.code === "EEXIST") fail("R6_PRODUCTION_RECONCILIATION_EXECUTE_APPROVAL_REPLAY"); throw error; }
  finally { await handle?.close(); }
}
