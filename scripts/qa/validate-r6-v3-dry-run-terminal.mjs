import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const R6_V3_DRY_RUN_TERMINAL_VERSION = "r6-v3-dry-run-terminal-result-v1";
const REQUIRED = [
  "schemaVersion", "startedAt", "completedAt", "runId", "outerClassification", "innerClassification", "success", "failureStage",
  "captureProvenancePassed", "authProvenancePassed", "attestationFreshnessPassed", "minimumRequiredValidityMs", "remainingValidityMs",
  "runIdValidationPassed", "reservationAttempted", "reservationCompleted", "receiptCreated", "receiptState",
  "executionCommit", "receiptRunnerCommit", "expectedToolingCommit", "childStarted", "canaryChildStarted", "childCompleted", "childTimedOut", "stdoutClassification", "stderrClassification", "childTerminalPath", "childTerminalSha256", "childTerminalLocated", "childTerminalValidated", "adapterReached", "journalCreated", "childExitCode", "plannedMutationCount", "actualMutationCount", "supabaseWriteCount", "productionMutationCount", "retryCount",
];
const RUN_ID = /^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,7})?Z$/;
const SENSITIVE = /(?:password|token|authorization|cookie|apikey|service.?role|@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
function fail(code) { throw Object.assign(new Error(code), { code }); }

export function validateR6V3DryRunTerminal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== REQUIRED.length || REQUIRED.some((key) => !(key in value))) fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  if (value.schemaVersion !== R6_V3_DRY_RUN_TERMINAL_VERSION || !RUN_ID.test(String(value.runId)) || ![value.startedAt, value.completedAt].every((entry) => TIME.test(String(entry))) || SENSITIVE.test(JSON.stringify(value))) fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  for (const key of ["success", "captureProvenancePassed", "authProvenancePassed", "attestationFreshnessPassed", "runIdValidationPassed", "reservationAttempted", "reservationCompleted", "receiptCreated", "childStarted", "canaryChildStarted", "childCompleted", "childTimedOut", "childTerminalLocated", "childTerminalValidated", "adapterReached", "journalCreated"]) if (typeof value[key] !== "boolean") fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  for (const key of ["minimumRequiredValidityMs", "remainingValidityMs", "childExitCode", "plannedMutationCount", "actualMutationCount", "supabaseWriteCount", "productionMutationCount", "retryCount"]) if (!Number.isInteger(value[key])) fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  if (!["NOT_CREATED_OR_UNCONFIRMED", "PENDING", "CONSUMED"].includes(value.receiptState)) fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  if (value.actualMutationCount !== 0 || value.supabaseWriteCount !== 0 || value.productionMutationCount !== 0 || value.retryCount !== 0 || value.plannedMutationCount !== 2) fail("R6_V3_DRY_RUN_TERMINAL_SAFETY_INVALID");
  if (!COMMIT.test(String(value.executionCommit)) || (value.receiptRunnerCommit !== null && !COMMIT.test(String(value.receiptRunnerCommit))) || (value.expectedToolingCommit !== null && !COMMIT.test(String(value.expectedToolingCommit))) || value.adapterReached || value.journalCreated || value.canaryChildStarted !== value.childStarted || (value.childCompleted && !value.childStarted) || (value.childTimedOut && !value.childCompleted)) fail("R6_V3_DRY_RUN_TERMINAL_SAFETY_INVALID");
  for (const key of ["stdoutClassification", "stderrClassification"]) if (value[key] !== null && !/^QA_CANARY_[A-Z0-9_]+$/.test(String(value[key]))) fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  if (value.childTerminalLocated !== (typeof value.childTerminalPath === "string" && SHA256.test(String(value.childTerminalSha256))) || (value.childTerminalValidated && !value.childTerminalLocated)) fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  if ((!value.reservationAttempted && (value.reservationCompleted || value.receiptCreated || value.receiptState !== "NOT_CREATED_OR_UNCONFIRMED")) || (value.reservationCompleted && (!value.receiptCreated || value.receiptState !== "PENDING")) || (value.receiptCreated && (!value.runIdValidationPassed || !value.reservationAttempted || !value.reservationCompleted))) fail("R6_V3_DRY_RUN_TERMINAL_RESERVATION_CONTRADICTION");
  if (value.childStarted && (!value.reservationCompleted || !value.receiptCreated || !value.runIdValidationPassed || value.receiptRunnerCommit !== value.executionCommit || value.expectedToolingCommit !== value.executionCommit)) fail("R6_V3_DRY_RUN_TERMINAL_CHILD_ORDER_INVALID");
  if (value.innerClassification === "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_UNEXPECTED_FAILURE") fail("R6_V3_DRY_RUN_TERMINAL_STAGE_LEAK");
  if (value.success) {
    if (value.outerClassification !== "R6_CURRENT_CANONICAL_V3_DRY_RUN_ONLY_READY" || value.innerClassification !== null || value.failureStage !== "complete" || !value.captureProvenancePassed || !value.authProvenancePassed || !value.attestationFreshnessPassed || !value.childStarted || !value.childCompleted || value.childTimedOut || value.childExitCode !== 0 || value.remainingValidityMs < value.minimumRequiredValidityMs) fail("R6_V3_DRY_RUN_TERMINAL_SUCCESS_CONTRADICTION");
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
