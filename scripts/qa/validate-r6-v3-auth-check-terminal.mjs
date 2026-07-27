import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const R6_V3_AUTH_CHECK_TERMINAL_VERSION = "r6-auth-check-only-terminal-result-v1";
const REQUIRED = [
  "schemaVersion", "mode", "startedAt", "completedAt", "executionWorktree", "executionCommit", "worktreeContract", "worktreeValidationPassed",
  "evidenceRoot", "evidenceRootFresh", "deploymentAttestationPath", "deploymentAttestationSha256", "attestationType", "attestationIssuedAt", "attestationExpiresAt", "attestationValidatedAt", "remainingValidityMs", "minimumRequiredValidityMs", "attestationFreshnessPassed",
  "captureTerminalLocated", "captureTerminalShaValidated", "captureTerminalSchemaAccepted", "captureTerminalClassificationAccepted", "captureTerminalFreshnessAccepted", "captureParentRootMatched", "captureCommandProvenanceMatched", "attestationPathMatched", "attestationShaMatched", "captureProvenancePassed",
  "credentialPromptReached", "otpPromptReached", "authenticationAttempted", "authenticationCompleted", "sessionCreated", "sessionValidated", "authenticatedCheckReached", "authenticatedCheckCompleted",
  "pagesRequestCount", "deploymentRequestCount", "supabaseReadCount", "supabaseWriteCount", "productionMutationCount", "childStarted", "childExitCode", "outerClassification", "innerClassification", "failureStage", "exceptionType", "success",
];
const sensitive = /(?:password|token|authorization|cookie|apikey|service.?role|@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,7})?Z$/;
function fail(code) { throw Object.assign(new Error(code), { code }); }
export function validateR6V3AuthCheckTerminal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== REQUIRED.length || REQUIRED.some((key) => !(key in value))) fail("R6_V3_AUTH_CHECK_TERMINAL_SCHEMA_INVALID");
  if (value.schemaVersion !== R6_V3_AUTH_CHECK_TERMINAL_VERSION || value.mode !== "AuthCheckOnly" || value.worktreeContract !== "current-canonical-production-v3") fail("R6_V3_AUTH_CHECK_TERMINAL_SCHEMA_INVALID");
  if (![value.startedAt, value.completedAt].every((value) => timestamp.test(String(value)))) fail("R6_V3_AUTH_CHECK_TERMINAL_TIME_INVALID");
  if (sensitive.test(JSON.stringify(value))) fail("R6_V3_AUTH_CHECK_TERMINAL_SECRET_REJECTED");
  const booleans = ["worktreeValidationPassed", "evidenceRootFresh", "attestationFreshnessPassed", "captureTerminalLocated", "captureTerminalShaValidated", "captureTerminalSchemaAccepted", "captureTerminalClassificationAccepted", "captureTerminalFreshnessAccepted", "captureParentRootMatched", "captureCommandProvenanceMatched", "attestationPathMatched", "attestationShaMatched", "captureProvenancePassed", "credentialPromptReached", "otpPromptReached", "authenticationAttempted", "authenticationCompleted", "sessionCreated", "sessionValidated", "authenticatedCheckReached", "authenticatedCheckCompleted", "childStarted", "success"];
  for (const key of booleans) if (typeof value[key] !== "boolean") fail("R6_V3_AUTH_CHECK_TERMINAL_SCHEMA_INVALID");
  for (const key of ["pagesRequestCount", "deploymentRequestCount", "supabaseReadCount", "supabaseWriteCount", "productionMutationCount", "childExitCode", "remainingValidityMs", "minimumRequiredValidityMs"]) if (!Number.isInteger(value[key]) && value[key] !== null) fail("R6_V3_AUTH_CHECK_TERMINAL_SCHEMA_INVALID");
  if (typeof value.failureStage !== "string" || value.failureStage.length === 0 || (value.exceptionType !== null && !/^[A-Za-z0-9_.]+$/.test(value.exceptionType))) fail("R6_V3_AUTH_CHECK_TERMINAL_SCHEMA_INVALID");
  if (value.pagesRequestCount !== 0 || value.deploymentRequestCount !== 0 || value.supabaseWriteCount !== 0 || value.productionMutationCount !== 0) fail("R6_V3_AUTH_CHECK_TERMINAL_MUTATION_CONTRADICTION");
  if (value.success) {
    if (value.outerClassification !== "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_OK" || value.innerClassification !== null || value.exceptionType !== null || value.failureStage !== "complete" || value.childExitCode !== 0 || !value.worktreeValidationPassed || !value.captureProvenancePassed || !value.attestationFreshnessPassed || !value.authenticationCompleted || !value.sessionValidated || !value.authenticatedCheckCompleted) fail("R6_V3_AUTH_CHECK_TERMINAL_SUCCESS_CONTRADICTION");
  } else if (value.outerClassification !== "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_FAILED" || typeof value.innerClassification !== "string" || value.innerClassification === "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_UNEXPECTED_FAILURE" || value.exceptionType === null || value.childExitCode === 0) fail("R6_V3_AUTH_CHECK_TERMINAL_FAILURE_CONTRADICTION");
  return Object.freeze({ classification: value.outerClassification, sha256: createHash("sha256").update(JSON.stringify(value)).digest("hex") });
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  try { const value = JSON.parse(await readFile(process.argv[2], "utf8")); validateR6V3AuthCheckTerminal(value); process.stdout.write("R6_V3_AUTH_CHECK_TERMINAL_OK\n"); }
  catch (error) { process.stderr.write(`${error?.code ?? "R6_V3_AUTH_CHECK_TERMINAL_INVALID"}\n`); process.exitCode = 1; }
}
