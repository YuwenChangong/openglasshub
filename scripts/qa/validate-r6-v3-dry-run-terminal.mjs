import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const R6_V3_DRY_RUN_TERMINAL_VERSION = "r6-v3-dry-run-terminal-result-v1";
const REQUIRED = [
  "schemaVersion", "startedAt", "completedAt", "runId", "outerClassification", "innerClassification", "success", "failureStage",
  "captureProvenancePassed", "authProvenancePassed", "attestationFreshnessPassed", "minimumRequiredValidityMs", "remainingValidityMs",
  "childStarted", "childExitCode", "plannedMutationCount", "actualMutationCount", "supabaseWriteCount", "productionMutationCount", "retryCount",
];
const RUN_ID = /^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,7})?Z$/;
const SENSITIVE = /(?:password|token|authorization|cookie|apikey|service.?role|@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
function fail(code) { throw Object.assign(new Error(code), { code }); }

export function validateR6V3DryRunTerminal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== REQUIRED.length || REQUIRED.some((key) => !(key in value))) fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  if (value.schemaVersion !== R6_V3_DRY_RUN_TERMINAL_VERSION || !RUN_ID.test(String(value.runId)) || ![value.startedAt, value.completedAt].every((entry) => TIME.test(String(entry))) || SENSITIVE.test(JSON.stringify(value))) fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  for (const key of ["success", "captureProvenancePassed", "authProvenancePassed", "attestationFreshnessPassed", "childStarted"]) if (typeof value[key] !== "boolean") fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  for (const key of ["minimumRequiredValidityMs", "remainingValidityMs", "childExitCode", "plannedMutationCount", "actualMutationCount", "supabaseWriteCount", "productionMutationCount", "retryCount"]) if (!Number.isInteger(value[key])) fail("R6_V3_DRY_RUN_TERMINAL_SCHEMA_INVALID");
  if (value.actualMutationCount !== 0 || value.supabaseWriteCount !== 0 || value.productionMutationCount !== 0 || value.retryCount !== 0 || value.plannedMutationCount !== 2) fail("R6_V3_DRY_RUN_TERMINAL_SAFETY_INVALID");
  if (value.success) {
    if (value.outerClassification !== "R6_CURRENT_CANONICAL_V3_DRY_RUN_ONLY_READY" || value.innerClassification !== null || value.failureStage !== "complete" || !value.captureProvenancePassed || !value.authProvenancePassed || !value.attestationFreshnessPassed || !value.childStarted || value.childExitCode !== 0 || value.remainingValidityMs < value.minimumRequiredValidityMs) fail("R6_V3_DRY_RUN_TERMINAL_SUCCESS_CONTRADICTION");
  } else if (!/^R6_CURRENT_CANONICAL_V3_(?:DRY_RUN|ORCHESTRATION)_[A-Z0-9_]+$/.test(String(value.outerClassification)) || typeof value.innerClassification !== "string" || !value.innerClassification || typeof value.failureStage !== "string" || !value.failureStage) {
    fail("R6_V3_DRY_RUN_TERMINAL_FAILURE_CONTRADICTION");
  }
  return Object.freeze({ classification: value.outerClassification });
}

if (process.argv[1] && fileURLToPath(import.meta.url).replaceAll("\\", "/") === process.argv[1].replaceAll("\\", "/")) {
  try { validateR6V3DryRunTerminal(JSON.parse(await readFile(process.argv[2], "utf8"))); process.stdout.write("R6_V3_DRY_RUN_TERMINAL_OK\n"); }
  catch (error) { process.stderr.write(`${error?.code ?? "R6_V3_DRY_RUN_TERMINAL_INVALID"}\n`); process.exitCode = 1; }
}
