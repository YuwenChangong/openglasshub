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
const IDENTITY_SQL = "SELECT current_database() AS current_database, current_user AS current_user;";
const FORBIDDEN_WRITE = /\b(?:DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|VACUUM|ANALYZE|COPY|COMMENT\s+ON)\b|\bsupabase_migrations\b/i;

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
  try { return parseP9Connection({ mode: "PRODUCTION", dsn }); } catch { throw failure("PRODUCTION_CONNECTION_SOURCE_UNAVAILABLE"); }
}
function assertSession(session) { if (!session || typeof session.query !== "function" || typeof session.close !== "function") throw failure("RELEASE_B_PRODUCTION_SESSION_FACTORY_INVALID"); return session; }
function allowedSql(entity, sql) {
  const table = RELEASE_B_AUTHORIZED_TABLES[entity];
  if (!table) throw failure("RELEASE_B_PRODUCTION_WRITE_SCOPE_VIOLATION");
  if (typeof sql !== "string" || !sql.trim() || FORBIDDEN_WRITE.test(sql)) throw failure("RELEASE_B_PRODUCTION_WRITE_FORBIDDEN");
  const normalized = sql.replace(/\s+/g, " ").trim();
  if (!new RegExp(`^(?:INSERT INTO|UPDATE)\\s+${table.replace(".", "\\.")}\\b`, "i").test(normalized)
    && !(entity === "compatibility" && /^DO\s+\$openglass_compat\$/i.test(normalized))) throw failure("RELEASE_B_PRODUCTION_WRITE_SCOPE_VIOLATION");
  return normalized;
}
function readOnlySql(sql) {
  const normalized = typeof sql === "string" ? sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/g, "").trim() : "";
  if (!/^(?:SELECT|WITH|SHOW)\b/i.test(normalized) || /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|VACUUM|ANALYZE)\b/i.test(normalized)) throw failure("RELEASE_B_PRODUCTION_READ_ONLY_VIOLATION");
  return normalized;
}

/** Value-blind: validates only that the existing reviewed DSN source is present and target-shaped. */
export function preflightReleaseBProductionTransport({ environment = process.env, createSession, renderAuthorizedOperation = renderReleaseBAuthorizedOperation, readPostcheck } = {}) {
  const connection = safeDsn(environment);
  return Object.freeze({ credentialSource: RELEASE_B_PRODUCTION_CREDENTIAL_ENV, credentialAvailable: true, targetProjectRef: connection.safeTarget.projectRef, targetEndpointClass: connection.safeTarget.endpointClass, moduleInterfaceComplete: true, injectionComplete: typeof createSession === "function" && typeof renderAuthorizedOperation === "function" && typeof readPostcheck === "function", connects: false, startsTransaction: false, runsSql: false });
}

export function classifyReleaseBConnectionFailure(error, phase) {
  const native = /^(?:ECONNRESET|EPIPE|ETIMEDOUT|57P01)$/i.test(String(error?.code ?? error?.sqlState ?? ""));
  if (!native) return "RELEASE_B_PRODUCTION_TRANSPORT_FAILURE";
  if (phase === "BEFORE_BEGIN" || phase === "AFTER_BEGIN_BEFORE_FIRST_WRITE") return "RELEASE_B_SAFE_FAILURE";
  if (phase === "AFTER_FIRST_WRITE_BEFORE_COMMIT") return "TRANSPORT_AFTER_FIRST_WRITE";
  if (phase === "COMMIT_SENT_ACK_NOT_RECEIVED") return "COMMIT_UNKNOWN";
  if (phase === "COMMIT_SENT_ACK_RECEIVED" || phase === "POST_COMMIT_VERIFICATION") return "RELEASE_B_COMMITTED_READ_ONLY_VERIFICATION_REQUIRED";
  return "RELEASE_B_PRODUCTION_TRANSPORT_FAILURE";
}

export function createReleaseBProductionTransport({ environment = process.env, createSession, renderAuthorizedOperation = renderReleaseBAuthorizedOperation, readPostcheck } = {}) {
  const connection = safeDsn(environment);
  if (typeof createSession !== "function" || typeof renderAuthorizedOperation !== "function" || typeof readPostcheck !== "function") throw failure("RELEASE_B_PRODUCTION_TRANSPORT_INCOMPLETE");
  const open = async () => assertSession(await createSession({ pgEnv: connection.pgEnv, safeTarget: connection.safeTarget }));
  const identify = async (session) => {
    const identity = rows(await session.query(IDENTITY_SQL))[0];
    if (identity?.current_database !== connection.safeTarget.database || identity?.current_user !== connection.pgEnv.PGUSER) throw failure("RELEASE_B_TARGET_MISMATCH");
    return { projectRef: connection.safeTarget.projectRef, targetClass: "OpenGlass Hub Supabase Production" };
  };
  return Object.freeze({
    async identifyTarget() { const session = await open(); try { return await identify(session); } finally { await session.close(); } },
    async readPrecheck() { const session = await open(); try { return resultState(await session.query(RELEASE_B_LOCKED_PRECHECK_SQL)); } finally { await session.close(); } },
    async readPostcheck() { const session = await open(); try { return await readPostcheck({ queryReadOnly: (sql, params) => session.query(readOnlySql(sql), params) }); } finally { await session.close(); } },
    classifyConnectionFailure: classifyReleaseBConnectionFailure,
    async transaction(work) {
      const session = await open(); let phase = "BEFORE_BEGIN"; let committed = false;
      try {
        await session.query("BEGIN;\nSET CONSTRAINTS ALL DEFERRED;"); phase = "AFTER_BEGIN_BEFORE_FIRST_WRITE";
        await work(Object.freeze({
          async readPrecheckForUpdate() { if (phase !== "AFTER_BEGIN_BEFORE_FIRST_WRITE") throw failure("RELEASE_B_PRECHECK_MUST_PRECEDE_WRITES"); return resultState(await session.query(RELEASE_B_LOCKED_PRECHECK_SQL)); },
          async upsert(entity, row) { const sql = allowedSql(entity, renderAuthorizedOperation({ entity, row })); phase = "AFTER_FIRST_WRITE_BEFORE_COMMIT"; await session.query(sql); },
        }));
        phase = "COMMIT_SENT_ACK_NOT_RECEIVED"; await session.query("COMMIT;"); committed = true; phase = "COMMIT_SENT_ACK_RECEIVED";
      } catch (error) {
        if (!committed && phase !== "COMMIT_SENT_ACK_NOT_RECEIVED") {
          try { await session.query("ROLLBACK;"); } catch (rollbackError) { throw failure(classifyReleaseBConnectionFailure(rollbackError, phase)); }
        }
        if (error?.code === "RELEASE_B_PRODUCTION_WRITE_SCOPE_VIOLATION" || error?.code === "RELEASE_B_PRODUCTION_WRITE_FORBIDDEN") throw error;
        throw failure(classifyReleaseBConnectionFailure(error, phase));
      } finally { await session.close(); }
    },
  });
}
