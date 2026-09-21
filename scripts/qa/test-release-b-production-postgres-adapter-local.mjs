import assert from "node:assert/strict";
import net from "node:net";
import { randomUUID } from "node:crypto";

import pg from "pg";

import { runLocalDisposableReplay } from "./local-disposable-supabase-replay.mjs";
import { createReleaseBProductionPostgresAdapter } from "./lib/release-b-production-postgres-adapter.mjs";

const { Client: PgClient } = pg;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const COMMIT_ACK_AMBIGUITY_COVERAGE = "SYNTHETIC_CONTRACT_ONLY_NOT_NETWORK_LEVEL";
const LOCAL_REPLAY_ENVIRONMENT_BLOCKLIST = [
  "P9_PRODUCTION_DATABASE_URL",
  "POSTGRES_URL",
  "DATABASE_URL",
  "PGHOST",
  "PGPORT",
  "PGSERVICE",
  "SUPABASE_DB_URL",
  "SUPABASE_URL",
  "PUBLIC_SUPABASE_URL",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
];

function assertLoopbackHost(host) {
  const normalized = String(host ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!LOCAL_HOSTS.has(normalized)) throw new Error("RELEASE_B_LOCAL_ADAPTER_REFUSED_NON_LOOPBACK_TARGET");
  return normalized;
}

function disposableDatabasePortFromApiTarget(target) {
  const url = new URL(target);
  assertLoopbackHost(url.hostname);
  const apiPort = Number(url.port);
  if (!Number.isSafeInteger(apiPort) || apiPort <= 0 || apiPort >= 65535) {
    throw new Error("RELEASE_B_LOCAL_ADAPTER_INVALID_LOOPBACK_PORT");
  }
  const dbPort = apiPort + 1;
  if (dbPort >= 65535) throw new Error("RELEASE_B_LOCAL_ADAPTER_INVALID_LOOPBACK_PORT");
  return { host: assertLoopbackHost(url.hostname), port: dbPort };
}

function createLoopbackOnlyPgClientClass({ state }) {
  return class LoopbackOnlyPgClient {
    constructor(config) {
      state.constructed += 1;
      state.configs.push(config);
      assertLoopbackHost(config?.host);
      assert.equal(config?.ssl?.rejectUnauthorized, true, "adapter must still build its reviewed TLS config before the local wrapper adapts it");
      this.client = new PgClient({ ...config, ssl: false });
      this.connectCalls = 0;
      this.endCalls = 0;
      state.clients.push(this);
    }

    async connect() {
      this.connectCalls += 1;
      state.connectCalls += 1;
      return this.client.connect();
    }

    async query(sql, params) {
      state.queryCalls += 1;
      return this.client.query(sql, params);
    }

    async end() {
      this.endCalls += 1;
      state.endCalls += 1;
      return this.client.end();
    }
  };
}

function quoteIdentifier(identifier) {
  assert.match(identifier, /^[a-z][a-z0-9_]{0,62}$/);
  return `"${identifier}"`;
}

function scrubbedLocalReplayEnvironment() {
  const inherited = { ...process.env };
  for (const name of Object.keys(inherited)) {
    if (/^PG[A-Z0-9_]*$/i.test(name)) inherited[name] = "";
  }
  return {
    ...inherited,
    ...Object.fromEntries(LOCAL_REPLAY_ENVIRONMENT_BLOCKLIST.map((name) => [name, ""])),
  };
}

function assertInheritedPgEnvironmentIsScrubbed() {
  const seeded = {
    PGPASSWORD: "production-derived-password",
    PGUSER: "production-derived-user",
    PGDATABASE: "production-derived-database",
    PGSSLMODE: "require",
    PGAPPNAME: "production-derived-app",
  };
  const previous = Object.fromEntries(Object.keys(seeded).map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, seeded);
    const environment = scrubbedLocalReplayEnvironment();
    for (const name of Object.keys(seeded)) {
      assert.equal(environment[name], "", `${name} must not leak into disposable replay child environment`);
    }
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function assertTcpLoopbackReachable({ host, port }) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(5000);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("RELEASE_B_LOCAL_ADAPTER_LOOPBACK_SOCKET_TIMEOUT"));
    });
    socket.once("error", reject);
  });
}

async function runAdapterLifecycleProof({ target, createSqlSession }) {
  assert.equal(typeof createSqlSession, "function", "disposable harness must expose its owned local SQL session seam");
  const localTarget = disposableDatabasePortFromApiTarget(target);
  await assertTcpLoopbackReachable(localTarget);

  const state = {
    constructed: 0,
    connectCalls: 0,
    queryCalls: 0,
    endCalls: 0,
    configs: [],
    clients: [],
  };
  const adapter = createReleaseBProductionPostgresAdapter({
    Client: createLoopbackOnlyPgClientClass({ state }),
  });
  const pgEnv = {
    PGHOST: localTarget.host,
    PGPORT: String(localTarget.port),
    PGDATABASE: "postgres",
    PGUSER: "postgres",
    PGPASSWORD: "postgres",
    PGSSLMODE: "require",
  };
  const safeTarget = {
    mode: "LOCAL_DISPOSABLE",
    host: localTarget.host,
    projectRef: "local-disposable",
    port: localTarget.port,
    database: "postgres",
    endpointClass: "SUPAVISOR_SESSION",
  };
  const table = quoteIdentifier(`release_b_adapter_local_${randomUUID().replaceAll("-", "").slice(0, 24)}`);

  const session = await adapter.createSession({ pgEnv, safeTarget });
  assert.deepEqual(session.targetIdentity, safeTarget);
  assert.deepEqual((await session.query("SELECT $1::int AS value", [17])).rows, [{ value: 17 }]);

  await session.query(`CREATE TABLE public.${table} (id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, label text NOT NULL UNIQUE);`);
  await session.query("BEGIN;");
  await session.query(`INSERT INTO public.${table} (label) VALUES ($1);`, ["committed"]);
  await session.query("COMMIT;");
  assert.equal(Number((await session.query(`SELECT count(*) AS count FROM public.${table} WHERE label = $1;`, ["committed"])).rows[0].count), 1);

  await session.query("BEGIN;");
  await session.query(`INSERT INTO public.${table} (label) VALUES ($1);`, ["rolled-back"]);
  await session.query("ROLLBACK;");
  assert.equal(Number((await session.query(`SELECT count(*) AS count FROM public.${table} WHERE label = $1;`, ["rolled-back"])).rows[0].count), 0);

  await session.query("BEGIN;");
  await session.query(`INSERT INTO public.${table} (label) VALUES ($1);`, ["error-rolled-back"]);
  await assert.rejects(
    () => session.query(`SELECT missing_column FROM public.${table};`),
    (error) => error?.code === "42703",
  );
  await session.query("ROLLBACK;");
  assert.equal(Number((await session.query(`SELECT count(*) AS count FROM public.${table} WHERE label = $1;`, ["error-rolled-back"])).rows[0].count), 0);

  await session.close();
  assert.throws(() => session.query("SELECT 1;"), /RELEASE_B_POSTGRES_ADAPTER_SESSION_CLOSED/);

  const freshSession = await adapter.createSession({ pgEnv, safeTarget });
  assert.equal(Number((await freshSession.query(`SELECT count(*) AS count FROM public.${table} WHERE label = $1;`, ["committed"])).rows[0].count), 1);
  assert.equal(Number((await freshSession.query(`SELECT count(*) AS count FROM public.${table} WHERE label IN ($1, $2);`, ["rolled-back", "error-rolled-back"])).rows[0].count), 0);
  await freshSession.close();

  assert.equal(state.constructed, 2, "adapter opens one native client per session");
  assert.equal(state.connectCalls, 2, "fresh-session proof should connect exactly twice");
  assert.equal(state.endCalls, 2, "close should end each native client exactly once");
  for (const client of state.clients) {
    assert.equal(client.connectCalls, 1, "native client connect must not retry");
    assert.equal(client.endCalls, 1, "native client end must not retry");
  }
  assert(state.queryCalls >= 12, "test must exercise real PostgreSQL query behavior");

  assert.equal(COMMIT_ACK_AMBIGUITY_COVERAGE, "SYNTHETIC_CONTRACT_ONLY_NOT_NETWORK_LEVEL");
  assert.doesNotMatch(COMMIT_ACK_AMBIGUITY_COVERAGE, /NETWORK_LEVEL_COMMIT_ACK_REPRODUCED/);

  return {
    adapterLocalTarget: "LOOPBACK_DISPOSABLE",
    nativeClientSessions: state.constructed,
    connectAttemptsPerSessionMax: Math.max(...state.clients.map((client) => client.connectCalls)),
    closeAttemptsPerSessionMax: Math.max(...state.clients.map((client) => client.endCalls)),
    commitAckAmbiguityCoverage: COMMIT_ACK_AMBIGUITY_COVERAGE,
  };
}

assertInheritedPgEnvironmentIsScrubbed();

const result = await runLocalDisposableReplay({
  environment: scrubbedLocalReplayEnvironment(),
  afterMigrationLedgerValidated: runAdapterLifecycleProof,
});

assert.equal(result.localReplay, "PASS");
assert.equal(result.localReplayTarget, "DISPOSABLE");
assert.equal(result.schemaFingerprintProductionConnection, false);
assert.equal(result.remoteConnections, 0);
assert.deepEqual(result.afterMigrationLedgerValidated, {
  adapterLocalTarget: "LOOPBACK_DISPOSABLE",
  nativeClientSessions: 2,
  connectAttemptsPerSessionMax: 1,
  closeAttemptsPerSessionMax: 1,
  commitAckAmbiguityCoverage: "SYNTHETIC_CONTRACT_ONLY_NOT_NETWORK_LEVEL",
});

console.log("RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_LOCAL_OK");
