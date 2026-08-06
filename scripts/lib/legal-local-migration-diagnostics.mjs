import { createHash } from "node:crypto";
import path from "node:path";

const PSQL_STATE = /\b(?:ERROR|FATAL|PANIC):\s+([0-9A-Z]{5}):\s*(.+)/m;
const PSQL_LINE = /psql:<stdin>:(\d+):\s+(?:ERROR|FATAL|PANIC):/m;
const DETAIL = /^DETAIL:\s*(.+)$/m;
const HINT = /^HINT:\s*(.+)$/m;
const CONTEXT = /^CONTEXT:\s*(.+)$/m;
const STATEMENT = /^LINE\s+\d+:\s*(.+)$/m;

export const LOCAL_MIGRATION_PSQL_FLAGS = Object.freeze([
  "-X",
  "-v", "ON_ERROR_STOP=1",
  "--set=VERBOSITY=verbose",
  "--set=SHOW_CONTEXT=always",
  "--echo-errors",
  "-U", "postgres",
  "-d", "postgres",
  "-f", "-",
]);

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const HASH = /^[a-f0-9]{64}$/;
const ATTEMPT_KEYS = new Set(["sequence", "identity", "filename", "canonicalSha256", "dependencies", "expectedEffects", "taskId", "implementationCommit", "inventorySha256", "migrationIdentity", "migrationFilename", "migrationSha256", "attempt", "stdinSha256", "psqlFlags", "exitCode", "signal", "spawnError", "startedAt", "completedAt", "durationMs", "stdoutArtifact", "stderrArtifact", "diagnostic", "retryCount", "automaticRollback", "beforeFingerprint", "afterFingerprint", "transactionResult", "historyEntryResult", "classification", "diagnosticCaptureStatus"]);
const DIAGNOSTIC_KEYS = new Set(["diagnosticCaptureStatus", "sqlState", "severity", "primaryMessage", "detail", "hint", "context", "errorLine", "statementExcerpt", "statementExcerptSha256"]);

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const hasOnlyKeys = (value, keys) => value && Object.keys(value).every((key) => keys.has(key));

export function validateMigrationAttemptDiagnostic(attempt, { taskId, implementationCommit, inventorySha256, evidenceRoot }) {
  if (!attempt || !hasOnlyKeys(attempt, ATTEMPT_KEYS) || attempt.taskId !== taskId || attempt.implementationCommit !== implementationCommit || attempt.inventorySha256 !== inventorySha256 || !HASH.test(String(attempt.migrationSha256 ?? "")) || !HASH.test(String(attempt.stdinSha256 ?? ""))) fail("R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_WRITE_FAILED");
  const root = path.resolve(evidenceRoot);
  for (const artifact of [attempt.stdoutArtifact, attempt.stderrArtifact]) {
    if (!artifact || !HASH.test(String(artifact.sha256 ?? "")) || path.dirname(path.resolve(artifact.path ?? "")) !== root) fail("R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_WRITE_FAILED");
  }
  if (attempt.diagnostic !== null) {
    if (!hasOnlyKeys(attempt.diagnostic, DIAGNOSTIC_KEYS) || !["R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_CAPTURE_READY", "R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_PARTIAL"].includes(attempt.diagnostic.diagnosticCaptureStatus)) fail("R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_WRITE_FAILED");
    if (attempt.diagnostic.statementExcerpt !== null && attempt.diagnostic.statementExcerptSha256 !== sha256(attempt.diagnostic.statementExcerpt)) fail("R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_WRITE_FAILED");
  }
  return Object.freeze(attempt);
}

export function redactMigrationDiagnosticText(value) {
  if (typeof value !== "string") throw Object.assign(new Error("R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_REDACTION_FAILED"), { code: "R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_REDACTION_FAILED" });
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "[REDACTED_POSTGRES_URL]")
    .replace(/\bpassword\s*[=:]\s*[^\s'";]+/gi, "password=[REDACTED]")
    .replace(/\b(?:authorization)\s*:\s*[^\r\n]+/gi, "Authorization: [REDACTED]")
    .replace(/\bbearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]")
    .replace(/\b(?:service[_-]?role|anon)[_-]?(?:key|token)\s*[=:]\s*[^\s'";]+/gi, "credential=[REDACTED]")
    .replace(/https:\/\/[a-z0-9-]+\.supabase\.co/gi, "[REDACTED_SUPABASE_URL]");
}

const valueFor = (expression, text) => expression.exec(text)?.[1] ?? null;

export function parsePostgresDiagnostic(stderr) {
  const text = String(stderr ?? "");
  const match = PSQL_STATE.exec(text);
  const sqlState = match?.[1] ?? null;
  const primaryMessage = match?.[2] ?? null;
  const statementExcerpt = valueFor(STATEMENT, text);
  return Object.freeze({
    diagnosticCaptureStatus: sqlState && primaryMessage ? "R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_CAPTURE_READY" : "R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_PARTIAL",
    sqlState,
    severity: match ? "ERROR" : null,
    primaryMessage,
    detail: valueFor(DETAIL, text),
    hint: valueFor(HINT, text),
    context: valueFor(CONTEXT, text),
    errorLine: valueFor(PSQL_LINE, text),
    statementExcerpt,
    statementExcerptSha256: statementExcerpt === null ? null : sha256(statementExcerpt),
  });
}
