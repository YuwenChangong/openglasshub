import { createHash, timingSafeEqual } from "node:crypto";
import { getMinimalCanaryMutationPlan } from "./r6-final-canary-execution-contract.mjs";
import { validateDryRunProductionSourceEligibility } from "./r6-dryrun-source-chain-contract.mjs";
import { readAndValidateFinalAuthorization } from "./r6-final-canary-execution-contract.mjs";
import { readFinalExecutionBindingForReview } from "./r6-final-execution-binding-reissue.mjs";

export const PRODUCTION_MANIFEST_VERSION = "r6-production-launcher-binding-v1";
export const PRODUCTION_AUTHORIZATION_VERSION = "r6-production-launcher-authorization-v1";
export const PRODUCTION_LAUNCHER_TERMINAL_VERSION = "r6-production-launcher-terminal-result-v1";
const HASH = /^[a-f0-9]{64}$/;
const RUN_ID = /^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COMMIT = /^[a-f0-9]{40}$/;
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const requiredText = (value, code) => { if (typeof value !== "string" || !value) fail(code); return value; };
const requiredHash = (value, code) => { if (!HASH.test(String(value))) fail(code); return String(value); };
const exact = (value, keys, code) => { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) fail(code); };
function hasSensitiveKey(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => (/(?:password|token|secret|anon|session|slug)/i.test(key) && !["atomicSessionId", "oauthAtomicSessionId"].includes(key)) || hasSensitiveKey(nested));
}

const sourceKeys = ["manifestSchema", "manifestPath", "manifestSha256", "sourceManifest", "oauthReadinessAttestation", "oauthReadinessAttestationPath", "oauthReadinessAttestationSha256", "runId", "executionCommit", "evidenceRoot", "receiptPath", "receiptSha256", "authenticatedResultPath", "authenticatedResultSha256", "dryRunTerminalPath", "dryRunTerminalSha256", "orchestrationTerminalPath", "orchestrationTerminalSha256", "targetBindingPath", "targetBindingSha256", "finalAuthorizationPath", "finalAuthorizationSha256", "sourcePlanSchema", "sourcePlanSha256", "sameCommitBinding"];

export function createProductionManifest(input) {
  const plan = getMinimalCanaryMutationPlan();
  const manifest = {
    schemaVersion: PRODUCTION_MANIFEST_VERSION, runId: requiredText(input.runId, "R6_PRODUCTION_MANIFEST_INVALID"), executionCommit: requiredText(input.executionCommit, "R6_PRODUCTION_MANIFEST_INVALID"), branch: requiredText(input.branch, "R6_PRODUCTION_MANIFEST_INVALID"), executionWorktree: requiredText(input.executionWorktree, "R6_PRODUCTION_MANIFEST_INVALID"), wrapperPath: requiredText(input.wrapperPath, "R6_PRODUCTION_MANIFEST_INVALID"), wrapperSha256: requiredHash(input.wrapperSha256, "R6_PRODUCTION_MANIFEST_INVALID"), launcherPath: requiredText(input.launcherPath, "R6_PRODUCTION_MANIFEST_INVALID"), launcherSha256: requiredHash(input.launcherSha256, "R6_PRODUCTION_MANIFEST_INVALID"), authorizationPath: requiredText(input.authorizationPath, "R6_PRODUCTION_MANIFEST_INVALID"), wranglerVersion: requiredText(input.wranglerVersion, "R6_PRODUCTION_MANIFEST_INVALID"), wranglerEntrySha256: requiredHash(input.wranglerEntrySha256, "R6_PRODUCTION_MANIFEST_INVALID"), evidenceRoot: requiredText(input.evidenceRoot, "R6_PRODUCTION_MANIFEST_INVALID"), operatorRoot: requiredText(input.operatorRoot, "R6_PRODUCTION_MANIFEST_INVALID"), launcherTerminalPath: requiredText(input.launcherTerminalPath, "R6_PRODUCTION_MANIFEST_INVALID"), launcherBreadcrumbPath: requiredText(input.launcherBreadcrumbPath, "R6_PRODUCTION_MANIFEST_INVALID"), executionTerminalPath: requiredText(input.executionTerminalPath, "R6_PRODUCTION_MANIFEST_INVALID"), orchestrationTerminalPath: requiredText(input.orchestrationTerminalPath, "R6_PRODUCTION_MANIFEST_INVALID"), postflightTerminalPath: requiredText(input.postflightTerminalPath, "R6_PRODUCTION_MANIFEST_INVALID"), receiptPath: requiredText(input.receiptPath, "R6_PRODUCTION_MANIFEST_INVALID"), journalPath: requiredText(input.journalPath, "R6_PRODUCTION_MANIFEST_INVALID"), mutationPlanSchema: plan.schemaVersion, mutationPlanSha256: plan.planSha256, operations: plan.operations, operationCount: 2, cleanupContract: "none", retryContract: "none", rollbackContract: "none", persistenceContract: "retain-created-post-and-comment", postflightContract: "read-only-zero-write", source: input.source, confirmationSha256: requiredHash(input.confirmationSha256, "R6_PRODUCTION_MANIFEST_INVALID"), singleUse: true,
  };
  validateProductionManifest(manifest); return Object.freeze(manifest);
}

export function validateProductionManifest(value) {
  const keys = ["schemaVersion","runId","executionCommit","branch","executionWorktree","wrapperPath","wrapperSha256","launcherPath","launcherSha256","authorizationPath","wranglerVersion","wranglerEntrySha256","evidenceRoot","operatorRoot","launcherTerminalPath","launcherBreadcrumbPath","executionTerminalPath","orchestrationTerminalPath","postflightTerminalPath","receiptPath","journalPath","mutationPlanSchema","mutationPlanSha256","operations","operationCount","cleanupContract","retryContract","rollbackContract","persistenceContract","postflightContract","source","confirmationSha256","singleUse"];
  exact(value, keys, "R6_PRODUCTION_MANIFEST_INVALID");
  if (value.schemaVersion !== PRODUCTION_MANIFEST_VERSION || !RUN_ID.test(value.runId) || !COMMIT.test(value.executionCommit) || hasSensitiveKey(value) || value.operationCount !== 2 || value.cleanupContract !== "none" || value.retryContract !== "none" || value.rollbackContract !== "none" || value.persistenceContract !== "retain-created-post-and-comment" || value.postflightContract !== "read-only-zero-write" || value.singleUse !== true) fail("R6_PRODUCTION_MANIFEST_INVALID");
  requiredHash(value.wrapperSha256, "R6_PRODUCTION_MANIFEST_INVALID"); requiredHash(value.launcherSha256, "R6_PRODUCTION_MANIFEST_INVALID"); requiredHash(value.wranglerEntrySha256, "R6_PRODUCTION_MANIFEST_INVALID"); requiredHash(value.confirmationSha256, "R6_PRODUCTION_MANIFEST_INVALID");
  const plan = getMinimalCanaryMutationPlan();
  if (value.mutationPlanSchema !== plan.schemaVersion || value.mutationPlanSha256 !== plan.planSha256 || JSON.stringify(value.operations) !== JSON.stringify(plan.operations)) fail("R6_PRODUCTION_MANIFEST_PLAN_INVALID");
  const source = value.source;
  exact(source, sourceKeys, "R6_PRODUCTION_MANIFEST_SOURCE_INVALID");
  if (source.manifestSchema !== "r6-fresh-dryrun-launcher-binding-v3" || !RUN_ID.test(String(source.runId)) || source.executionCommit !== value.executionCommit || source.sourcePlanSchema !== plan.schemaVersion || source.sourcePlanSha256 !== plan.planSha256 || source.sameCommitBinding !== true || hasSensitiveKey(source)) fail("R6_PRODUCTION_MANIFEST_SOURCE_INVALID");
  try { validateDryRunProductionSourceEligibility({ manifest: source.sourceManifest, executionCommit: value.executionCommit, registryBinding: source.sourceManifest?.registryBinding, oauthReadinessAttestation: source.oauthReadinessAttestation, oauthReadinessAttestationPath: source.oauthReadinessAttestationPath, oauthReadinessAttestationSha256: source.oauthReadinessAttestationSha256 }); } catch { fail("R6_PRODUCTION_MANIFEST_SOURCE_INVALID"); }
  if (source.sourceManifest.runId !== source.runId || source.sourceManifest.evidenceRoot !== source.evidenceRoot || source.sourceManifest.receiptPath !== source.receiptPath || source.sourceManifest.authCheckTerminalPath !== source.authenticatedResultPath || source.sourceManifest.dryRunTerminalPath !== source.dryRunTerminalPath || source.sourceManifest.orchestrationTerminalPath !== source.orchestrationTerminalPath || source.sourceManifest.targetBindingPath !== source.targetBindingPath) fail("R6_PRODUCTION_MANIFEST_SOURCE_INVALID");
  for (const key of ["manifestPath", "evidenceRoot", "receiptPath", "authenticatedResultPath", "dryRunTerminalPath", "orchestrationTerminalPath", "targetBindingPath", "oauthReadinessAttestationPath"]) requiredText(source[key], "R6_PRODUCTION_MANIFEST_SOURCE_INVALID");
  for (const key of ["manifestSha256", "receiptSha256", "authenticatedResultSha256", "dryRunTerminalSha256", "orchestrationTerminalSha256", "targetBindingSha256", "finalAuthorizationSha256", "sourcePlanSha256", "oauthReadinessAttestationSha256"]) requiredHash(source[key], "R6_PRODUCTION_MANIFEST_SOURCE_INVALID");
  return Object.freeze(value);
}

export async function validateProductionPackageReviewEligibility({ source, executionCommit }) {
  if (!source || source.executionCommit !== executionCommit || source.sameCommitBinding !== true) fail("R6_PRODUCTION_PACKAGE_REVIEW_INELIGIBLE");
  try {
    validateDryRunProductionSourceEligibility({ manifest: source.sourceManifest, executionCommit, registryBinding: source.sourceManifest?.registryBinding, oauthReadinessAttestation: source.oauthReadinessAttestation, oauthReadinessAttestationPath: source.oauthReadinessAttestationPath, oauthReadinessAttestationSha256: source.oauthReadinessAttestationSha256 });
    const authorization = await readAndValidateFinalAuthorization(source.finalAuthorizationPath, { executionCommit, toolingCommit: executionCommit, expectedDryRunRunId: source.runId });
    const binding = await readFinalExecutionBindingForReview({ operatorRoot: source.sourceManifest.operatorRoot, expectedExecutionCommit: executionCommit, expectedParentAuthorizationPath: source.finalAuthorizationPath, expectedParentAuthorizationSha256: source.finalAuthorizationSha256 });
    if (authorization.dryRunReceiptPath !== source.receiptPath || authorization.dryRunTerminalPath !== source.dryRunTerminalPath || authorization.dryRunOrchestrationTerminalPath !== source.orchestrationTerminalPath || binding.binding.parentReceiptPath !== source.receiptPath || binding.binding.parentDryRunRunId !== source.runId || binding.binding.planSha256 !== source.sourcePlanSha256) fail("R6_PRODUCTION_PACKAGE_REVIEW_INELIGIBLE");
    if (binding.parentSameCommitClassification !== "R6_FINAL_PARENT_DRYRUN_SAME_COMMIT_BINDING_READY") fail("R6_PRODUCTION_PACKAGE_REVIEW_INELIGIBLE");
    return Object.freeze({ classification: "R6_PRODUCTION_PACKAGE_REVIEW_ELIGIBILITY_READY", bindingSelection: binding.selection, bindingPath: binding.bindingPath, bindingSha256: binding.bindingSha256, parentSameCommitClassification: binding.parentSameCommitClassification });
  } catch (error) {
    if (error?.code) throw error;
    fail("R6_PRODUCTION_PACKAGE_REVIEW_INELIGIBLE");
  }
}

export function createProductionAuthorization(manifest, manifestSha256) {
  validateProductionManifest(manifest); requiredHash(manifestSha256, "R6_PRODUCTION_AUTHORIZATION_INVALID");
  const value = { schemaVersion: PRODUCTION_AUTHORIZATION_VERSION, productionRunId: manifest.runId, executionCommit: manifest.executionCommit, wrapperSha256: manifest.wrapperSha256, productionManifestSha256: manifestSha256, mutationPlanSha256: manifest.mutationPlanSha256, operationCount: 2, cleanupContract: "none", retryContract: "none", rollbackContract: "none", source: manifest.source };
  validateProductionAuthorization(value); return Object.freeze(value);
}

export function validateProductionAuthorization(value) {
  const keys = ["schemaVersion","productionRunId","executionCommit","wrapperSha256","productionManifestSha256","mutationPlanSha256","operationCount","cleanupContract","retryContract","rollbackContract","source"];
  exact(value, keys, "R6_PRODUCTION_AUTHORIZATION_INVALID");
  if (value.schemaVersion !== PRODUCTION_AUTHORIZATION_VERSION || !RUN_ID.test(value.productionRunId) || !COMMIT.test(value.executionCommit) || value.operationCount !== 2 || value.cleanupContract !== "none" || value.retryContract !== "none" || value.rollbackContract !== "none") fail("R6_PRODUCTION_AUTHORIZATION_INVALID");
  for (const key of ["wrapperSha256","productionManifestSha256","mutationPlanSha256"]) requiredHash(value[key], "R6_PRODUCTION_AUTHORIZATION_INVALID");
  return Object.freeze(value);
}

export function confirmationMatches(actual, expectedHash) { const digest = Buffer.from(sha256(actual), "hex"); const expected = Buffer.from(requiredHash(expectedHash, "R6_PRODUCTION_CONFIRMATION_INVALID"), "hex"); return timingSafeEqual(digest, expected); }
