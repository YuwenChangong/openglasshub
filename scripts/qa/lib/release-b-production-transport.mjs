import { parseP9Connection } from "../p9-readonly-postgres-transport.mjs";
import { renderReleaseBAuthorizedOperation } from "../../devices/schema-v1/disposable-postgres-transaction-client.mjs";
import { RELEASE_B_LOCKED_PRECHECK_SQL } from "../release-b-disposable-transport.mjs";

export const RELEASE_B_PRODUCTION_CREDENTIAL_ENV = "P9_PRODUCTION_DATABASE_URL";
export const RELEASE_B_AUTHORIZED_TABLES = Object.freeze({
  definition: "public.device_spec_definitions",
  device: "public.devices",
  source: "public.device_sources",
  sourceLink: "public.device_source_links",
  spec: "public.device_specs",
  evidence: "public.device_spec_evidence",
  compatibility: "public.devices",
});
const IDENTITY_SQL = "SELECT current_database() AS current_database, current_user AS current_user, inet_server_port()::text AS server_port;";
const FORBIDDEN_WRITE = /\b(?:DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|VACUUM|ANALYZE|COPY|COMMENT\s+ON)\b|\bsupabase_migrations\b/i;
const RELEASE_B_PRODUCTION_DATABASE_ROLE = "postgres";

function failure(code) { const error = new Error(code); error.code = code; return error; }
function rows(result) { if (!Array.isArray(result?.rows)) throw failure("RELEASE_B_PRODUCTION_RESULT_INVALID"); return result.rows; }
function resultState(result) {
  const first = rows(result)[0];
  const state = first?.release_b_state ?? (typeof first?.payload === "string" && /^[a-f0-9]+$/i.test(first.payload) ? JSON.parse(Buffer.from(first.payload, "hex").toString("utf8")) : null);
  if (!state || typeof state !== "object" || Array.isArray(state)) throw failure("RELEASE_B_PRODUCTION_PRECHECK_RESULT_INVALID");
  return state;
}
function safeDsn(environment) {
  const dsn = environment?.[RELEASE_B_PRODUCTION_CREDENTIAL_ENV];
  if (typeof dsn !== "string" || !dsn.trim()) throw failure("PRODUCTION_CONNECTION_SOURCE_UNAVAILABLE");
  try {
    const connection = parseP9Connection({ mode: "PRODUCTION", dsn });
    if (connection.safeTarget.endpointClass !== "SUPAVISOR_SESSION" || connection.safeTarget.database !== "postgres") throw failure("PRODUCTION_CONNECTION_SOURCE_UNAVAILABLE");
    return Object.freeze({
      ...connection,
      safeTarget: Object.freeze({ ...connection.safeTarget, databaseRole: RELEASE_B_PRODUCTION_DATABASE_ROLE }),
    });
  } catch { throw failure("PRODUCTION_CONNECTION_SOURCE_UNAVAILABLE"); }
}
function assertSession(session) { if (!session || typeof session.query !== "function" || typeof session.close !== "function" || !session.targetIdentity || typeof session.targetIdentity !== "object") throw failure("RELEASE_B_PRODUCTION_SESSION_FACTORY_INVALID"); return session; }
function exactlyOneSqlStatement(sql) {
  const statements = []; let start = 0; let quote = false; let dollar = null;
  for (let index = 0; index < sql.length; index += 1) {
    if (dollar) { if (sql.startsWith(dollar, index)) { index += dollar.length - 1; dollar = null; } continue; }
    const char = sql[index];
    if (char === "'") { if (quote && sql[index + 1] === "'") { index += 1; continue; } quote = !quote; continue; }
    if (!quote && char === "$") { const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$/.exec(sql.slice(index)); if (match) { dollar = match[0]; index += dollar.length - 1; continue; } }
    if (!quote && char === ";") { const statement = sql.slice(start, index).trim(); if (statement) statements.push(statement); start = index + 1; }
  }
  if (quote || dollar || sql.slice(start).trim() || statements.length !== 1) throw failure("RELEASE_B_PRODUCTION_WRITE_SCOPE_VIOLATION");
  return statements[0];
}
function allowedSql(entity, sql) {
  const table = RELEASE_B_AUTHORIZED_TABLES[entity];
  if (!table) throw failure("RELEASE_B_PRODUCTION_WRITE_SCOPE_VIOLATION");
  if (typeof sql !== "string" || !sql.trim() || FORBIDDEN_WRITE.test(sql)) throw failure("RELEASE_B_PRODUCTION_WRITE_FORBIDDEN");
  const normalized = exactlyOneSqlStatement(sql).replace(/\s+/g, " ").trim();
  if (!new RegExp(`^(?:INSERT INTO|UPDATE)\\s+${table.replace(".", "\\.")}\\b`, "i").test(normalized)) throw failure("RELEASE_B_PRODUCTION_WRITE_SCOPE_VIOLATION");
  return `${normalized};`;
}
function readOnlySql(sql) {
  const normalized = typeof sql === "string" ? sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/g, "").trim() : "";
  if (!/^(?:SELECT|WITH|SHOW)\b/i.test(normalized) || /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|VACUUM|ANALYZE)\b/i.test(normalized)) throw failure("RELEASE_B_PRODUCTION_READ_ONLY_VIOLATION");
  return normalized;
}
function assertCompatibilityUpdated(result) {
  if (result?.rowCount === 1 || result?.affectedRows === 1 || rows(result).length === 1) return;
  throw failure("RELEASE_B_COMPATIBILITY_DEVICE_MISSING");
}

function isConnectionLoss(error) {
  const code = String(error?.code ?? error?.sqlState ?? "");
  return /^(?:ECONNRESET|EPIPE|ETIMEDOUT|ECONNREFUSED|ECONNABORTED|ENETUNREACH|EHOSTUNREACH|57P01|57P02|57P03|08000|08003|08006|08001|08004|08007|08P01)$/i.test(code)
    || /(?:connection|socket|session).*(?:closed|lost|reset|terminated|broken|disconnect|exited)|(?:closed|lost|reset|terminated|broken|disconnect|exited).*(?:connection|socket|session)/i.test(String(error?.message ?? ""));
}

/** Value-blind: validates only that the existing reviewed DSN source is present and target-shaped. */
export function preflightReleaseBProductionTransport({ environment = process.env, createSession, readPostcheck } = {}) {
  const connection = safeDsn(environment);
  return Object.freeze({ credentialSource: RELEASE_B_PRODUCTION_CREDENTIAL_ENV, credentialAvailable: true, targetProjectRef: connection.safeTarget.projectRef, targetEndpointClass: connection.safeTarget.endpointClass, moduleInterfaceComplete: true, injectionComplete: typeof createSession === "function" && typeof readPostcheck === "function", connects: false, startsTransaction: false, runsSql: false });
}

export function classifyReleaseBConnectionFailure(error, phase) {
  if (!isConnectionLoss(error)) return "RELEASE_B_PRODUCTION_TRANSPORT_FAILURE";
  // These outcomes establish no successful write, but do not pretend that a
  // rollback was acknowledged when the connection itself disappeared.
  if (phase === "BEFORE_BEGIN") return "RELEASE_B_SAFE_FAILURE_BEFORE_BEGIN";
  if (phase === "AFTER_BEGIN_BEFORE_FIRST_WRITE") return "RELEASE_B_SAFE_FAILURE_BEFORE_FIRST_WRITE";
  if (phase === "AFTER_FIRST_WRITE_BEFORE_COMMIT") return "TRANSPORT_AFTER_FIRST_WRITE";
  if (phase === "COMMIT_SENT_ACK_NOT_RECEIVED") return "COMMIT_UNKNOWN";
  if (phase === "COMMIT_SENT_ACK_RECEIVED" || phase === "POST_COMMIT_VERIFICATION") return "RELEASE_B_COMMITTED_READ_ONLY_VERIFICATION_REQUIRED";
  return "RELEASE_B_PRODUCTION_TRANSPORT_FAILURE";
}

export function createReleaseBProductionTransport(options = {}) {
  if (Object.hasOwn(options, "renderAuthorizedOperation")) throw failure("RELEASE_B_PRODUCTION_RENDERER_INJECTION_FORBIDDEN");
  const { environment = process.env, createSession, readPostcheck } = options;
  const connection = safeDsn(environment);
  if (typeof createSession !== "function" || typeof readPostcheck !== "function") throw failure("RELEASE_B_PRODUCTION_TRANSPORT_INCOMPLETE");
  // Mutations are rendered only by the closed descriptor renderer. There is
  // deliberately no caller-supplied renderer or raw SQL mutation seam.
  const open = async () => assertSession(await createSession({ pgEnv: connection.pgEnv, safeTarget: connection.safeTarget }));
  const identify = async (session) => {
    const identity = rows(await session.query(IDENTITY_SQL))[0];
    const peer = session.targetIdentity;
    if (identity?.current_database !== connection.safeTarget.database || identity?.current_user !== connection.safeTarget.databaseRole
      || identity?.server_port !== String(connection.safeTarget.port)
      || peer.projectRef !== connection.safeTarget.projectRef || peer.host !== connection.safeTarget.host || Number(peer.port) !== connection.safeTarget.port) throw failure("RELEASE_B_TARGET_MISMATCH");
    return { projectRef: connection.safeTarget.projectRef, targetClass: "OpenGlass Hub Supabase Production" };
  };
  return Object.freeze({
    async identifyTarget() { const session = await open(); try { return await identify(session); } finally { await session.close(); } },
    async readPrecheck() { const session = await open(); try { return resultState(await session.query(RELEASE_B_LOCKED_PRECHECK_SQL)); } finally { await session.close(); } },
    async readPostcheck() { const session = await open(); try { return await readPostcheck({ queryReadOnly: (sql, params) => session.query(readOnlySql(sql), params) }); } finally { await session.close(); } },
    classifyConnectionFailure: classifyReleaseBConnectionFailure,
    async transaction(work) {
      let session; let phase = "BEFORE_BEGIN"; let committed = false;
      let pendingError;
      try {
        session = await open();
        await session.query("BEGIN;");
        await session.query("SET CONSTRAINTS ALL DEFERRED;"); phase = "AFTER_BEGIN_BEFORE_FIRST_WRITE";
        await work(Object.freeze({
          async readPrecheckForUpdate() { if (phase !== "AFTER_BEGIN_BEFORE_FIRST_WRITE") throw failure("RELEASE_B_PRECHECK_MUST_PRECEDE_WRITES"); return resultState(await session.query(RELEASE_B_LOCKED_PRECHECK_SQL)); },
          async upsert(entity, row) {
            const sql = allowedSql(entity, renderReleaseBAuthorizedOperation({ entity, row }));
            phase = "AFTER_FIRST_WRITE_BEFORE_COMMIT";
            const result = await session.query(sql);
            if (entity === "compatibility") assertCompatibilityUpdated(result);
          },
        }));
        phase = "COMMIT_SENT_ACK_NOT_RECEIVED"; await session.query("COMMIT;"); committed = true; phase = "COMMIT_SENT_ACK_RECEIVED";
      } catch (error) {
        try {
          if (session && !committed && phase !== "COMMIT_SENT_ACK_NOT_RECEIVED") {
            try { await session.query("ROLLBACK;"); } catch (rollbackError) { throw failure(classifyReleaseBConnectionFailure(rollbackError, phase)); }
          }
          if (typeof error?.code === "string" && error.code.startsWith("RELEASE_B_")) throw error;
          if (isConnectionLoss(error)) throw failure(classifyReleaseBConnectionFailure(error, phase));
          throw error;
        } catch (finalError) {
          pendingError = finalError;
          throw finalError;
        }
      } finally {
        if (session) {
          try { await session.close(); } catch (closeError) {
            if (!pendingError) {
              if (!committed) {
                if (isConnectionLoss(closeError)) throw failure(classifyReleaseBConnectionFailure(closeError, phase));
                throw closeError;
              }
            }
          }
        }
      }
    },
  });
}
