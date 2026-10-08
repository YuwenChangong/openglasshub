import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { STATE_SQL, IDENTITY_SQL, schemaDigest } from "./lib/catalog-production-migration-transport.mjs";
import { canonical, sha256, safeImportFailure } from "./lib/catalog-production-import.mjs";
import { createImportPostgresAdapter } from "./lib/catalog-production-import-postgres.mjs";
import { readImportReconciliation } from "./lib/catalog-production-import-executor.mjs";

const load = () => import("./lib/catalog-production-schema-diagnostics.mjs");

export async function runSchemaDiagnosticUnitChecks() {
  const { SCHEMA_DIAGNOSTIC_PLAN: plan, deriveSchemaComponents, diagnoseSchemaComponents } = await load();
  assert.equal(plan.components.length, 11);
  assert.equal(plan.stateSqlSha256, sha256(STATE_SQL));
  assert.equal(plan.statementsMax, 16);
  assert.equal(plan.selectsMax, 12);
  assert.ok(plan.clientDeadlineMs < 35000 && plan.statementTimeoutMs < plan.clientDeadlineMs);
  assert.ok(Object.isFrozen(plan.components) && plan.components.every(Object.isFrozen));
  assert.throws(() => deriveSchemaComponents(STATE_SQL.replace("'columns',", "'unreviewed',")), /DIAGNOSTIC_SQL_CONTRACT/);
  assert.throws(() => deriveSchemaComponents(STATE_SQL.replace("AS state;", "AS changed;")), /DIAGNOSTIC_SQL_CONTRACT/);
  const row = { database: "owned", role: "owned", port: 5432, system_identifier: "owned" };
  const digest = sha256(JSON.stringify(row));
  const run = async ({ error, identity = digest, invalidResponse = false, expire = false, cleanupFailure = false } = {}) => {
    const trace = { opens: 0, closes: 0, queries: [], pending: 0 };
    let clock = 0;
    const result = await diagnoseSchemaComponents({ expectedServerIdentitySha256: identity, now: () => clock, open: async () => {
      trace.opens++;
      return { connected: true, async close() { trace.closes++; }, async query(sql, values, timeout) {
        trace.queries.push({ sql, values, timeout });
        if (sql === IDENTITY_SQL) return { rows: [row] };
        if (sql === plan.components[0].sql) {
          if (expire) clock = plan.totalWallClockBudgetMs;
          if (error) throw error;
          if (invalidResponse) return { rows: [] };
        }
        if (cleanupFailure && sql === "ROLLBACK;") throw new Error("private cleanup data");
        return { rows: [{ component: null }] };
      } };
    } });
    assert.equal(trace.opens, 1); assert.equal(trace.closes, 1);
    assert.ok(trace.queries.length <= plan.statementsMax);
    assert.ok(!trace.queries.some(q => q.sql === STATE_SQL), "COMPONENT_RUN_NEVER_DISPATCHES_FULL_QUERY");
    assert.equal(result.automaticRetries, 0);
    assert.ok(!/private|credential|stack|secret\.invalid/.test(JSON.stringify(result)));
    return { result, trace };
  };
  const good = await run();
  assert.equal(good.result.status, "PASS");
  assert.equal(good.result.components.length, 11);
  assert.equal(good.result.selects, 12);
  assert.equal(good.trace.queries.at(-1).sql, "ROLLBACK;");
  for (const [error, category] of [
    [new Error("Query read timeout"), "CLIENT_QUERY_TIMEOUT"],
    [Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }), "POSTGRES_STATEMENT_TIMEOUT"],
    [Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" }), "POSTGRES_LOCK_TIMEOUT"],
    [Object.assign(new Error("private credential at secret.invalid"), { code: "XX000", stack: "private stack" }), "POSTGRES_SQL_ERROR"],
  ]) {
    const failed = await run({ error, cleanupFailure: true });
    assert.equal(failed.result.status, "BLOCKED");
    assert.equal(failed.result.diagnostic.failureClass, category);
    assert.equal(failed.result.components.length, 1);
    assert.equal(failed.result.components[0].componentId, "RELATIONS_ACL");
    assert.equal(failed.result.rollback, "FAILED_CLOSE_REQUIRED");
    assert.equal(failed.result.connectionClose, "PASS");
  }
  const wrong = await run({ identity: "a".repeat(64) });
  assert.equal(wrong.result.status, "BLOCKED");
  assert.equal(wrong.trace.queries.length, 1, "WRONG_IDENTITY_BEFORE_TRANSACTION_OR_COMPONENTS");
  assert.equal((await run({ invalidResponse: true })).result.status, "BLOCKED");
  assert.equal((await run({ expire: true })).result.status, "BLOCKED");
  return 9;
}

// All row data stays private in the existing disposable local fixture.
export async function runLocalSchemaDiagnosticChecks({ config, admin, check, packet, prepared, identitySha256 }) {
  assert.equal(config.host, "127.0.0.1");
  const { SCHEMA_DIAGNOSTIC_PLAN: plan, diagnoseSchemaComponents } = await load();
  const complete = (await admin.query(STATE_SQL)).rows[0].state;
  const assembled = {};
  const timings = [];
  const adapter = createImportPostgresAdapter({ config });
  const result = await diagnoseSchemaComponents({ expectedServerIdentitySha256: identitySha256, open: async timeout => {
    const session = await adapter(timeout);
    return { get connected() { return session.connected; }, close: () => session.close(), async query(sql, values, deadline) {
      const response = await session.query(sql, values, deadline);
      const component = plan.components.find(c => c.sql === sql);
      if (component) {
        if (component.path.length === 2) (assembled[component.path[0]] ??= {})[component.path[1]] = response.rows[0].component;
        else assembled[component.path[0]] = response.rows[0].component;
      }
      return response;
    } };
  } });
  check(result.status === "PASS" && result.components.length === 11 && result.selects === 12 && result.connectionClose === "PASS", "SCHEMA_COMPONENTS_LOCAL_BOUNDED_SESSION_PASS");
  check(canonical(assembled) === canonical(complete), "SCHEMA_COMPONENT_REASSEMBLY_EXACT_FULL_STATE_EQUALITY");
  check(schemaDigest(assembled) === packet.stage2SchemaSha256, "SCHEMA_COMPONENTS_PRESERVE_FROZEN_STAGE2_DIGEST");
  timings.push(...result.components);
  const slow = await createImportPostgresAdapter({ config })();
  try {
    const started = performance.now();
    await slow.query("BEGIN READ ONLY;");
    await slow.query("SET LOCAL statement_timeout='2s';");
    await slow.query("SELECT pg_sleep(0.1);", [], 3000);
    await slow.query("ROLLBACK;", [], 5000);
    check(performance.now() - started >= 90 && slow.connected, "SCHEMA_SLOW_BUT_SUCCESSFUL_LOCAL_RESPONSE_NOT_TIMEOUT");
  } finally { await slow.close(); }
  const drift = structuredClone(complete); drift.schema.relations[0].acl = "OWNED_LOCAL_UNREVIEWED_ACL";
  const rollback = [];
  await assert.rejects(readImportReconciliation({ packet, prepared, expectedServerIdentitySha256: identitySha256, session: {
    async query(sql, values = [], deadline = 35000) {
      rollback.push(sql);
      const response = await admin.query({ text: sql, values, query_timeout: deadline });
      if (sql === STATE_SQL) response.rows[0].state = drift;
      return response;
    },
  } }), /IMPORT_STAGE2_OR_READER_GRANTS_DRIFT/);
  check(rollback.at(-1) === "ROLLBACK;" && rollback.length === 4, "SCHEMA_COMPONENT_TOOLING_DOES_NOT_BYPASS_STAGE2_MISMATCH");
  return timings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(`SCHEMA_COMPONENT_FOCUSED=PASS_${await runSchemaDiagnosticUnitChecks()}`); }
  catch (error) { console.log(JSON.stringify({ SCHEMA_COMPONENT_FOCUSED: "FAIL", moduleMissing: error?.code === "ERR_MODULE_NOT_FOUND" })); process.exitCode = 1; }
}
