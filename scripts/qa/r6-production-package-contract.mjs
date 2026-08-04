import { createHash, timingSafeEqual } from "node:crypto";
import { getMinimalCanaryMutationPlan } from "./r6-final-canary-execution-contract.mjs";

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
  return Object.entries(value).some(([key, nested]) => /(?:password|token|secret|anon|session|slug)/i.test(key) || hasSensitiveKey(nested));
}

const sourceKeys = ["manifestSchema", "manifestPath", "manifestSha256", "runId", "executionCommit", "evidenceRoot", "receiptPath", "receiptSha256", "authenticatedResultPath", "authenticatedResultSha256", "dryRunTerminalPath", "dryRunTerminalSha256", "orchestrationTerminalPath", "orchestrationTerminalSha256", "targetBindingPath", "targetBindingSha256", "sourcePlanSchema", "sourcePlanSha256", "sameCommitBinding"];

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
  for (const key of ["manifestPath", "evidenceRoot", "receiptPath", "authenticatedResultPath", "dryRunTerminalPath", "orchestrationTerminalPath", "targetBindingPath"]) requiredText(source[key], "R6_PRODUCTION_MANIFEST_SOURCE_INVALID");
  for (const key of ["manifestSha256", "receiptSha256", "authenticatedResultSha256", "dryRunTerminalSha256", "orchestrationTerminalSha256", "targetBindingSha256", "sourcePlanSha256"]) requiredHash(source[key], "R6_PRODUCTION_MANIFEST_SOURCE_INVALID");
  return Object.freeze(value);
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
