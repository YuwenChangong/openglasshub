import { readFile } from "node:fs/promises";

const STAGES = new Set([
  "LAUNCHER_ENTRY", "ASSERT_PACKAGE_BINDINGS", "ASSERT_SINGLE_USE_PATHS",
  "ASSERT_INTERACTIVE_HOST", "READ_CONFIRMATION", "READ_CLOUDFLARE_ACCOUNT",
  "READ_SUPABASE_PROJECT_REF", "READ_SUPABASE_PUBLIC_KEY", "READ_QA_EMAIL",
  "READ_QA_PASSWORD", "READ_DRYRUN_TOKEN", "READ_TARGET_SLUG",
  "CONSTRUCT_STDIN_PAYLOAD", "INVOKE_WRAPPER_INLINE", "WAIT_WRAPPER_COMPLETION",
  "VALIDATE_WRAPPER_RESULT", "COMPLETE"
]);
const CODES = /^(R6_OPERATOR_LAUNCH_[A-Z0-9_]+|R6_CURRENT_CANONICAL(?:_PRODUCTION)?_V3_[A-Z0-9_]+|R6_DETACHED_SECURE_WRAPPER_[A-Z0-9_]+|QA_CANARY_[A-Z0-9_]+)$/;
const ERROR_CLASSES = new Set(["input", "host", "secure_input", "binding", "wrapper", "unexpected"]);
const WRAPPER_STAGES = new Set(["POST_ENTRY_INITIALIZATION", "MODE_RESOLUTION", "FIXED_BINDING_VALIDATION", "GIT_EXECUTABLE_RESOLUTION", "DETACHED_WORKTREE_VALIDATION", "BLOB_AND_RAW_HASH_VALIDATION", "EVIDENCE_ROOT_VALIDATION", "SECRET_ENVIRONMENT_GUARD", "CAPTURE_COMMAND_PREPARATION", "CAPTURE_INVOCATION", "AUTHCHECK_PREPARATION", "TARGET_RESOLUTION", "RECEIPT_PREPARATION", "DRYRUN_PREPARATION"]);
const PATH_CLASSES = new Set(["WRAPPER", "REPOSITORY_SCRIPT", "EXTERNAL_TOOL", "UNKNOWN"]);
const INVOCATION_CLASSES = new Set(["POWERSHELL_FUNCTION", "EXTERNAL_APPLICATION", "CALL_OPERATOR", "NATIVE_COMMAND", "UNKNOWN"]);

export function validateOperatorLaunchTerminal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("R6_OPERATOR_LAUNCH_TERMINAL_SCHEMA_INVALID");
  for (const key of ["schemaVersion", "success", "classification", "currentStage", "lastCompletedStage", "failureStage", "failureCategory", "errorClass", "launcherSha256", "manifestSha256", "runId", "wrapperInvocationStarted", "wrapperEntryConfirmed", "inputCollectionStarted", "inputCollectionCompleted", "stdinPayloadConstructed", "stdinPayloadDelivered", "createdAt"]) if (!(key in value)) throw new Error("R6_OPERATOR_LAUNCH_TERMINAL_FIELD_MISSING");
  if (value.schemaVersion !== "r6-v3-operator-launch-terminal-result-v1" || typeof value.success !== "boolean" || typeof value.classification !== "string" || !CODES.test(value.classification)) throw new Error("R6_OPERATOR_LAUNCH_TERMINAL_SCHEMA_INVALID");
  for (const key of ["currentStage", "lastCompletedStage"]) if (!STAGES.has(value[key])) throw new Error("R6_OPERATOR_LAUNCH_TERMINAL_STAGE_INVALID");
  if (value.failureStage !== null && !STAGES.has(value.failureStage)) throw new Error("R6_OPERATOR_LAUNCH_TERMINAL_STAGE_INVALID");
  if (value.failureCategory !== null && value.failureCategory !== "pre_wrapper_or_wrapper_failure") throw new Error("R6_OPERATOR_LAUNCH_TERMINAL_SCHEMA_INVALID");
  if (value.errorClass !== null && !ERROR_CLASSES.has(value.errorClass)) throw new Error("R6_OPERATOR_LAUNCH_TERMINAL_SCHEMA_INVALID");
  for (const key of ["launcherSha256", "manifestSha256"]) if (!/^[a-f0-9]{64}$/.test(value[key])) throw new Error("R6_OPERATOR_LAUNCH_TERMINAL_HASH_INVALID");
  if (!/^qa-canary-[0-9a-f-]{36}$/.test(value.runId)) throw new Error("R6_OPERATOR_LAUNCH_TERMINAL_RUN_ID_INVALID");
  for (const key of ["wrapperInvocationStarted", "wrapperEntryConfirmed", "inputCollectionStarted", "inputCollectionCompleted", "stdinPayloadConstructed", "stdinPayloadDelivered"]) if (typeof value[key] !== "boolean") throw new Error("R6_OPERATOR_LAUNCH_TERMINAL_SCHEMA_INVALID");
  const diagnosticKeys = ["wrapperStage", "wrapperInnerClassification", "wrapperExceptionType", "wrapperFullyQualifiedErrorId", "wrapperCategory", "wrapperScriptPathClass", "wrapperLine", "wrapperColumn", "wrapperInvocationNameClass"];
  const diagnosticPresent = diagnosticKeys.some((key) => key in value);
  if (diagnosticPresent) {
    if (!value.wrapperEntryConfirmed || value.success || value.errorClass !== "wrapper" || !diagnosticKeys.every((key) => key in value)) throw new Error("R6_OPERATOR_LAUNCH_TERMINAL_WRAPPER_DIAGNOSTIC_INVALID");
    if (!WRAPPER_STAGES.has(value.wrapperStage) || !CODES.test(value.wrapperInnerClassification)) throw new Error("R6_OPERATOR_LAUNCH_TERMINAL_WRAPPER_DIAGNOSTIC_INVALID");
    for (const key of ["wrapperExceptionType", "wrapperFullyQualifiedErrorId", "wrapperCategory"]) if (typeof value[key] !== "string" || !/^[A-Za-z0-9_.+:-]{1,160}$/.test(value[key])) throw new Error("R6_OPERATOR_LAUNCH_TERMINAL_WRAPPER_DIAGNOSTIC_INVALID");
    if (!PATH_CLASSES.has(value.wrapperScriptPathClass) || !INVOCATION_CLASSES.has(value.wrapperInvocationNameClass) || !Number.isInteger(value.wrapperLine) || !Number.isInteger(value.wrapperColumn) || value.wrapperLine < 0 || value.wrapperColumn < 0 || value.wrapperLine > 1000000 || value.wrapperColumn > 1000000) throw new Error("R6_OPERATOR_LAUNCH_TERMINAL_WRAPPER_DIAGNOSTIC_INVALID");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt)) throw new Error("R6_OPERATOR_LAUNCH_TERMINAL_TIMESTAMP_INVALID");
  for (const key of Object.keys(value)) if (/(password|token|secret|authorization|anon|account.?id|email|slug|project.?ref)/i.test(key)) throw new Error("R6_OPERATOR_LAUNCH_TERMINAL_SECRET_FIELD_REJECTED");
  return value;
}

if (import.meta.url === `file:///${process.argv[1].replaceAll("\\", "/")}`) {
  const [file] = process.argv.slice(2);
  try { validateOperatorLaunchTerminal(JSON.parse(await readFile(file, "utf8"))); process.stdout.write("R6_OPERATOR_LAUNCH_TERMINAL_OK\n"); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
