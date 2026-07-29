import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const R6_V3_AUTH_CHECK_TERMINAL_VERSION = "r6-auth-check-only-terminal-result-v3";
export const R6_V3_AUTH_CHECK_TERMINAL_V2_VERSION = "r6-auth-check-only-terminal-result-v2";
export const R6_V3_AUTH_CHECK_TERMINAL_LEGACY_VERSION = "r6-auth-check-only-terminal-result-v1";
const BASE = [
  "schemaVersion", "mode", "startedAt", "completedAt", "executionWorktree", "executionCommit", "worktreeContract", "worktreeValidationPassed",
  "evidenceRoot", "evidenceRootFresh", "deploymentAttestationPath", "deploymentAttestationSha256", "attestationType", "attestationIssuedAt", "attestationExpiresAt", "attestationValidatedAt", "remainingValidityMs", "minimumRequiredValidityMs", "attestationFreshnessPassed",
  "captureTerminalLocated", "captureTerminalShaValidated", "captureTerminalSchemaAccepted", "captureTerminalClassificationAccepted", "captureTerminalFreshnessAccepted", "captureParentRootMatched", "captureCommandProvenanceMatched", "attestationPathMatched", "attestationShaMatched", "captureProvenancePassed",
  "credentialPromptReached", "otpPromptReached",
];
const OUTCOME = ["authenticationAttempted", "authenticationCompleted", "sessionCreated", "sessionValidated", "authenticatedCheckReached", "authenticatedCheckCompleted", "pagesRequestCount", "deploymentRequestCount", "supabaseReadCount", "supabaseWriteCount", "productionMutationCount", "childStarted", "childExitCode", "outerClassification", "innerClassification", "failureStage", "exceptionType", "success"];
const DIAGNOSTIC_V2 = ["authenticationStageReached", "endpointBindingPassed", "projectConfigurationPassed", "requestAttempted", "requestDispatched", "responseReceived", "networkFailureKind", "tlsFailureKind", "httpStatusCode", "providerErrorCodeClass"];
const DIAGNOSTIC_V3 = ["authenticationStageReached", "endpointBindingPassed", "projectConfigurationPassed", "requestAttempted", "requestDispatched", "responseReceived", "networkFailureKind", "tlsFailureKind", "httpStatusCode", "providerReasonClass", "providerReasonRecognized"];
const LEGACY_REQUIRED = [...BASE, ...OUTCOME];
const V2_REQUIRED = [...BASE, ...DIAGNOSTIC_V2, ...OUTCOME];
const V3_REQUIRED = [...BASE, ...DIAGNOSTIC_V3, ...OUTCOME];
const sensitive = /(?:password|token|authorization|cookie|apikey|service.?role|@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,7})?Z$/;
const networkKinds = new Set(["none", "dns", "connection", "timeout", "tls", "unknown"]);
const tlsKinds = new Set(["none", "trust", "secure_channel", "other"]);
const v2ProviderCodes = new Set(["not_observed", "invalid_grant", "invalid_credentials", "email_not_confirmed", "user_not_found", "rate_limit", "provider_rejection_other"]);
const providerReasons = new Set(["not_observed", "credential_rejection", "email_confirmation_required", "account_disabled_or_banned", "project_or_public_key_rejection", "verification_required", "rate_limited", "temporary_provider_rejection", "provider_rejection_other"]);
const recognizedReasons = new Set([...providerReasons].filter((value) => !["not_observed", "provider_rejection_other"].includes(value)));
const specificClassifications = new Map([
  ["R6_AUTH_CREDENTIAL_REJECTED", "credential_rejection"],
  ["R6_AUTH_EMAIL_CONFIRMATION_REQUIRED", "email_confirmation_required"],
  ["R6_AUTH_ACCOUNT_DISABLED_OR_BANNED", "account_disabled_or_banned"],
  ["R6_AUTH_PROJECT_OR_PUBLIC_KEY_REJECTED", "project_or_public_key_rejection"],
  ["R6_AUTH_VERIFICATION_REQUIRED", "verification_required"],
  ["R6_AUTH_RATE_LIMITED", "rate_limited"],
  ["R6_AUTH_TEMPORARY_PROVIDER_REJECTION", "temporary_provider_rejection"],
]);
const known = new Set(["R6_AUTH_DNS_RESOLUTION_FAILED", "R6_AUTH_CONNECTION_FAILED", "R6_AUTH_CONNECTION_TIMEOUT", "R6_AUTH_TLS_NEGOTIATION_FAILED", "R6_AUTH_HTTP_BAD_REQUEST", "R6_AUTH_HTTP_UNAUTHORIZED", "R6_AUTH_HTTP_FORBIDDEN", "R6_AUTH_HTTP_NOT_FOUND", "R6_AUTH_HTTP_RATE_LIMITED", "R6_AUTH_HTTP_SERVER_ERROR", "R6_AUTH_HTTP_OTHER_REJECTION", "R6_AUTH_RESPONSE_MALFORMED", "R6_AUTH_ENDPOINT_BINDING_INVALID", "R6_AUTH_PROJECT_CONFIGURATION_INVALID", "R6_AUTH_UNEXPECTED_FAILURE", ...specificClassifications.keys()]);
function fail(code) { throw Object.assign(new Error(code), { code }); }
function required(value, keys) { return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function assertNoSensitiveValues(value) {
  for (const [key, entry] of Object.entries(value)) if (typeof entry === "string" && !["schemaVersion", "mode", "outerClassification", "innerClassification", "failureStage", "exceptionType", "providerReasonClass"].includes(key) && sensitive.test(entry)) fail("R6_V3_AUTH_CHECK_TERMINAL_SECRET_REJECTED");
}
function common(value) {
  if (value.mode !== "AuthCheckOnly" || value.worktreeContract !== "current-canonical-production-v3") fail("R6_V3_AUTH_CHECK_TERMINAL_SCHEMA_INVALID");
  if (![value.startedAt, value.completedAt].every((item) => timestamp.test(String(item)))) fail("R6_V3_AUTH_CHECK_TERMINAL_TIME_INVALID");
  assertNoSensitiveValues(value);
  for (const key of ["worktreeValidationPassed", "evidenceRootFresh", "attestationFreshnessPassed", "captureTerminalLocated", "captureTerminalShaValidated", "captureTerminalSchemaAccepted", "captureTerminalClassificationAccepted", "captureTerminalFreshnessAccepted", "captureParentRootMatched", "captureCommandProvenanceMatched", "attestationPathMatched", "attestationShaMatched", "captureProvenancePassed", "credentialPromptReached", "otpPromptReached", "authenticationAttempted", "authenticationCompleted", "sessionCreated", "sessionValidated", "authenticatedCheckReached", "authenticatedCheckCompleted", "childStarted", "success"]) if (typeof value[key] !== "boolean") fail("R6_V3_AUTH_CHECK_TERMINAL_SCHEMA_INVALID");
  for (const key of ["pagesRequestCount", "deploymentRequestCount", "supabaseReadCount", "supabaseWriteCount", "productionMutationCount", "childExitCode", "remainingValidityMs", "minimumRequiredValidityMs"]) if (!Number.isInteger(value[key]) && value[key] !== null) fail("R6_V3_AUTH_CHECK_TERMINAL_SCHEMA_INVALID");
  if (typeof value.failureStage !== "string" || value.failureStage.length === 0 || (value.exceptionType !== null && !/^[A-Za-z0-9_.]+$/.test(value.exceptionType))) fail("R6_V3_AUTH_CHECK_TERMINAL_SCHEMA_INVALID");
  if (value.pagesRequestCount !== 0 || value.deploymentRequestCount !== 0 || value.supabaseWriteCount !== 0 || value.productionMutationCount !== 0) fail("R6_V3_AUTH_CHECK_TERMINAL_MUTATION_CONTRADICTION");
  if (!value.authenticationCompleted && (value.sessionCreated || value.sessionValidated || value.authenticatedCheckReached || value.authenticatedCheckCompleted)) fail("R6_V3_AUTH_CHECK_TERMINAL_AUTH_STATE_CONTRADICTION");
  if (!value.sessionCreated && value.sessionValidated) fail("R6_V3_AUTH_CHECK_TERMINAL_AUTH_STATE_CONTRADICTION");
  if (value.authenticatedCheckReached && !value.sessionValidated) fail("R6_V3_AUTH_CHECK_TERMINAL_AUTH_STATE_CONTRADICTION");
}
function assertLifecycle(value) {
  for (const key of ["authenticationStageReached", "endpointBindingPassed", "projectConfigurationPassed", "requestAttempted", "requestDispatched", "responseReceived"]) if (typeof value[key] !== "boolean") fail("R6_V3_AUTH_CHECK_TERMINAL_SCHEMA_INVALID");
  if (!networkKinds.has(value.networkFailureKind) || !tlsKinds.has(value.tlsFailureKind) || (value.httpStatusCode !== null && (!Number.isInteger(value.httpStatusCode) || value.httpStatusCode < 100 || value.httpStatusCode > 599))) fail("R6_V3_AUTH_CHECK_TERMINAL_DIAGNOSTIC_INVALID");
  if (value.requestDispatched && (!value.requestAttempted || !value.authenticationStageReached)) fail("R6_V3_AUTH_CHECK_TERMINAL_REQUEST_CONTRADICTION");
  if (value.responseReceived && !value.requestDispatched) fail("R6_V3_AUTH_CHECK_TERMINAL_REQUEST_CONTRADICTION");
  if (!value.responseReceived && value.httpStatusCode !== null) fail("R6_V3_AUTH_CHECK_TERMINAL_RESPONSE_CONTRADICTION");
  if (value.networkFailureKind === "dns" && value.responseReceived) fail("R6_V3_AUTH_CHECK_TERMINAL_NETWORK_CONTRADICTION");
  if (value.networkFailureKind === "tls" && (value.responseReceived || value.httpStatusCode !== null)) fail("R6_V3_AUTH_CHECK_TERMINAL_NETWORK_CONTRADICTION");
  if (value.tlsFailureKind !== "none" && value.networkFailureKind !== "tls") fail("R6_V3_AUTH_CHECK_TERMINAL_NETWORK_CONTRADICTION");
}
function assertOutcome(value) {
  if (value.success) {
    if (value.outerClassification !== "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_OK" || value.innerClassification !== null || value.exceptionType !== null || value.failureStage !== "complete" || value.childExitCode !== 0 || !value.worktreeValidationPassed || !value.captureProvenancePassed || !value.attestationFreshnessPassed || !value.authenticationCompleted || !value.sessionValidated || !value.authenticatedCheckCompleted) fail("R6_V3_AUTH_CHECK_TERMINAL_SUCCESS_CONTRADICTION");
    return;
  }
  if (value.outerClassification !== "R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_FAILED" || typeof value.innerClassification !== "string" || !value.innerClassification || value.exceptionType === null || value.childExitCode === 0) fail("R6_V3_AUTH_CHECK_TERMINAL_FAILURE_CONTRADICTION");
  if (!known.has(value.innerClassification)) return;
  if (known.has(value.innerClassification) && !value.authenticationStageReached) fail("R6_V3_AUTH_CHECK_TERMINAL_FAILURE_CONTRADICTION");
  if (value.innerClassification === "R6_AUTH_ENDPOINT_BINDING_INVALID" && (value.failureStage !== "AUTH_PASSWORD_GRANT_ENDPOINT_BINDING" || value.requestAttempted || value.requestDispatched)) fail("R6_V3_AUTH_CHECK_TERMINAL_FAILURE_CONTRADICTION");
  if (value.innerClassification === "R6_AUTH_PROJECT_CONFIGURATION_INVALID" && (value.failureStage !== "AUTH_PASSWORD_GRANT_PROJECT_CONFIGURATION" || value.requestAttempted || value.requestDispatched)) fail("R6_V3_AUTH_CHECK_TERMINAL_FAILURE_CONTRADICTION");
  if (value.innerClassification === "R6_AUTH_RESPONSE_MALFORMED" && (value.failureStage !== "AUTH_PASSWORD_GRANT_RESPONSE" || !value.responseReceived)) fail("R6_V3_AUTH_CHECK_TERMINAL_FAILURE_CONTRADICTION");
  if (!["R6_AUTH_ENDPOINT_BINDING_INVALID", "R6_AUTH_PROJECT_CONFIGURATION_INVALID", "R6_AUTH_RESPONSE_MALFORMED"].includes(value.innerClassification) && value.failureStage !== "AUTH_PASSWORD_GRANT_REQUEST") fail("R6_V3_AUTH_CHECK_TERMINAL_FAILURE_CONTRADICTION");
}
function legacy(value) {
  if (!required(value, LEGACY_REQUIRED) || value.schemaVersion !== R6_V3_AUTH_CHECK_TERMINAL_LEGACY_VERSION) fail("R6_V3_AUTH_CHECK_TERMINAL_SCHEMA_INVALID");
  common(value); assertOutcome(value);
}
function v2(value) {
  if (!required(value, V2_REQUIRED) || value.schemaVersion !== R6_V3_AUTH_CHECK_TERMINAL_V2_VERSION) fail("R6_V3_AUTH_CHECK_TERMINAL_SCHEMA_INVALID");
  common(value); assertLifecycle(value);
  if (!v2ProviderCodes.has(value.providerErrorCodeClass)) fail("R6_V3_AUTH_CHECK_TERMINAL_DIAGNOSTIC_INVALID");
  assertOutcome(value);
  if (value.httpStatusCode === 401 && value.innerClassification !== "R6_AUTH_HTTP_UNAUTHORIZED") fail("R6_V3_AUTH_CHECK_TERMINAL_HTTP_CLASSIFICATION_INVALID");
}
function v3(value) {
  if (!required(value, V3_REQUIRED) || value.schemaVersion !== R6_V3_AUTH_CHECK_TERMINAL_VERSION) fail("R6_V3_AUTH_CHECK_TERMINAL_SCHEMA_INVALID");
  common(value); assertLifecycle(value);
  if (!providerReasons.has(value.providerReasonClass) || typeof value.providerReasonRecognized !== "boolean" || (value.providerReasonRecognized !== recognizedReasons.has(value.providerReasonClass))) fail("R6_V3_AUTH_CHECK_TERMINAL_DIAGNOSTIC_INVALID");
  assertOutcome(value);
  if (value.success && (value.providerReasonClass !== "not_observed" || value.providerReasonRecognized)) fail("R6_V3_AUTH_CHECK_TERMINAL_DIAGNOSTIC_INVALID");
  const expectedReason = specificClassifications.get(value.innerClassification);
  if (expectedReason && (value.httpStatusCode !== 400 || value.providerReasonClass !== expectedReason || !value.providerReasonRecognized)) fail("R6_V3_AUTH_CHECK_TERMINAL_HTTP_CLASSIFICATION_INVALID");
  if (value.innerClassification === "R6_AUTH_HTTP_BAD_REQUEST" && (value.httpStatusCode !== 400 || value.providerReasonRecognized)) fail("R6_V3_AUTH_CHECK_TERMINAL_HTTP_CLASSIFICATION_INVALID");
  if (value.innerClassification === "R6_AUTH_HTTP_UNAUTHORIZED" && value.httpStatusCode !== 401) fail("R6_V3_AUTH_CHECK_TERMINAL_HTTP_CLASSIFICATION_INVALID");
}
export function validateR6V3AuthCheckTerminal(value) {
  if (value?.schemaVersion === R6_V3_AUTH_CHECK_TERMINAL_LEGACY_VERSION) legacy(value);
  else if (value?.schemaVersion === R6_V3_AUTH_CHECK_TERMINAL_V2_VERSION) v2(value);
  else v3(value);
  return Object.freeze({ classification: value.outerClassification, sha256: createHash("sha256").update(JSON.stringify(value)).digest("hex") });
}
if (process.argv[1] && fileURLToPath(import.meta.url).replaceAll("\\", "/") === process.argv[1].replaceAll("\\", "/")) {
  try { const value = JSON.parse(await readFile(process.argv[2], "utf8")); validateR6V3AuthCheckTerminal(value); process.stdout.write("R6_V3_AUTH_CHECK_TERMINAL_OK\n"); }
  catch (error) { process.stderr.write(`${error?.code ?? "R6_V3_AUTH_CHECK_TERMINAL_INVALID"}\n`); process.exitCode = 1; }
}
