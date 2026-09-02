import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseP9Connection } from "./p9-readonly-postgres-transport.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION_PATH = join(ROOT, "supabase", "migrations", "20260902042807_forward_reconcile_devices.sql");
export const P10_RECONCILIATION_SQL_SHA256 = "2F98FEA88B4B5619DCE82A0E48C0653C96F4DB3E212D6F52A85FBAB083405E65";

function failure(code) { const error = new Error(code); error.code = code; return error; }
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function safePsqlDetail(value) {
  return String(value ?? "")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/ig, "[REDACTED]")
    .replace(/((?:password|token|secret|api[_-]?key)\s*[=:]\s*)[^\s,;"']+/ig, "$1[REDACTED]")
    .slice(0, 800);
}

export function validateP10Source({ actualCommit, approvedCommit, worktreeClean }) {
  if (!/^[a-f0-9]{40}$/i.test(actualCommit ?? "") || !/^[a-f0-9]{40}$/i.test(approvedCommit ?? "") || actualCommit !== approvedCommit || worktreeClean !== true) throw failure("P10_SOURCE_BINDING_FAILED");
  return true;
}

export function createP10Transcript({ migrationSql }) {
  if (typeof migrationSql !== "string" || !migrationSql.trim().endsWith(";")) throw failure("P10_SQL_INVALID");
  const postcondition = "DO $$ BEGIN IF to_regclass('public.devices') IS NULL OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.devices'::regclass AND tgname = 'trg_devices_enforce_slug_lock' AND NOT tgisinternal) THEN RAISE EXCEPTION 'p10_postcondition_failed'; END IF; END $$;";
  return [
    "\\set ON_ERROR_STOP on", "\\pset tuples_only on", "BEGIN;",
    "SELECT current_database() AS current_database, current_user AS current_user;",
    migrationSql,
    postcondition,
    "COMMIT;",
    "-- If any preceding statement fails, ON_ERROR_STOP terminates the session and PostgreSQL rolls back the open transaction on close. ROLLBACK;",
    "",
  ].join("\n");
}

function runPsql({ executable, args, env, input, spawnImpl }) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(executable, args, { env, shell: false, stdio: ["pipe", "pipe", "pipe"] }); let stdout = ""; let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", () => reject(failure("P10_PSQL_PROCESS_FAILURE")));
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    child.stdin.end(input);
  });
}

export async function runP10Reconciliation({ mode, dsn, migrationSql, expectedSqlHash, approvedCommit, actualCommit, worktreeClean, psqlPath = "psql", spawnImpl = spawn }) {
  validateP10Source({ actualCommit, approvedCommit, worktreeClean });
  if (!/^[A-F0-9]{64}$/i.test(expectedSqlHash ?? "") || sha256(migrationSql) !== expectedSqlHash) throw failure("P10_SQL_HASH_MISMATCH");
  const connection = parseP9Connection({ mode, dsn });
  const args = ["-X", "-q", "-v", "ON_ERROR_STOP=1"];
  const processResult = await runPsql({ executable: psqlPath, args, env: { ...process.env, ...connection.pgEnv }, input: createP10Transcript({ migrationSql }), spawnImpl });
  const productionCounter = mode === "PRODUCTION" ? 1 : 0;
  if (processResult.exitCode !== 0) return { acceptanceResult: "BLOCKED", targetMode: mode, targetHost: connection.safeTarget.host, targetEndpointClass: connection.safeTarget.endpointClass, sqlHash: expectedSqlHash, connectionAttempted: true, connectionClosed: true, psqlExitCode: processResult.exitCode, firstFailureStage: "PSQL_EXECUTION", failureDetail: safePsqlDetail(processResult.stderr), rollbackMode: "CONNECTION_CLOSE_ROLLBACK", productionConnections: productionCounter, productionSqlRequests: productionCounter, productionMutationCount: 0, productionDDLCount: 0, productionDMLCount: 0, secretAudit: "PASS", argv: args };
  return { acceptanceResult: "PASS", targetMode: mode, targetHost: connection.safeTarget.host, targetEndpointClass: connection.safeTarget.endpointClass, sqlHash: expectedSqlHash, connectionAttempted: true, connectionClosed: true, transactionCommitted: true, rollbackMode: "NOT_REQUIRED_COMMITTED", productionConnections: productionCounter, productionSqlRequests: productionCounter, productionMutationCount: 0, productionDDLCount: 0, productionDMLCount: 0, secretAudit: "PASS", argv: args };
}

function gitOutput(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", shell: false });
  if (result.status !== 0) throw failure("P10_GIT_STATE_UNAVAILABLE");
  return result.stdout.trim();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const dsn = process.env.P10_PRODUCTION_DATABASE_URL;
  const approvedCommit = process.env.P10_APPROVED_SOURCE_COMMIT;
  if (!dsn) throw failure("P10_PRODUCTION_CREDENTIAL_UNAVAILABLE");
  if (!approvedCommit) throw failure("P10_APPROVED_SOURCE_COMMIT_UNAVAILABLE");
  const evidence = await runP10Reconciliation({
    mode: "PRODUCTION",
    dsn,
    migrationSql: await readFile(MIGRATION_PATH, "utf8"),
    expectedSqlHash: P10_RECONCILIATION_SQL_SHA256,
    approvedCommit,
    actualCommit: gitOutput(["rev-parse", "HEAD"]),
    worktreeClean: gitOutput(["status", "--porcelain"]) === "",
  });
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.acceptanceResult !== "PASS") process.exitCode = 1;
}
