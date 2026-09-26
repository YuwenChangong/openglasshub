import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { assertOwnedRuntimeRoot, cleanupOwnedRoot, initializeRuntimeConfig } from "./p6b-local-e2e-runner.mjs";
import { createMirror, validateMirror } from "./local-supabase-migration-mirror.mjs";
import { parseP9Connection } from "./p9-readonly-postgres-transport.mjs";
import { runAuthADbCaptureInternal } from "./verified-session-auth-a-db-capture.mjs";
import { classifyAuthADatabase } from "./verified-session-auth-a-db-classify.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SUPABASE = join(ROOT, "node_modules", "@supabase", "cli-windows-x64", "bin", "supabase.exe");
const PSQL = "psql.exe";

function command(executable, args, { env = process.env, input } = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(executable, args, { cwd: ROOT, env, shell: false,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (part) => { output += part.toString(); });
    child.stderr.on("data", () => {});
    child.on("error", () => reject(new Error("AUTH_A_LOCAL_PROCESS_FAILURE")));
    child.on("close", (code) => code === 0 ? resolveCommand(output)
      : reject(new Error("AUTH_A_LOCAL_PROCESS_FAILURE")));
    if (input !== undefined) child.stdin.end(input);
  });
}

function portFree(port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolvePort(false); });
    socket.once("error", () => resolvePort(true));
  });
}

async function choosePorts() {
  const offsets = { api: 1, db: 2, shadow: 0, studio: 3, smtp: 4, analytics: 7, pooler: 9, inspector: 83 };
  for (const base of [57200, 57300, 57400, 57500]) {
    const free = await Promise.all(Object.values(offsets).map((offset) => portFree(base + offset)));
    if (free.every(Boolean)) return Object.fromEntries(Object.entries(offsets).map(([name, offset]) => [name, base + offset]));
  }
  throw new Error("AUTH_A_LOCAL_PORTS_UNAVAILABLE");
}

test("AUTH-A combined packet uses one real disposable local read-only psql session", { timeout: 900_000 }, async () => {
  const repoSupabase = join(ROOT, "supabase");
  const runtime = await mkdtemp(join(tmpdir(), `openglass-auth-a-${randomUUID().slice(0, 8)}-`));
  let attemptedStart = false;
  try {
    assertOwnedRuntimeRoot({ root: runtime, repoSupabase });
    const ports = await choosePorts();
    await initializeRuntimeConfig({ root: runtime, repoSupabase, runId: randomUUID().slice(0, 8),
      ports, exec: (action, options) => command(SUPABASE, [action, ...options.args, "--workdir", options.workdir]) });
    const destinationDirectory = join(runtime, "supabase", "migrations");
    const manifest = await createMirror({ sourceDirectory: join(repoSupabase, "migrations"), destinationDirectory });
    const mirror = await validateMirror({ sourceDirectory: join(repoSupabase, "migrations"),
      destinationDirectory, manifest });
    assert.equal(mirror.fileCountMismatch, 0);
    assert.equal(mirror.duplicateGroups.length, 0);
    assert.equal(mirror.sqlByteParityFailures, 0);
    attemptedStart = true;
    await command(SUPABASE, ["start", "--workdir", runtime]);
    const status = JSON.parse(await command(SUPABASE, ["status", "--output", "json", "--workdir", runtime]));
    const dsn = status.DB_URL;
    const connection = parseP9Connection({ mode: "LOCAL_TEST", dsn });
    assert.equal(connection.safeTarget.host, "127.0.0.1");
    await command(PSQL, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-c",
      "ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS created_by text, ADD COLUMN IF NOT EXISTS idempotency_key text, ADD COLUMN IF NOT EXISTS rollback text[];"],
    { env: { ...process.env, ...connection.pgEnv } });
    const [catalog, history] = await Promise.all([
      readFile(join(ROOT, "docs", "ops", "verified-session-v1-hosted-catalog-preflight.sql"), "utf8"),
      readFile(join(ROOT, "docs", "ops", "p9-migration-history-rows-read-only.sql"), "utf8"),
    ]);
    const internal = await runAuthADbCaptureInternal({ mode: "LOCAL_TEST", dsn, catalog, history, psqlPath: PSQL });
    const result = internal.transportProof;
    assert.deepEqual({ status: result.status, attempts: result.connectionAttempts,
      processes: result.psqlProcessCount, queries: result.queryCount,
      readOnly: result.transactionReadOnly, sameBackend: result.sameBackend,
      rollback: result.rollbackMode },
    { status: "PASS", attempts: 1, processes: 1, queries: 12,
      readOnly: true, sameBackend: true, rollback: "EXPLICIT_ROLLBACK" });
    const classified = classifyAuthADatabase(internal);
    assert.equal(classified.dbStage, "UNKNOWN");
    assert.equal(classified.catalogPass, false);
    assert.equal(classified.catalogDrift, "INSUFFICIENT_PACKET_FOR_REVIEWED_DIGEST");
    assert.equal(JSON.stringify(classified).includes("rows"), false);
  } finally {
    try { if (attemptedStart) await command(SUPABASE, ["stop", "--no-backup", "--workdir", runtime]); }
    finally { await cleanupOwnedRoot({ root: runtime, repoSupabase }); }
  }
});
