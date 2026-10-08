import { STATE_SQL, IDENTITY_SQL } from "./catalog-production-migration-transport.mjs";
import { sha256, safeImportFailure } from "./catalog-production-import.mjs";

const STATE_HASH = "d824566d382f19e2b720566af834b5c1b2fe613881a2807e5ca2d71c1863b917";
const SCHEMA_KEYS = ["relations", "columns", "constraints", "indexes", "policies", "views", "triggers", "functions"];
const IDS = ["RELATIONS_ACL", "COLUMNS", "CONSTRAINTS", "INDEXES", "POLICIES", "VIEWS", "TRIGGERS", "FUNCTIONS"];
const LOCAL_CODES = new Set(["DIAGNOSTIC_SQL_CONTRACT", "DIAGNOSTIC_RESPONSE_INVALID", "DIAGNOSTIC_IDENTITY_MISMATCH", "DIAGNOSTIC_BUDGET_EXPIRED", "DIAGNOSTIC_STATEMENT_BUDGET"]);
const reject = code => { throw Object.assign(new Error(code), { diagnosticCode: code }); };

// This is a delimiter reader for the hash-pinned query, not a general SQL parser.
// Quoted literals/identifiers and nested calls cannot split a projection.
function objectArguments(expression) {
  const prefix = "jsonb_build_object(";
  if (!expression.startsWith(prefix)) reject("DIAGNOSTIC_SQL_CONTRACT");
  let depth = 1, quote = null, start = prefix.length;
  const args = [];
  for (let i = start; i < expression.length; i++) {
    const char = expression[i];
    if (quote) {
      if (char === quote) {
        if (expression[i + 1] === quote) i++;
        else quote = null;
      }
    } else if (char === "'" || char === '"') quote = char;
    else if (char === "(") depth++;
    else if (char === ")") {
      if (--depth === 0) {
        if (expression.slice(i + 1).trim()) reject("DIAGNOSTIC_SQL_CONTRACT");
        args.push(expression.slice(start, i).trim());
        if (args.length % 2) reject("DIAGNOSTIC_SQL_CONTRACT");
        return args;
      }
    } else if (char === "," && depth === 1) {
      args.push(expression.slice(start, i).trim()); start = i + 1;
    }
  }
  reject("DIAGNOSTIC_SQL_CONTRACT");
}
function pairs(expression, expectedKeys) {
  const args = objectArguments(expression);
  if (args.length !== expectedKeys.length * 2 || expectedKeys.some((key, i) => args[i * 2] !== `'${key}'`)) reject("DIAGNOSTIC_SQL_CONTRACT");
  return Object.fromEntries(expectedKeys.map((key, i) => [key, args[i * 2 + 1]]));
}
export function deriveSchemaComponents(sql = STATE_SQL) {
  if (sha256(sql) !== STATE_HASH) reject("DIAGNOSTIC_SQL_CONTRACT");
  const marker = "\nSELECT ", tail = " AS state;";
  const index = sql.indexOf(marker);
  if (index < 0 || !sql.endsWith(tail)) reject("DIAGNOSTIC_SQL_CONTRACT");
  const cte = sql.slice(0, index) + "\n";
  const outer = pairs(sql.slice(index + marker.length, -tail.length), ["schema", "ledgerShape", "ledger", "counts"]);
  const schema = pairs(outer.schema, SCHEMA_KEYS);
  const projections = SCHEMA_KEYS.map((key, i) => ({ id: IDS[i], path: ["schema", key], expression: schema[key] }));
  for (const [key, id] of [["ledgerShape", "LEDGER_SHAPE"], ["ledger", "LEDGER_RECORDS"], ["counts", "CATALOG_COUNTS"]]) projections.push({ id, path: [key], expression: outer[key] });
  return Object.freeze(projections.map(({ id, path, expression }) => Object.freeze({ id, path: Object.freeze(path), sql: `${cte}SELECT ${expression} AS component;` })));
}

export const SCHEMA_DIAGNOSTIC_PLAN = Object.freeze({
  format: "catalog-stage-c-schema-components-v1", stateSqlSha256: STATE_HASH,
  components: deriveSchemaComponents(), statementsMax: 16, selectsMax: 12,
  connectDeadlineMs: 10000, clientDeadlineMs: 15000, statementTimeoutMs: 10000,
  lockTimeoutMs: 3000, rollbackDeadlineMs: 5000, totalWallClockBudgetMs: 240000,
});
const BEGIN = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;";
const SET_STATEMENT = "SET LOCAL statement_timeout='10s';";
const SET_LOCK = "SET LOCAL lock_timeout='3s';";
const ROLLBACK = "ROLLBACK;";
export function renderSchemaDiagnosticSql() {
  return [IDENTITY_SQL, BEGIN, SET_STATEMENT, SET_LOCK, ...SCHEMA_DIAGNOSTIC_PLAN.components.map(c => `-- ${c.id}\n${c.sql}`), ROLLBACK].join("\n\n") + "\n";
}
const safeDiagnostic = (error, componentId, durationMs, connected) => ({
  componentId, ...safeImportFailure(error, "SCHEMA", durationMs, connected),
  ...(LOCAL_CODES.has(error?.diagnosticCode) ? { failureClass: error.diagnosticCode } : {}),
});

// Separate read-only diagnostic path; never called by or substituted for import proof.
export async function diagnoseSchemaComponents({ open, expectedServerIdentitySha256, now = () => performance.now() }) {
  const plan = SCHEMA_DIAGNOSTIC_PLAN;
  const started = now(), deadline = started + plan.totalWallClockBudgetMs;
  const result = { format: plan.format, status: "BLOCKED", connections: 0, statements: 0, selects: 0, components: [], automaticRetries: 0,
    productionWriteTransactions: 0, importAttempts: 0, identity: "NOT_RUN", connectionClose: "NOT_RUN" };
  let session, transaction = false, operation = "CONNECT", operationStarted = now();
  const allowed = new Set([IDENTITY_SQL, BEGIN, SET_STATEMENT, SET_LOCK, ROLLBACK, ...plan.components.map(c => c.sql)]);
  const query = async (sql, id, isSelect = false) => {
    operation = id; operationStarted = now();
    const remaining = deadline - now();
    if (remaining <= 0) reject("DIAGNOSTIC_BUDGET_EXPIRED");
    if (!allowed.has(sql) || ++result.statements > plan.statementsMax || (isSelect && ++result.selects > plan.selectsMax)) reject("DIAGNOSTIC_STATEMENT_BUDGET");
    return session.query(sql, [], Math.min(id === "ROLLBACK" ? plan.rollbackDeadlineMs : plan.clientDeadlineMs, remaining));
  };
  try {
    if (!/^[a-f0-9]{64}$/.test(expectedServerIdentitySha256 ?? "")) reject("DIAGNOSTIC_IDENTITY_MISMATCH");
    result.connections = 1;
    session = await open(Math.min(plan.connectDeadlineMs, deadline - now()));
    const identity = await query(IDENTITY_SQL, "IDENTITY", true);
    const row = identity.rows?.[0];
    if (identity.rows?.length !== 1 || sha256(JSON.stringify({ database: row.database, role: row.role, port: row.port, system_identifier: row.system_identifier })) !== expectedServerIdentitySha256) reject("DIAGNOSTIC_IDENTITY_MISMATCH");
    result.identity = "PASS";
    await query(BEGIN, "BEGIN"); transaction = true;
    await query(SET_STATEMENT, "SET_STATEMENT");
    await query(SET_LOCK, "SET_LOCK");
    for (const component of plan.components) {
      const began = now();
      try {
        const response = await query(component.sql, component.id, true);
        if (response.rows?.length !== 1 || !Object.hasOwn(response.rows[0], "component")) reject("DIAGNOSTIC_RESPONSE_INVALID");
        result.components.push({ componentId: component.id, durationMs: Math.max(0, Math.floor(now() - began)), status: "COMPLETE", sqlstate: "UNKNOWN", timeoutClass: "UNKNOWN", waitClass: "UNKNOWN" });
      } catch (error) {
        const diagnostic = safeDiagnostic(error, component.id, now() - began, session.connected);
        result.components.push({ ...diagnostic, status: "FAILED", waitClass: diagnostic.failureClass === "POSTGRES_LOCK_TIMEOUT" ? "LOCK_TIMEOUT" : "UNKNOWN" });
        throw error;
      }
    }
    await query(ROLLBACK, "ROLLBACK"); transaction = false; result.rollback = "PASS";
    result.status = "PASS";
  } catch (error) {
    result.diagnostic = safeDiagnostic(error, operation, now() - operationStarted, session?.connected);
    if (transaction && operation !== "ROLLBACK") {
      if (session.connected && deadline > now()) {
        try { await query(ROLLBACK, "ROLLBACK"); result.rollback = "PASS"; }
        catch { result.rollback = "FAILED_CLOSE_REQUIRED"; }
      } else result.rollback = "CLOSE_REQUIRED";
    }
  } finally {
    if (session) try { await session.close(); result.connectionClose = "PASS"; }
    catch (error) { result.status = "BLOCKED"; result.connectionClose = "FAILED"; result.closeDiagnostic = safeDiagnostic(error, "CLOSE", 0, false); }
    result.durationMs = Math.max(0, Math.floor(now() - started));
  }
  return result;
}
