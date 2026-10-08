import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import { safeImportFailure } from "./lib/catalog-production-import.mjs";
import { createImportPostgresAdapter } from "./lib/catalog-production-import-postgres.mjs";
import { readImportReconciliation } from "./lib/catalog-production-import-executor.mjs";
import { IDENTITY_SQL, STATE_SQL } from "./lib/catalog-production-migration-transport.mjs";
import { sha256 } from "./lib/catalog-production-import.mjs";

export async function runInjectedTimeoutChecks() {
  const cases = [
    [new Error("Query read timeout"), "CLIENT_QUERY_TIMEOUT", "CLIENT_QUERY_TIMEOUT", "UNKNOWN"],
    [Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }), "POSTGRES_STATEMENT_TIMEOUT", "SERVER_STATEMENT_TIMEOUT", "57014"],
    [Object.assign(new Error("private cancellation reason"), { code: "57014" }), "POSTGRES_QUERY_CANCELLED", "CANCELLATION_REASON_UNKNOWN", "57014"],
    [Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" }), "POSTGRES_LOCK_TIMEOUT", "SERVER_LOCK_TIMEOUT", "55P03"],
    [Object.assign(new Error("private lock reason"), { code: "55P03" }), "POSTGRES_LOCK_NOT_AVAILABLE", "UNKNOWN", "55P03"],
    [{ code: "ETIMEDOUT" }, "TCP_CONNECTION_TIMEOUT", "NETWORK_TIMEOUT", "UNKNOWN"],
    [{ code: "ECONNRESET" }, "TCP_CONNECTION_RESET", "UNKNOWN", "UNKNOWN"],
    [{ code: "XX000", message: "postgresql://private:credential@secret.invalid", stack: "private stack", detail: "private row" }, "POSTGRES_SQL_ERROR", "UNKNOWN", "XX000"],
  ];
  for (const [error, failureClass, timeoutClass, sqlstate] of cases) {
    const safe = safeImportFailure(error, "SCHEMA", 35014, true);
    assert.equal(safe.failureClass, failureClass);
    assert.equal(safe.timeoutClass, timeoutClass);
    assert.equal(safe.sqlstate, sqlstate);
    assert.equal(safe.operation, "SCHEMA");
    assert.equal(safe.durationMs, 35014);
    assert.ok(!/private|credential|secret\.invalid|stack|detail/.test(JSON.stringify(safe)));
  }
  assert.equal(safeImportFailure({}, "SCHEMA", 35014, true).failureClass, "DATABASE_OR_TRANSPORT_FAILURE", "ELAPSED_TIME_ALONE_NOT_ROOT_CAUSE");
  let client;
  class StalledClient extends EventEmitter {
    constructor() { super(); client = this; this.calls = []; this.opens = 0; this.ends = 0; }
    async connect() { this.opens++; }
    async query(q) { this.calls.push(q); throw new Error("Query read timeout"); }
    async end() { this.ends++; }
  }
  const open = createImportPostgresAdapter({ config: {}, Client: StalledClient });
  const session = await open();
  await assert.rejects(session.query(STATE_SQL), error => safeImportFailure(error, "SCHEMA", 0, false).failureClass === "CLIENT_QUERY_TIMEOUT");
  assert.equal(client.calls[0].query_timeout, 35000);
  assert.equal(session.connected, false);
  assert.equal(client.ends, 1);
  await assert.rejects(session.query("ROLLBACK;", [], 5000));
  assert.equal(client.calls.length, 1, "NO_ROLLBACK_QUEUED_BEHIND_STALLED_QUERY");
  await session.close();
  assert.equal(client.ends, 1, "IDEMPOTENT_CLOSE");
  await assert.rejects(open(), /RECONNECT_FORBIDDEN/);
  assert.equal(client.opens, 1);

  const first = new Error("Query read timeout");
  const queries = [];
  await assert.rejects(readImportReconciliation({ packet: {}, prepared: {}, expectedServerIdentitySha256: "unused", session: {
    async query(sql, values, timeout) {
      queries.push({ sql, timeout });
      if (sql === IDENTITY_SQL) throw first;
      if (sql === "ROLLBACK;") throw new Error("private cleanup failure");
      return { rows: [] };
    },
  } }), error => error === first);
  assert.equal(queries.at(-1).sql, "ROLLBACK;");
  assert.equal(queries.at(-1).timeout, 5000);
  assert.equal(queries.length, 3);
  const row = { database: "owned", role: "owned", port: 5432, system_identifier: "owned" };
  const driftQueries = [];
  await assert.rejects(readImportReconciliation({ packet: { stage2SchemaSha256: "0".repeat(64) }, prepared: {},
    expectedServerIdentitySha256: sha256(JSON.stringify(row)), session: {
      async query(sql) {
        driftQueries.push(sql);
        return sql === IDENTITY_SQL ? { rows: [row] } : sql === STATE_SQL ? { rows: [{ state: { schema: {}, ledgerShape: {
          owner: "postgres", primaryKey: "PRIMARY KEY (version)", columns: [
            { name: "version", type: "text", notNull: true },
            { name: "name", type: "text", notNull: false },
            { name: "statements", type: "text[]", notNull: false },
          ],
        } } }] } : { rows: [] };
      },
    },
  }), /IMPORT_STAGE2_OR_READER_GRANTS_DRIFT/);
  assert.equal(driftQueries.at(-1), "ROLLBACK;");
  assert.equal(driftQueries.length, 4, "SCHEMA_MISMATCH_NEVER_REACHES_AUDIT_SNAPSHOT");
  let fastClient;
  class FastClient extends EventEmitter {
    constructor() { super(); fastClient = this; this.calls = 0; }
    async connect() {}
    async query() { this.calls++; return { rows: [{ state: "owned local schema" }] }; }
    async end() {}
  }
  const fast = await createImportPostgresAdapter({ config: {}, Client: FastClient })();
  assert.equal((await fast.query(STATE_SQL)).rows.length, 1);
  assert.equal(fast.connected, true);
  fastClient.emit("error", Object.assign(new Error("private socket payload"), { code: "ETIMEDOUT" }));
  await assert.rejects(fast.query(STATE_SQL), error => safeImportFailure(error, "SCHEMA", 0, false).timeoutClass === "NETWORK_TIMEOUT");
  assert.equal(fastClient.calls, 1, "BROKEN_SOCKET_NOT_REUSED");
  await fast.close();
  return cases.length + 4;
}

// Called only inside the existing owned disposable fixture; never reads env credentials.
export async function runLocalTimeoutChecks({ config, admin, check }) {
  assert.equal(config.host, "127.0.0.1");
  const open = createImportPostgresAdapter({ config });
  const stalled = await open();
  try {
    await stalled.query("BEGIN READ ONLY;");
    await assert.rejects(stalled.query("SELECT pg_sleep(10);", [], 50), error => safeImportFailure(error, "SCHEMA", 0, false).failureClass === "CLIENT_QUERY_TIMEOUT");
    check(!stalled.connected, "LOCAL_CLIENT_TIMEOUT_CLOSES_STALLED_SESSION");
    await assert.rejects(stalled.query("ROLLBACK;", [], 50));
    await assert.rejects(open(), /RECONNECT_FORBIDDEN/);
    check(true, "LOCAL_CLIENT_TIMEOUT_NO_QUEUED_ROLLBACK_OR_RETRY");
  } finally { await stalled.close(); }
  const server = await createImportPostgresAdapter({ config })();
  try {
    await server.query("BEGIN READ ONLY;");
    await server.query("SET LOCAL statement_timeout='50ms';");
    await assert.rejects(server.query("SELECT pg_sleep(10);", [], 2000), error => {
      const safe = safeImportFailure(error, "SCHEMA", 0, true);
      return safe.sqlstate === "57014" && safe.failureClass === "POSTGRES_STATEMENT_TIMEOUT";
    });
    await server.query("ROLLBACK;", [], 5000);
    check(server.connected, "LOCAL_SERVER_STATEMENT_TIMEOUT_ROLLBACK_USABLE");
    await admin.query("BEGIN; LOCK TABLE public.devices IN ACCESS EXCLUSIVE MODE;");
    try {
      await server.query("BEGIN READ ONLY;");
      await server.query("SET LOCAL lock_timeout='50ms';");
      await assert.rejects(server.query("SELECT count(*) FROM public.devices;", [], 2000), error => safeImportFailure(error, "SCHEMA", 0, true).failureClass === "POSTGRES_LOCK_TIMEOUT");
      await server.query("ROLLBACK;", [], 5000);
      check(server.connected, "LOCAL_LOCK_TIMEOUT_ROLLBACK_USABLE");
    } finally { await admin.query("ROLLBACK;"); }
    const fast = await server.query(STATE_SQL);
    check(fast.rows.length === 1, "LOCAL_FAST_EXACT_SCHEMA_QUERY_UNCHANGED");
  } finally { await server.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(`STAGE_C_TIMEOUT_FOCUSED=PASS_${await runInjectedTimeoutChecks()}`); }
  catch { console.log("STAGE_C_TIMEOUT_FOCUSED=FAIL"); process.exitCode = 1; }
}
