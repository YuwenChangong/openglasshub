import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateCanonicalCanaryTargetBinding } from "./canonical-canary-target-binding.mjs";

export const R6_V3_DRY_RUN_TERMINAL_VERSION = "r6-v3-dry-run-terminal-result-v3";
const V2_VERSION = "r6-v3-dry-run-terminal-result-v2";
const LEGACY_VERSION = "r6-v3-dry-run-terminal-result-v1";
const BASE_REQUIRED = [
  "schemaVersion", "startedAt", "completedAt", "runId", "outerClassification", "innerClassification", "success", "failureStage",
  "captureProvenancePassed", "authProvenancePassed", "attestationFreshnessPassed", "minimumRequiredValidityMs", "remainingValidityMs",
  "runIdValidationPassed", "reservationAttempted", "reservationCompleted", "receiptCreated", "receiptState",
  "executionCommit", "receiptRunnerCommit", "expectedToolingCommit", "targetBinding", "targetBindingPath", "targetBindingSha256", "childStarted", "canaryChildStarted", "childCompleted", "childTimedOut", "stdoutClassification", "stderrClassification", "childTerminalPath", "childTerminalSha256", "childTerminalLocated", "childTerminalValidated", "adapterReached", "journalCreated", "childExitCode", "plannedMutationCount", "actualMutationCount", "supabaseWriteCount", "productionMutationCount", "retryCount",
];
const TARGET_DIAGNOSTIC_REQUIRED = [
  "authenticationCompleted", "targetResolutionStarted", "targetResolutionCompleted", "targetResolutionSucceeded", "targetResolutionFailureCategory", "targetResultCountClass", "targetEligibleState", "canonicalCircleIdResolved", "canonicalCircleSlugResolved", "targetBindingArtifactPresent", "targetBindingValidationPassed", "targetBindingCreated", "targetBindingHashCreated", "targetBoundExecutionPlanHashCreated",
];
const TARGET_FAILURE_CATEGORIES = new Set(["TARGET_INPUT_INVALID", "TARGET_NOT_FOUND", "TARGET_NON_UNIQUE", "TARGET_INELIGIBLE", "TARGET_RESOLUTION_INCOMPLETE", "PROVIDER_OR_READ_FAILURE", "BINDING_ARTIFACT_PRESENT", "BINDING_ARTIFACT_MISSING", "BINDING_ARTIFACT_INVALID", "RESOLVER_PROCESS_FAILURE", "RESOLVER_OUTPUT_INVALID", "UNKNOWN_TARGET_RESOLUTION_FAILURE"]);
const RESULT_COUNT_CLASSES = new Set(["ZERO", "ONE", "MULTIPLE", "UNKNOWN"]);
const ELIGIBILITY_STATES = new Set(["ELIGIBLE", "INELIGIBLE", "UNKNOWN"]);
const RUN_ID = /^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,7})?Z$/;
const SENSITIVE = /(?:password|token|authorization|cookie|apikey|service.?role|@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
function fail(code) { throw Object.assign(new Error(code), { code }); }

function requiredFor(version) {
  if (version === LEGACY_VERSION) return BASE_REQUIRED.filter((key) => !["targetBinding", "targetBindingPath", "targetBindingSha256"].includes(key));
  if (version === V2_VERSION) return BASE_REQUIRED;
  if (version === R6_V3_DRY_RUN_TERMINAL_VERSION) return [...BASE_REQUIRED, ...TARGET_DIAGNOSTIC_REQUIRED];
  return null;
}

function assertTargetDiagnostics(value) {
  for (const key of ["authenticationCompleted", "targetResolutionStarted", "targetResolutionCompleted", "targetResolutionSucceeded", "canonicalCircleIdResolved", "canonicalCircleSlugResolved", "targetBindingArtifactPresent", "targetBindingValidationPassed", "targetBindingCreated", "targetBindingHashCreated", "targetBoundExecutionPlanHashCreated"]) if (typeof value[key] !== "boolean") fail("R6_V3_DRY_RUN_TERMINAL_TARGET_DIAGNOSTIC_INVALID");
  if ((value.targetResolutionFailureCategory !== null && !TARGET_FAILURE_CATEGORIES.has(value.targetResolutionFailureCategory)) || !RESULT_COUNT_CLASSES.has(value.targetResultCountClass) || !ELIGIBILITY_STATES.has(value.targetEligibleState)) fail("R6_V3_DRY_RUN_TERMINAL_TARGET_DIAGNOSTIC_INVALID");
  const canonicalResolved = value.canonicalCircleIdResolved && value.canonicalCircleSlugResolved;
  const bindingReady = value.targetBindingArtifactPresent && value.targetBindingValidationPassed && value.targetBindingCreated && value.targetBindingHashCreated && value.targetBoundExecutionPlanHashCreated;
  if (!value.targetResolutionStarted) {
    if (value.targetResolutionCompleted || value.targetResolutionSucceeded || value.targetResolutionFailureCategory !== null || value.targetResultCountClass !== "UNKNOWN" || value.targetEligibleState !== "UNKNOWN" || value.authenticationCompleted || canonicalResolved || bindingReady) fail("R6_V3_DRY_RUN_TERMINAL_TARGET_LIFECYCLE_INVALID");
    return;
  }
  if (!value.authenticationCompleted || !value.targetResolutionCompleted) fail("R6_V3_DRY_RUN_TERMINAL_TARGET_LIFECYCLE_INVALID");
  if (value.targetResolutionSucceeded) {
    if (value.targetResolutionFailureCategory !== null || value.targetResultCountClass !== "ONE" || value.targetEligibleState !== "ELIGIBLE" || !canonicalResolved || !bindingReady || value.targetBinding === null || value.targetBindingPath === null || value.targetBindingSha256 === null) fail("R6_V3_DRY_RUN_TERMINAL_TARGET_LIFECYCLE_INVALID");
    return;
  }
  const invalidBindingArtifact = value.targetResolutionFailureCategory === "BINDING_ARTIFACT_INVALID" && value.targetBindingArtifactPresent && value.targetBindingCreated;
  if (value.failureStage !== "TARGET_RESOLUTION") fail("R6_V3_DRY_RUN_TERMINAL_TARGET_STAGE_INVALID");
  if (value.targetResolutionFailureCategory === null || canonicalResolved || value.targetBindingValidationPassed || (!invalidBindingArtifact && value.targetBindingCreated) || value.targetBindingHashCreated || value.targetBoundExecutionPlanHashCreated || value.targetBinding !== null || value.targetBindingPath !== null || value.targetBindingSha256 !== null) fail("R6_V3_DRY_RUN_TERMINAL_TARGET_LIFECYCLE_INVALID");
  if (value.failureStage === "TARGET_RESOLUTION" && (value.receiptCreated || value.reservationAttempted || value.reservationCompleted || value.receiptRunnerCommit !== null || value.expectedToolingCommit !== null)) fail("R6_V3_DRY_RUN_TERMINAL_TARGET_RECEIPT_ORDER_INVALID");
}

export function validateR6V3DryRunTerminal(value) {
  const required = requiredFor(value?.schemaVersion);
  if (!required || !value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== required.length || required.some((key) => !(key in value))) fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  if (!RUN_ID.test(String(value.runId)) || ![value.startedAt, value.completedAt].every((entry) => TIME.test(String(entry))) || SENSITIVE.test(JSON.stringify(value))) fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  for (const key of ["success", "captureProvenancePassed", "authProvenancePassed", "attestationFreshnessPassed", "runIdValidationPassed", "reservationAttempted", "reservationCompleted", "receiptCreated", "childStarted", "canaryChildStarted", "childCompleted", "childTimedOut", "childTerminalLocated", "childTerminalValidated", "adapterReached", "journalCreated"]) if (typeof value[key] !== "boolean") fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  for (const key of ["minimumRequiredValidityMs", "remainingValidityMs", "childExitCode", "plannedMutationCount", "actualMutationCount", "supabaseWriteCount", "productionMutationCount", "retryCount"]) if (!Number.isInteger(value[key])) fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  if (!["NOT_CREATED_OR_UNCONFIRMED", "PENDING", "CONSUMED"].includes(value.receiptState)) fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  if (value.actualMutationCount !== 0 || value.supabaseWriteCount !== 0 || value.productionMutationCount !== 0 || value.retryCount !== 0 || value.plannedMutationCount !== 2) fail("R6_V3_DRY_RUN_TERMINAL_SAFETY_INVALID");
  if (!COMMIT.test(String(value.executionCommit)) || (value.receiptRunnerCommit !== null && !COMMIT.test(String(value.receiptRunnerCommit))) || (value.expectedToolingCommit !== null && !COMMIT.test(String(value.expectedToolingCommit))) || value.adapterReached || value.journalCreated || value.canaryChildStarted !== value.childStarted || (value.childCompleted && !value.childStarted) || (value.childTimedOut && !value.childCompleted)) fail("R6_V3_DRY_RUN_TERMINAL_SAFETY_INVALID");
  for (const key of ["stdoutClassification", "stderrClassification"]) if (value[key] !== null && !/^QA_CANARY_[A-Z0-9_]+$/.test(String(value[key]))) fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  if (value.childTerminalLocated !== (typeof value.childTerminalPath === "string" && SHA256.test(String(value.childTerminalSha256))) || (value.childTerminalValidated && !value.childTerminalLocated)) fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  if (value.schemaVersion !== LEGACY_VERSION) {
    if (value.targetBindingPath !== null && typeof value.targetBindingPath !== "string") fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
    if (value.targetBindingSha256 !== null && !SHA256.test(String(value.targetBindingSha256))) fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
    if (value.targetBinding !== null) validateCanonicalCanaryTargetBinding(value.targetBinding, { executionCommit: value.executionCommit, toolingCommit: value.expectedToolingCommit ?? value.executionCommit });
  }
  if (value.schemaVersion === R6_V3_DRY_RUN_TERMINAL_VERSION) assertTargetDiagnostics(value);
  if ((!value.reservationAttempted && (value.reservationCompleted || value.receiptCreated || value.receiptState !== "NOT_CREATED_OR_UNCONFIRMED")) || (value.reservationCompleted && (!value.receiptCreated || value.receiptState !== "PENDING")) || (value.receiptCreated && (!value.runIdValidationPassed || !value.reservationAttempted || !value.reservationCompleted))) fail("R6_V3_DRY_RUN_TERMINAL_RESERVATION_CONTRADICTION");
  if (value.childStarted && (!value.reservationCompleted || !value.receiptCreated || !value.runIdValidationPassed || value.receiptRunnerCommit !== value.executionCommit || value.expectedToolingCommit !== value.executionCommit)) fail("R6_V3_DRY_RUN_TERMINAL_CHILD_ORDER_INVALID");
  if (value.innerClassification === "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_UNEXPECTED_FAILURE") fail("R6_V3_DRY_RUN_TERMINAL_STAGE_LEAK");
  if (value.success) {
    if (value.outerClassification !== "R6_CURRENT_CANONICAL_V3_DRY_RUN_ONLY_READY" || value.innerClassification !== null || value.failureStage !== "complete" || !value.captureProvenancePassed || !value.authProvenancePassed || !value.attestationFreshnessPassed || !value.childStarted || !value.childCompleted || value.childTimedOut || value.childExitCode !== 0 || value.remainingValidityMs < value.minimumRequiredValidityMs || (value.schemaVersion !== LEGACY_VERSION && (value.targetBinding === null || value.targetBindingPath === null || value.targetBindingSha256 === null))) fail("R6_V3_DRY_RUN_TERMINAL_SUCCESS_CONTRADICTION");
  } else if (!/^R6_CURRENT_CANONICAL_V3_(?:DRY_RUN|ORCHESTRATION)_[A-Z0-9_]+$/.test(String(value.outerClassification)) || typeof value.innerClassification !== "string" || !value.innerClassification || typeof value.failureStage !== "string" || !value.failureStage) {
    fail("R6_V3_DRY_RUN_TERMINAL_FAILURE_CONTRADICTION");
  }
  if (["QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISSING", "QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISMATCH"].includes(value.innerClassification) && (value.success || value.failureStage !== "V3_ATTESTATION_VALIDATION" || !value.childStarted || !value.childCompleted || value.childExitCode !== 1 || value.adapterReached || value.journalCreated)) fail("R6_V3_DRY_RUN_TERMINAL_TOOLING_CONTRADICTION");
  return Object.freeze({ classification: value.outerClassification });
}

if (process.argv[1] && fileURLToPath(import.meta.url).replaceAll("\\", "/") === process.argv[1].replaceAll("\\", "/")) {
  try { validateR6V3DryRunTerminal(JSON.parse(await readFile(process.argv[2], "utf8"))); process.stdout.write("R6_V3_DRY_RUN_TERMINAL_OK\n"); }
  catch (error) { process.stderr.write(`${error?.code ?? "R6_V3_DRY_RUN_TERMINAL_INVALID"}\n`); process.exitCode = 1; }
}
