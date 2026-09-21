import pg from "pg";

import { parseP9Connection } from "../p9-readonly-postgres-transport.mjs";

const { Client: PgClient } = pg;

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function parseEnvironment(environment) {
  const dsn = environment?.P9_PRODUCTION_DATABASE_URL;
  if (typeof dsn !== "string" || !dsn.trim()) throw failure("PRODUCTION_CONNECTION_SOURCE_UNAVAILABLE");

  try {
    return parseP9Connection({ mode: "PRODUCTION", dsn });
  } catch {
    throw failure("PRODUCTION_CONNECTION_SOURCE_UNAVAILABLE");
  }
}

function assertSessionPooler(safeTarget) {
  if (safeTarget?.endpointClass !== "SUPAVISOR_SESSION") {
    throw failure("RELEASE_B_POSTGRES_ADAPTER_SESSION_POOLER_REQUIRED");
  }
}

function createClientConfig(pgEnv) {
  if (pgEnv?.PGSSLMODE !== "require" && pgEnv?.PGSSLMODE !== "verify-full") {
    throw failure("RELEASE_B_POSTGRES_ADAPTER_TLS_DOWNGRADE_FORBIDDEN");
  }
  if (!pgEnv?.PGHOST || !pgEnv?.PGPORT || !pgEnv?.PGDATABASE || !pgEnv?.PGUSER || typeof pgEnv?.PGPASSWORD !== "string") {
    throw failure("PRODUCTION_CONNECTION_SOURCE_UNAVAILABLE");
  }

  return {
    host: pgEnv.PGHOST,
    port: Number(pgEnv.PGPORT),
    database: pgEnv.PGDATABASE,
    user: pgEnv.PGUSER,
    password: pgEnv.PGPASSWORD,
    ssl: {
      rejectUnauthorized: true,
      servername: pgEnv.PGHOST,
    },
  };
}

function createTargetIdentity(safeTarget) {
  return Object.freeze({
    mode: safeTarget.mode,
    host: safeTarget.host,
    projectRef: safeTarget.projectRef,
    port: safeTarget.port,
    database: safeTarget.database,
    endpointClass: safeTarget.endpointClass,
  });
}

export function createReleaseBProductionPostgresAdapter({ environment = process.env, Client = PgClient } = {}) {
  async function createSession(input = null) {
    const { pgEnv, safeTarget } = input ?? parseEnvironment(environment);
    assertSessionPooler(safeTarget);
    const client = new Client(createClientConfig(pgEnv));
    await client.connect();

    let closed = false;
    let closeFailure = null;

    return Object.freeze({
      targetIdentity: createTargetIdentity(safeTarget),
      query(sql, params) {
        if (closed) throw failure("RELEASE_B_POSTGRES_ADAPTER_SESSION_CLOSED");
        return client.query(sql, params);
      },
      async close() {
        if (closeFailure) throw closeFailure;
        if (closed) return;
        closed = true;
        try {
          await client.end();
        } catch (error) {
          closeFailure = error?.code ? error : failure("RELEASE_B_POSTGRES_ADAPTER_SESSION_CLOSE_FAILED");
          if (!closeFailure.code) closeFailure.code = "RELEASE_B_POSTGRES_ADAPTER_SESSION_CLOSE_FAILED";
          throw closeFailure;
        }
      },
    });
  }

  async function readPostcheck() {
    throw new Error("RELEASE_B_POSTGRES_ADAPTER_POSTCHECK_NOT_IMPLEMENTED");
  }

  return Object.freeze({ createSession, readPostcheck });
}
