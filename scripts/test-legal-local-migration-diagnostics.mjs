import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLegalLocalDockerAdapter } from "./lib/legal-local-docker-adapter.mjs";
import { LOCAL_MIGRATION_PSQL_FLAGS, parsePostgresDiagnostic, redactMigrationDiagnosticText, validateMigrationAttemptDiagnostic } from "./lib/legal-local-migration-diagnostics.mjs";
import { sha256 } from "./lib/legal-local-replay-evidence.mjs";

const implementationCommit = "9b489d37183fa9b172933ae32fe9d57432b995d2";
const fixture = (state, message) => `psql:<stdin>:1: ERROR:  ${state}: ${message}\nLINE 1: select * from missing_table;\nDETAIL:  synthetic detail\nHINT:  synthetic hint\nCONTEXT:  synthetic context\n`;
for (const [state, message] of [["42P01", "relation does not exist"], ["42703", "column does not exist"], ["42601", "syntax error"], ["23505", "duplicate key value violates unique constraint"], ["42501", "permission denied"]]) {
  const parsed = parsePostgresDiagnostic(fixture(state, message));
  assert.equal(parsed.sqlState, state); assert.equal(parsed.primaryMessage, message); assert.equal(parsed.errorLine, "1"); assert.equal(parsed.statementExcerpt, "select * from missing_table;");
}
const jwtFixture = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJxMTIzNDU2Nzg5MCJ9.c2lnbmF0dXJlLWxvbmctaGFzaC12YWx1ZQ";
const secretFixture = `postgresql://user:password@host/db password=example-secret Bearer example-token ${jwtFixture} https://abc.supabase.co`;
const redacted = redactMigrationDiagnosticText(secretFixture);
for (const secret of ["password@host", "example-secret", "example-token", jwtFixture, "abc.supabase.co"]) assert.equal(redacted.includes(secret), false);
assert.equal(redacted.includes("[REDACTED_POSTGRES_URL]"), true);

const root = await mkdtemp(path.join(os.tmpdir(), "r6-local-diagnostic-unit-"));
try {
  const migrationDir = path.join(root, "supabase", "migrations"); await mkdir(migrationDir, { recursive: true });
  const sql = "select 1;"; await writeFile(path.join(migrationDir, "synthetic.sql"), sql, "utf8");
  const calls = [];
  const adapter = createLegalLocalDockerAdapter({ repositoryRoot: root, spawnSyncImpl(command, args, options) { calls.push({ command, args, options }); return { status: 3, signal: null, stdout: "out", stderr: fixture("42P01", "relation does not exist") }; } });
  const result = await adapter.applyMigration({ task: { container: "synthetic" }, migration: { filename: "synthetic.sql" } });
  assert.equal(result.success, false); assert.equal(result.exitCode, 3); assert.equal(result.stdinSha256, sha256(sql)); assert.equal(result.spawnError, null); assert.deepEqual(result.psqlFlags, LOCAL_MIGRATION_PSQL_FLAGS); assert.equal(result.stderr.includes("42P01"), true); assert.equal(calls[0].options.maxBuffer >= 4 * 1024 * 1024, true);
  const spawnFailure = createLegalLocalDockerAdapter({ repositoryRoot: root, spawnSyncImpl() { return { status: null, signal: null, stdout: "", stderr: "", error: Object.assign(new Error("spawn"), { code: "ENOENT" }) }; } });
  const spawnResult = await spawnFailure.applyMigration({ task: { container: "synthetic" }, migration: { filename: "synthetic.sql" } });
  assert.equal(spawnResult.executionClassification, "R6_LOCAL_MIGRATION_FAILURE_SPAWN_ERROR"); assert.equal(spawnResult.spawnError.code, "ENOENT");
  const evidenceRoot = path.join(root, "evidence");
  const validAttempt = { sequence: 1, identity: "20260703", filename: "synthetic.sql", canonicalSha256: sha256(sql), dependencies: [], expectedEffects: [], taskId: "r6-local-predeployment-11111111-2222-4333-8444-555555555555", implementationCommit, inventorySha256: "a".repeat(64), migrationIdentity: "20260703", migrationFilename: "synthetic.sql", migrationSha256: sha256(sql), attempt: 1, stdinSha256: sha256(sql), psqlFlags: LOCAL_MIGRATION_PSQL_FLAGS, exitCode: 3, signal: null, spawnError: null, startedAt: "2026-08-06T00:00:00.000Z", completedAt: "2026-08-06T00:00:01.000Z", durationMs: 1, stdoutArtifact: { path: path.join(evidenceRoot, "migration-attempt-1-stdout.log"), sha256: sha256(""), bytes: 0 }, stderrArtifact: { path: path.join(evidenceRoot, "migration-attempt-1-stderr.log"), sha256: sha256(fixture("42P01", "relation does not exist")), bytes: 1 }, diagnostic: parsePostgresDiagnostic(fixture("42P01", "relation does not exist")), retryCount: 0, automaticRollback: false, beforeFingerprint: {}, afterFingerprint: {}, transactionResult: "FAILED", historyEntryResult: "ABSENT", classification: "FAILED", diagnosticCaptureStatus: "R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_CAPTURE_READY" };
  validateMigrationAttemptDiagnostic(validAttempt, { taskId: validAttempt.taskId, implementationCommit, inventorySha256: validAttempt.inventorySha256, evidenceRoot });
  await assert.rejects(async () => validateMigrationAttemptDiagnostic({ ...validAttempt, unknown: true }, { taskId: validAttempt.taskId, implementationCommit, inventorySha256: validAttempt.inventorySha256, evidenceRoot }), (error) => error.code === "R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_WRITE_FAILED");
  await assert.rejects(async () => validateMigrationAttemptDiagnostic({ ...validAttempt, stderrArtifact: { ...validAttempt.stderrArtifact, path: path.join(root, "escape.log") } }, { taskId: validAttempt.taskId, implementationCommit, inventorySha256: validAttempt.inventorySha256, evidenceRoot }), (error) => error.code === "R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_WRITE_FAILED");
  await assert.rejects(async () => validateMigrationAttemptDiagnostic({ ...validAttempt, taskId: "r6-local-predeployment-11111111-2222-4333-8444-555555555556" }, { taskId: validAttempt.taskId, implementationCommit, inventorySha256: validAttempt.inventorySha256, evidenceRoot }), (error) => error.code === "R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_WRITE_FAILED");
  console.log(JSON.stringify({ classification: "R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_UNIT_TESTS_READY", parserFixtures: 5, redactionFixtures: 5, realOperations: 0 }));
} finally { await rm(root, { recursive: true, force: true }); }
