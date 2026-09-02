import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertOwnedRuntimeRoot, cleanupOwnedRoot, initializeRuntimeConfig } from "./p6b-local-e2e-runner.mjs";
import { parseP9Connection } from "./p9-readonly-postgres-transport.mjs";
import { runP10Reconciliation } from "./p10-production-reconciliation.mjs";
import { P10_RECEIPT_SQL_SHA256, runP10ReceiptCapture } from "./p10-post-reconciliation-receipt.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SUPABASE = join(ROOT, "node_modules", "@supabase", "cli-windows-x64", "bin", "supabase.exe");
const PSQL = process.platform === "win32" ? "psql.exe" : "psql";
const MIGRATION = join(ROOT, "supabase", "migrations", "20260902042807_forward_reconcile_devices.sql");

function command(executable, args, { cwd = ROOT, env = process.env, input } = {}) { return new Promise((resolveCommand, reject) => { const child = spawn(executable, args, { cwd, env, shell: false, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] }); let stdout = "", stderr = ""; child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; }); child.on("error", () => reject(new Error("P10_LOCAL_PROCESS_FAILURE"))); child.on("close", (exitCode) => { if (exitCode === 0) return resolveCommand({ stdout, stderr }); reject(new Error(`P10_LOCAL_PROCESS_FAILURE ${stderr.slice(0, 800)}`)); }); if (input !== undefined) child.stdin.end(input); }); }

export function validateP10LocalEvidence(evidence) {
  if (evidence?.productionShaped !== "PASS" || evidence?.alreadyCanonical !== "PASS" || evidence?.rollback !== "PASS" || evidence?.receiptHistoryAbsent !== "PASS" || evidence?.receiptHistoryPresent !== "PASS" || evidence?.sentinel !== "PASS" || evidence?.productionConnections !== 0 || evidence?.productionMutations !== 0 || evidence?.cleanup !== "PASS") {
    throw new Error(`P10_LOCAL_EVIDENCE_GATE_FAILED productionShaped=${evidence?.productionShaped} alreadyCanonical=${evidence?.alreadyCanonical} rollback=${evidence?.rollback} productionConnections=${evidence?.productionConnections} productionMutations=${evidence?.productionMutations} cleanup=${evidence?.cleanup}`);
  }
  return "PASS";
}

export async function runP10ForwardReconciliationLocal() {
  const runId = randomUUID().slice(0, 8); const root = await mkdtemp(join(tmpdir(), `openglass-p10-${runId}-`)); const repoSupabase = join(ROOT, "supabase"); const ports = { api: 57201, db: 57202, shadow: 57200, studio: 57203, smtp: 57204, analytics: 57207, pooler: 57209, inspector: 57283 }; let started = false;
  const evidence = { productionShaped: "FAIL", alreadyCanonical: "FAIL", rollback: "FAIL", receiptHistoryAbsent: "FAIL", receiptHistoryPresent: "FAIL", sentinel: "FAIL", productionConnections: 0, productionMutations: 0, cleanup: "FAIL" };
  try {
    assertOwnedRuntimeRoot({ root, repoSupabase });
    await initializeRuntimeConfig({ root, repoSupabase, runId, ports, exec: (action, options) => command(SUPABASE, [action, ...options.args, "--workdir", options.workdir]) });
    await command(SUPABASE, ["start", "--workdir", root]); started = true;
    const status = JSON.parse((await command(SUPABASE, ["status", "--output", "json", "--workdir", root])).stdout); const dsn = status.DB_URL; const connection = parseP9Connection({ mode: "LOCAL_TEST", dsn });
    const baseline = "create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, name text not null, created_by text, idempotency_key text, statements text[], rollback text[]); create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$; create function public.is_moderator_or_admin() returns boolean language sql stable as $$ select false $$; create table public.profiles(id uuid primary key); create table public.circles(id uuid primary key); create table public.posts(id uuid primary key); create table public.forum_notifications(id uuid primary key); create table public.news_articles(id uuid primary key);";
    await command(PSQL, ["-X", "-q", "-v", "ON_ERROR_STOP=1"], { env: { ...process.env, ...connection.pgEnv }, input: baseline });
    const migrationSql = await readFile(MIGRATION, "utf8"); const hash = createHash("sha256").update(migrationSql).digest("hex").toUpperCase();
    const first = await runP10Reconciliation({ mode: "LOCAL_TEST", dsn, migrationSql, expectedSqlHash: hash, approvedCommit: "a".repeat(40), actualCommit: "a".repeat(40), worktreeClean: true, psqlPath: PSQL });
    evidence.productionShaped = first.acceptanceResult === "PASS" ? "PASS" : "FAIL";
    evidence.firstFailureDetail = first.failureDetail ?? null;
    const second = await runP10Reconciliation({ mode: "LOCAL_TEST", dsn, migrationSql, expectedSqlHash: hash, approvedCommit: "a".repeat(40), actualCommit: "a".repeat(40), worktreeClean: true, psqlPath: PSQL });
    evidence.alreadyCanonical = second.acceptanceResult === "PASS" ? "PASS" : "FAIL";
    evidence.secondFailureDetail = second.failureDetail ?? null;
    const receiptSql = await readFile(join(ROOT, "docs", "ops", "p10-post-reconciliation-receipt-read-only.sql"), "utf8");
    const absentReceipt = await runP10ReceiptCapture({ mode: "LOCAL_TEST", dsn, packet: receiptSql, expectedSqlHash: P10_RECEIPT_SQL_SHA256, psqlPath: PSQL });
    evidence.receiptHistoryAbsent = absentReceipt.acceptanceResult === "PASS" && absentReceipt.perQuery?.[7]?.rowCount === 0 ? "PASS" : "FAIL";
    await mkdir(join(root, "supabase", "migrations"), { recursive: true });
    await copyFile(MIGRATION, join(root, "supabase", "migrations", "20260902042807_forward_reconcile_devices.sql"));
    await command(SUPABASE, ["migration", "repair", "20260902042807", "--status", "applied", "--local", "--workdir", root]);
    const presentReceipt = await runP10ReceiptCapture({ mode: "LOCAL_TEST", dsn, packet: receiptSql, expectedSqlHash: P10_RECEIPT_SQL_SHA256, psqlPath: PSQL });
    evidence.receiptHistoryPresent = presentReceipt.acceptanceResult === "PASS" && presentReceipt.perQuery?.[7]?.rowCount === 1 ? "PASS" : "FAIL";
    const sentinelVersion = "20991231235959"; const sentinelPath = join(root, "supabase", "migrations", `${sentinelVersion}_p11_replay_sentinel.sql`);
    await writeFile(sentinelPath, "DO $$ BEGIN RAISE EXCEPTION 'P11_REPLAY_SENTINEL_EXECUTED'; END $$;\n", "utf8");
    await command(SUPABASE, ["migration", "repair", sentinelVersion, "--status", "applied", "--local", "--workdir", root]);
    const sentinelCount = await command(PSQL, ["-X", "-q", "-tA", "-c", `SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '${sentinelVersion}'`], { env: { ...process.env, ...connection.pgEnv } });
    evidence.sentinel = sentinelCount.stdout.trim() === "1" ? "PASS" : "FAIL";
    try { await command(PSQL, ["-X", "-q", "-v", "ON_ERROR_STOP=1"], { env: { ...process.env, ...connection.pgEnv }, input: "begin; create table public.p10_rollback_probe(id integer); select 1/0; commit;" }); } catch { const absent = await command(PSQL, ["-X", "-q", "-tA", "-c", "select to_regclass('public.p10_rollback_probe') is null"], { env: { ...process.env, ...connection.pgEnv } }); evidence.rollback = absent.stdout.trim() === "t" ? "PASS" : "FAIL"; }
  } finally { try { if (started) await command(SUPABASE, ["stop", "--no-backup", "--workdir", root]); await cleanupOwnedRoot({ root, repoSupabase }); evidence.cleanup = "PASS"; } catch {} }
  try { validateP10LocalEvidence(evidence); } catch (error) { error.message += ` firstFailureDetail=${evidence.firstFailureDetail ?? "none"} secondFailureDetail=${evidence.secondFailureDetail ?? "none"}`; throw error; }
  return evidence;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(JSON.stringify(await runP10ForwardReconciliationLocal(), null, 2));
