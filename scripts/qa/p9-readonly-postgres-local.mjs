import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertOwnedRuntimeRoot, cleanupOwnedRoot, initializeRuntimeConfig } from "./p6b-local-e2e-runner.mjs";
import { createMirror, validateMirror } from "./local-supabase-migration-mirror.mjs";
import { parseP9Connection, runP9ReadOnlyCapture } from "./p9-readonly-postgres-transport.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PSQL = process.platform === "win32" ? "psql.exe" : "psql";
const CLI = "supabase@2.115.0";
const SUPABASE_EXECUTABLE = process.platform === "win32" ? join(ROOT, "node_modules", "@supabase", "cli-windows-x64", "bin", "supabase.exe") : "npx";
const EVIDENCE_ROOT = join(tmpdir(), "openglass-hub-p9-evidence");
const supabaseArgs = (action, args = []) => process.platform === "win32" ? [action, ...args] : [CLI, action, ...args];

function command(executable, args, { cwd = ROOT, env = process.env, input } = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: process.platform === "win32" && /\.cmd$/i.test(executable), stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] }); let stdout = ""; let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", () => reject(new Error("P9_LOCAL_PROCESS_FAILURE")));
    child.on("close", (exitCode) => { if (exitCode === 0) return resolveCommand({ stdout, stderr, exitCode }); const error = new Error("P9_LOCAL_PROCESS_FAILURE"); error.safeDetail = `${stdout}\n${stderr}`; reject(error); });
    if (input !== undefined) child.stdin.end(input);
  });
}

function portFree(port) { return new Promise((resolvePort) => { const socket = createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolvePort(false); }); socket.once("error", () => resolvePort(true)); }); }
async function choosePorts() {
  const offsets = { api: 1, db: 2, shadow: 0, studio: 3, smtp: 4, analytics: 7, pooler: 9, inspector: 83 };
  for (const base of [56800, 56900, 57000, 57100]) { const free = await Promise.all(Object.values(offsets).map((offset) => portFree(base + offset))); if (free.every(Boolean)) return Object.fromEntries(Object.entries(offsets).map(([name, offset]) => [name, base + offset])); }
  throw new Error("P9_LOCAL_PORT_BUNDLE_UNAVAILABLE");
}
function safeError(error) { return String(error?.safeDetail || error?.message || "P9_LOCAL_FAILURE").replace(/postgres(?:ql)?:\/\/[^\s]+/ig, "[REDACTED]").replace(/(?:password|token|secret|anon key|service.role key|jwt secret)\s*[=:]\s*[^\s,;]+/ig, "[REDACTED]").slice(0, 800); }

export function validateP9LocalEvidence(evidence) {
  const complete = evidence?.acceptanceResult === "PASS" && evidence?.psqlProcessCount === 1 && evidence?.psqlProcessExited === true && evidence?.connectionClosed === true && evidence?.transactionReadOnlyValue === "on" && evidence?.backendSessionCorrelation === true && evidence?.queriesExpected === 4 && evidence?.queriesExecuted === 4 && evidence?.queriesCaptured === 4 && evidence?.queriesMissing === 0 && evidence?.rollbackMode === "EXPLICIT_ROLLBACK" && evidence?.productionConnections === 0 && evidence?.productionSqlRequests === 0 && evidence?.productionMutationCount === 0 && evidence?.localWriteRejection === "PASS" && evidence?.cleanup === "PASS";
  if (!complete) throw new Error("P9_LOCAL_EVIDENCE_GATE_FAILED");
  return "PASS";
}

export async function runP9LocalReadOnlyTransport() {
  const runId = randomUUID().slice(0, 8); const runtime = await mkdtemp(join(tmpdir(), `openglass-p9-${runId}-`)); const repoSupabase = join(ROOT, "supabase"); const ports = await choosePorts(); let started = false; let localDsn; let capture; let writeProbe; let cleanup = "BLOCKED"; let stage = "INITIALIZED";
  const evidence = { runId, mode: "LOCAL_TEST", productionConnections: 0, productionSqlRequests: 0, productionMutationCount: 0, productionDDLCount: 0, productionDMLCount: 0, productionDeployments: 0 };
  try {
    assertOwnedRuntimeRoot({ root: runtime, repoSupabase });
    stage = "SUPABASE_INIT"; await initializeRuntimeConfig({ root: runtime, repoSupabase, runId, ports, exec: (action, options) => command(SUPABASE_EXECUTABLE, supabaseArgs(action, [...options.args, "--workdir", options.workdir])) });
    stage = "MIGRATION_MIRROR"; const manifest = await createMirror({ sourceDirectory: join(repoSupabase, "migrations"), destinationDirectory: join(runtime, "supabase", "migrations") }); const mirror = await validateMirror({ sourceDirectory: join(repoSupabase, "migrations"), destinationDirectory: join(runtime, "supabase", "migrations"), manifest }); if (mirror.fileCountMismatch || mirror.duplicateGroups.length || mirror.sqlByteParityFailures || mirror.orderPositionMismatches) throw new Error("P9_LOCAL_MIGRATION_MIRROR_INVALID");
    stage = "SUPABASE_START"; await command(SUPABASE_EXECUTABLE, supabaseArgs("start", ["--workdir", runtime])); started = true;
    stage = "SUPABASE_STATUS"; const status = JSON.parse((await command(SUPABASE_EXECUTABLE, supabaseArgs("status", ["--output", "json", "--workdir", runtime]))).stdout);
    localDsn = status.DB_URL;
    const packet = await readFile(join(ROOT, "docs", "ops", "p8-production-history-read-only.sql"), "utf8");
    stage = "READ_ONLY_CAPTURE"; capture = await runP9ReadOnlyCapture({ mode: "LOCAL_TEST", dsn: localDsn, packet, psqlPath: PSQL });
    const connection = parseP9Connection({ mode: "LOCAL_TEST", dsn: localDsn });
    stage = "WRITE_PROBE_SETUP"; await command(PSQL, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", "CREATE TABLE p9_local_readonly_probe (id integer PRIMARY KEY);"], { env: { ...process.env, ...connection.pgEnv } });
    stage = "WRITE_PROBE"; writeProbe = await runP9ReadOnlyCapture({ mode: "LOCAL_TEST", dsn: localDsn, packet, psqlPath: PSQL, testOnlyWriteProbeSql: "INSERT INTO p9_local_readonly_probe (id) VALUES (1);" });
    stage = "WRITE_PROBE_CLEANUP"; await command(PSQL, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", "DROP TABLE p9_local_readonly_probe;"], { env: { ...process.env, ...connection.pgEnv } });
    evidence.localWriteRejection = writeProbe.localWriteRejection;
    Object.assign(evidence, capture);
  } catch (error) { evidence.acceptanceResult = "BLOCKED"; evidence.failureStage = stage; evidence.failureClassification = safeError(error); }
  finally {
    try { if (started) await command(SUPABASE_EXECUTABLE, supabaseArgs("stop", ["--no-backup", "--workdir", runtime])); await cleanupOwnedRoot({ root: runtime, repoSupabase }); cleanup = "PASS"; } catch { cleanup = "BLOCKED"; }
    evidence.cleanup = cleanup;
  }
  try { validateP9LocalEvidence(evidence); evidence.localEvidenceGate = "PASS"; } catch (error) { evidence.localEvidenceGate = "BLOCKED"; evidence.failureClassification ??= safeError(error); }
  const evidenceDirectory = join(EVIDENCE_ROOT, runId); await mkdir(evidenceDirectory, { recursive: true }); await writeFile(join(evidenceDirectory, "terminal.json"), `${JSON.stringify(evidence)}\n`, "utf8");
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const evidence = await runP9LocalReadOnlyTransport();
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.localEvidenceGate !== "PASS") process.exitCode = 1;
}
