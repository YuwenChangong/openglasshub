import { createHash } from "node:crypto";
import path from "node:path";
import { getMinimalCanaryMutationPlan } from "./r6-final-canary-execution-contract.mjs";
import { CONSUMED_RUN_REGISTRY_VERSION, validateConsumedRunId } from "./production-minimal-canary-consumed-run-registry.mjs";

export const DRYRUN_SOURCE_MANIFEST_VERSION = "r6-fresh-dryrun-launcher-binding-v3";
export const OAUTH_READINESS_OPERATION = "VALIDATE_CURRENT_CANONICAL_PRODUCTION_V3_OAUTH_PROFILE";
export const OAUTH_READINESS_CLASSIFICATION = "R6_CURRENT_CANONICAL_PRODUCTION_V3_OAUTH_PREFLIGHT_READY";
export const OAUTH_ATTESTATION_VALIDITY_SECONDS = 900;
export const OAUTH_ATTESTATION_MINIMUM_REMAINING_SECONDS = 720;
export const OAUTH_ATTESTATION_MAXIMUM_AGE_SECONDS = 180;
export const OAUTH_ATOMIC_MINIMUM_REMAINING_SECONDS = 840;
export const OAUTH_ATOMIC_MAXIMUM_AGE_SECONDS = 60;
export const DRYRUN_LAUNCHER_TERMINAL_SCHEMA = "r6-v3-operator-launch-terminal-result-v1";
export const DRYRUN_LAUNCHER_BREADCRUMB_SCHEMA = "r6-v3-operator-launch-stage-breadcrumb-v1";
export const DRYRUN_RECEIPT_SCHEMA = CONSUMED_RUN_REGISTRY_VERSION;

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const hash = (value) => createHash("sha256").update(value).digest("hex");

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  return value;
}

export function canonicalJson(value) { return `${JSON.stringify(sorted(value))}\n`; }
export function canonicalSha256(value) { return hash(Buffer.from(canonicalJson(value), "utf8")); }

function requiredText(value, code) { if (typeof value !== "string" || value.length === 0) fail(code); return value; }
function requiredHash(value, code) { if (!SHA256.test(String(value))) fail(code); return String(value); }
function utc(value, code) { if (!UTC.test(String(value)) || new Date(value).toISOString() !== value) fail(code); return value; }
function absolute(value, code) { const resolved = path.resolve(requiredText(value, code)); if (!path.isAbsolute(resolved)) fail(code); return resolved; }
function inside(root, candidate, code) { const relative = path.relative(root, candidate); if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) fail(code); return candidate; }
function exact(value, keys, code) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) fail(code); }
function safePath(root, candidate, runId, code, { requireRunId = false } = {}) { const resolved = absolute(candidate, code); inside(root, resolved, code); if (requireRunId && !resolved.toLowerCase().includes(runId.toLowerCase())) fail(code); return resolved; }

export function validateOAuthReadinessAttestation(value, { now = () => new Date(), atomic = false } = {}) {
  const keys = ["operation", "classification", "issuedAt"];
  exact(value, keys, "R6_DRYRUN_OAUTH_ATTESTATION_INVALID");
  if (value.operation !== OAUTH_READINESS_OPERATION || value.classification !== OAUTH_READINESS_CLASSIFICATION) fail("R6_DRYRUN_OAUTH_ATTESTATION_INVALID");
  const issuedAt = utc(value.issuedAt, "R6_DRYRUN_OAUTH_ATTESTATION_INVALID");
  const issuerStartedAt = now().toISOString();
  const ageSeconds = Math.floor((Date.parse(issuerStartedAt) - Date.parse(issuedAt)) / 1000);
  const remainingSeconds = OAUTH_ATTESTATION_VALIDITY_SECONDS - ageSeconds;
  const maximumAgeSeconds = atomic ? OAUTH_ATOMIC_MAXIMUM_AGE_SECONDS : OAUTH_ATTESTATION_MAXIMUM_AGE_SECONDS;
  const requiredRemainingSeconds = atomic ? OAUTH_ATOMIC_MINIMUM_REMAINING_SECONDS : OAUTH_ATTESTATION_MINIMUM_REMAINING_SECONDS;
  if (ageSeconds < 0 || ageSeconds > maximumAgeSeconds || remainingSeconds < requiredRemainingSeconds) fail("R6_DRYRUN_OAUTH_ATTESTATION_FRESHNESS_INVALID");
  return Object.freeze({ issuedAt, issuerStartedAt, ageSeconds, remainingSeconds, maximumAgeSeconds, requiredRemainingSeconds });
}

export function validateNewDryRunPlan(value) {
  const plan = getMinimalCanaryMutationPlan();
  if (!value || value.schemaVersion !== plan.schemaVersion || value.planSha256 !== plan.planSha256 || JSON.stringify(value.operations) !== JSON.stringify(plan.operations) || value.operationCount !== plan.operationCount || value.cleanupContract !== "none" || value.retryContract !== "none" || value.rollbackContract !== "none" || value.persistenceContract !== "retain-created-post-and-comment" || value.postflightContract !== "read-only-zero-write") fail("R6_DRYRUN_PLAN_V2_REQUIRED");
  return plan;
}

function artifactSchemas() {
  return Object.freeze({
    captureTerminal: "r6-v4-capture-authcheck-dryrun-orchestration-terminal-result-v4",
    authCheckTerminal: "r6-v3-auth-check-only-terminal-result-v3",
    targetBinding: "qa-canary-target-binding-v1",
    receipt: DRYRUN_RECEIPT_SCHEMA,
    dryRunTerminal: "r6-v4-dry-run-terminal-result-v4",
    orchestrationTerminal: "r6-v4-capture-authcheck-dryrun-orchestration-terminal-result-v4",
    registry: CONSUMED_RUN_REGISTRY_VERSION,
    launcherTerminal: DRYRUN_LAUNCHER_TERMINAL_SCHEMA,
    launcherBreadcrumb: DRYRUN_LAUNCHER_BREADCRUMB_SCHEMA,
  });
}

export function createDryRunSourceManifest(config, { now, atomicOAuth = false } = {}) {
  const runId = validateConsumedRunId(config.runId);
  const plan = validateNewDryRunPlan(config.plan ?? getMinimalCanaryMutationPlan());
  if (!COMMIT.test(String(config.executionCommit))) fail("R6_DRYRUN_SOURCE_MANIFEST_COMMIT_INVALID");
  const branch = requiredText(config.branch, "R6_DRYRUN_SOURCE_MANIFEST_BRANCH_INVALID");
  const operatorRoot = absolute(config.operatorRoot, "R6_DRYRUN_SOURCE_MANIFEST_PATH_INVALID");
  const evidenceRoot = absolute(config.evidenceRoot, "R6_DRYRUN_SOURCE_MANIFEST_PATH_INVALID");
  const registryRoot = absolute(config.registryRoot, "R6_DRYRUN_SOURCE_MANIFEST_PATH_INVALID");
  const registryPath = safePath(registryRoot, config.registryPath, runId, "R6_DRYRUN_SOURCE_MANIFEST_REGISTRY_INVALID");
  const receiptPath = safePath(path.join(registryRoot, "consumed-run-receipts-v1"), config.receiptPath, runId, "R6_DRYRUN_SOURCE_MANIFEST_REGISTRY_INVALID", { requireRunId: true });
  const oauth = validateOAuthReadinessAttestation(config.oauthAttestation, { now, atomic: atomicOAuth });
  const launcherPath = absolute(config.launcherPath, "R6_DRYRUN_SOURCE_MANIFEST_PATH_INVALID");
  const paths = {
    launcherTerminalPath: safePath(operatorRoot, config.launcherTerminalPath, runId, "R6_DRYRUN_SOURCE_MANIFEST_PATH_INVALID"),
    launcherBreadcrumbPath: safePath(operatorRoot, config.launcherBreadcrumbPath, runId, "R6_DRYRUN_SOURCE_MANIFEST_PATH_INVALID"),
    wrapperEntryMarkerPath: safePath(operatorRoot, config.wrapperEntryMarkerPath, runId, "R6_DRYRUN_SOURCE_MANIFEST_PATH_INVALID"),
    captureTerminalPath: safePath(evidenceRoot, config.captureTerminalPath, runId, "R6_DRYRUN_SOURCE_MANIFEST_PATH_INVALID"),
    authCheckTerminalPath: safePath(evidenceRoot, config.authCheckTerminalPath, runId, "R6_DRYRUN_SOURCE_MANIFEST_PATH_INVALID"),
    targetBindingPath: safePath(evidenceRoot, config.targetBindingPath, runId, "R6_DRYRUN_SOURCE_MANIFEST_PATH_INVALID"),
    dryRunTerminalPath: safePath(evidenceRoot, config.dryRunTerminalPath, runId, "R6_DRYRUN_SOURCE_MANIFEST_PATH_INVALID"),
    orchestrationTerminalPath: safePath(evidenceRoot, config.orchestrationTerminalPath, runId, "R6_DRYRUN_SOURCE_MANIFEST_PATH_INVALID"),
  };
  const manifest = {
    schemaVersion: DRYRUN_SOURCE_MANIFEST_VERSION,
    runId, executionCommit: config.executionCommit, branch, executionWorktree: absolute(config.executionWorktree, "R6_DRYRUN_SOURCE_MANIFEST_PATH_INVALID"),
    wrapperPath: absolute(config.wrapperPath, "R6_DRYRUN_SOURCE_MANIFEST_PATH_INVALID"), wrapperSha256: requiredHash(config.wrapperSha256, "R6_DRYRUN_SOURCE_MANIFEST_HASH_INVALID"),
    wranglerVersion: requiredText(config.wranglerVersion, "R6_DRYRUN_SOURCE_MANIFEST_WRANGLER_INVALID"), wranglerEntryPathClass: "approved-local-entry", wranglerEntrySha256: requiredHash(config.wranglerEntrySha256, "R6_DRYRUN_SOURCE_MANIFEST_WRANGLER_INVALID"),
    evidenceRoot, operatorRoot, launcherPath, launcherTerminalPath: paths.launcherTerminalPath, launcherBreadcrumbPath: paths.launcherBreadcrumbPath, wrapperEntryMarkerPath: paths.wrapperEntryMarkerPath,
    captureTerminalPath: paths.captureTerminalPath, authCheckTerminalPath: paths.authCheckTerminalPath, targetBindingPath: paths.targetBindingPath, receiptPath, dryRunTerminalPath: paths.dryRunTerminalPath, orchestrationTerminalPath: paths.orchestrationTerminalPath,
    registryBinding: { schemaVersion: CONSUMED_RUN_REGISTRY_VERSION, registryPath, runId, expectedInitialState: "ABSENT", allowedLauncherTransition: "RESERVED_TO_TERMINAL", terminalState: "PERMANENTLY_INELIGIBLE", executionCommit: config.executionCommit },
    artifactSchemas: artifactSchemas(), mutationPlanSchema: plan.schemaVersion, mutationPlanSha256: plan.planSha256, operations: plan.operations, operationCount: plan.operationCount,
    cleanupContract: plan.cleanupContract, retryContract: plan.retryContract, rollbackContract: plan.rollbackContract, persistenceContract: plan.persistenceContract, postflightContract: plan.postflightContract,
    oauthOperation: OAUTH_READINESS_OPERATION, oauthAttestationClassification: OAUTH_READINESS_CLASSIFICATION, oauthAttestationIssuedAt: oauth.issuedAt, issuerStartedAt: oauth.issuerStartedAt, attestationAgeAtIssuerStartSeconds: oauth.ageSeconds, attestationRemainingAtIssuerStartSeconds: oauth.remainingSeconds,
    confirmationSha256: requiredHash(config.confirmationSha256, "R6_DRYRUN_SOURCE_MANIFEST_HASH_INVALID"), singleUse: { enabled: true, retryAllowed: false, replacementRunIdAllowed: false, overwriteAllowed: false, boundPaths: [launcherPath, paths.launcherTerminalPath, paths.launcherBreadcrumbPath, registryPath] },
  };
  validateDryRunSourceManifest(manifest); return Object.freeze(manifest);
}

export function validateDryRunSourceManifest(value) {
  const keys = ["schemaVersion","runId","executionCommit","branch","executionWorktree","wrapperPath","wrapperSha256","wranglerVersion","wranglerEntryPathClass","wranglerEntrySha256","evidenceRoot","operatorRoot","launcherPath","launcherTerminalPath","launcherBreadcrumbPath","wrapperEntryMarkerPath","captureTerminalPath","authCheckTerminalPath","targetBindingPath","receiptPath","dryRunTerminalPath","orchestrationTerminalPath","registryBinding","artifactSchemas","mutationPlanSchema","mutationPlanSha256","operations","operationCount","cleanupContract","retryContract","rollbackContract","persistenceContract","postflightContract","oauthOperation","oauthAttestationClassification","oauthAttestationIssuedAt","issuerStartedAt","attestationAgeAtIssuerStartSeconds","attestationRemainingAtIssuerStartSeconds","confirmationSha256","singleUse"];
  exact(value, keys, "R6_DRYRUN_SOURCE_MANIFEST_INVALID");
  const runId = validateConsumedRunId(value.runId);
  if (value.schemaVersion !== DRYRUN_SOURCE_MANIFEST_VERSION || !COMMIT.test(String(value.executionCommit)) || value.wranglerEntryPathClass !== "approved-local-entry" || value.oauthOperation !== OAUTH_READINESS_OPERATION || value.oauthAttestationClassification !== OAUTH_READINESS_CLASSIFICATION) fail("R6_DRYRUN_SOURCE_MANIFEST_INVALID");
  requiredHash(value.wrapperSha256, "R6_DRYRUN_SOURCE_MANIFEST_INVALID"); requiredHash(value.wranglerEntrySha256, "R6_DRYRUN_SOURCE_MANIFEST_INVALID"); requiredHash(value.confirmationSha256, "R6_DRYRUN_SOURCE_MANIFEST_INVALID");
  const plan = validateNewDryRunPlan({ schemaVersion:value.mutationPlanSchema, planSha256:value.mutationPlanSha256, operations:value.operations, operationCount:value.operationCount, cleanupContract:value.cleanupContract, retryContract:value.retryContract, rollbackContract:value.rollbackContract, persistenceContract:value.persistenceContract, postflightContract:value.postflightContract });
  const operatorRoot=absolute(value.operatorRoot,"R6_DRYRUN_SOURCE_MANIFEST_INVALID"); const evidenceRoot=absolute(value.evidenceRoot,"R6_DRYRUN_SOURCE_MANIFEST_INVALID");
  for(const key of ["launcherTerminalPath","launcherBreadcrumbPath","wrapperEntryMarkerPath"]) safePath(operatorRoot,value[key],runId,"R6_DRYRUN_SOURCE_MANIFEST_INVALID");
  for(const key of ["captureTerminalPath","authCheckTerminalPath","targetBindingPath","dryRunTerminalPath","orchestrationTerminalPath"]) safePath(evidenceRoot,value[key],runId,"R6_DRYRUN_SOURCE_MANIFEST_INVALID");
  exact(value.registryBinding,["schemaVersion","registryPath","runId","expectedInitialState","allowedLauncherTransition","terminalState","executionCommit"],"R6_DRYRUN_SOURCE_MANIFEST_INVALID");
  if(value.registryBinding.schemaVersion!==CONSUMED_RUN_REGISTRY_VERSION||value.registryBinding.runId!==runId||value.registryBinding.expectedInitialState!=="ABSENT"||value.registryBinding.executionCommit!==value.executionCommit) fail("R6_DRYRUN_SOURCE_MANIFEST_INVALID");
  exact(value.singleUse,["enabled","retryAllowed","replacementRunIdAllowed","overwriteAllowed","boundPaths"],"R6_DRYRUN_SOURCE_MANIFEST_INVALID"); if(value.singleUse.enabled!==true||value.singleUse.retryAllowed||value.singleUse.replacementRunIdAllowed||value.singleUse.overwriteAllowed||!Array.isArray(value.singleUse.boundPaths)) fail("R6_DRYRUN_SOURCE_MANIFEST_INVALID");
  exact(value.artifactSchemas,Object.keys(artifactSchemas()),"R6_DRYRUN_SOURCE_MANIFEST_INVALID"); for(const [key,schema] of Object.entries(artifactSchemas())) if(value.artifactSchemas[key]!==schema) fail("R6_DRYRUN_SOURCE_MANIFEST_INVALID");
  utc(value.oauthAttestationIssuedAt,"R6_DRYRUN_SOURCE_MANIFEST_INVALID"); utc(value.issuerStartedAt,"R6_DRYRUN_SOURCE_MANIFEST_INVALID"); if(!Number.isInteger(value.attestationAgeAtIssuerStartSeconds)||!Number.isInteger(value.attestationRemainingAtIssuerStartSeconds)||value.attestationAgeAtIssuerStartSeconds<0||value.attestationRemainingAtIssuerStartSeconds!==OAUTH_ATTESTATION_VALIDITY_SECONDS-value.attestationAgeAtIssuerStartSeconds) fail("R6_DRYRUN_SOURCE_MANIFEST_INVALID");
  return Object.freeze({ ...value, plan });
}

/** Historical artifacts remain parseable, but are never eligible as new Production source. */
export function validateHistoricalDryRunManifest(value) {
  if (value?.schemaVersion === "r6-fresh-dryrun-launcher-binding-v2" && typeof value.runId === "string" && typeof value.executionCommit === "string") return Object.freeze({ historical: true, schemaVersion: value.schemaVersion, runId: value.runId, executionCommit: value.executionCommit });
  return Object.freeze({ historical: false, manifest: validateDryRunSourceManifest(value) });
}

/** Validates the immutable package metadata that a future Production issuer may consume. */
export function validateDryRunProductionSourceEligibility({ manifest, executionCommit, registryBinding } = {}) {
  const value = validateDryRunSourceManifest(manifest);
  if (executionCommit && value.executionCommit !== executionCommit) fail("R6_DRYRUN_PRODUCTION_SOURCE_COMMIT_MISMATCH");
  if (!registryBinding || typeof registryBinding !== "object" || registryBinding.schemaVersion !== value.registryBinding.schemaVersion || registryBinding.registryPath !== value.registryBinding.registryPath || registryBinding.runId !== value.runId || registryBinding.executionCommit !== value.executionCommit) fail("R6_DRYRUN_PRODUCTION_SOURCE_REGISTRY_INVALID");
  return Object.freeze({ classification: "R6_DRYRUN_PRODUCTION_SOURCE_ELIGIBILITY_READY", manifest: value });
}
