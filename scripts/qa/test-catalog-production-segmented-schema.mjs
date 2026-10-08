import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { STATE_SQL, schemaDigest, classifyState, APPROVED_ARTIFACTS } from "./lib/catalog-production-migration-transport.mjs";
import { createImportPostgresAdapter } from "./lib/catalog-production-import-postgres.mjs";
import { createSegmentedReadOnlySession } from "./lib/catalog-production-segmented-readonly.mjs";
import { readImportReconciliation } from "./lib/catalog-production-import-executor.mjs";
import { IDENTITY_SQL } from "./lib/catalog-production-migration-transport.mjs";
import { deriveSchemaComponents } from "./lib/catalog-production-schema-diagnostics.mjs";
import { sha256, canonical } from "./lib/catalog-production-import.mjs";

export async function runSegmentedSchemaUnitChecks() {
  assert.ok(existsSync(new URL("./lib/catalog-production-segmented-schema.mjs", import.meta.url)), "SEGMENTED_VERIFIER_EXISTS");
  const { readSegmentedStage2, reconstructSchemaState, SEGMENTED_CONTRACT } = await import("./lib/catalog-production-segmented-schema.mjs");
  const components = deriveSchemaComponents();
  const ledger = ["public_device_detail_v1", "catalog_editor_presentation_v1"].map((name, i) => ({
    version: ["20261004003349", "20261004014637"][i], name, statements: [`owned-offline-${i}`],
  }));
  const values = [[], [], [], [], [], [], [], [], { owner: "postgres", primaryKey: "PRIMARY KEY (version)", columns: [
    { name: "version", type: "text", notNull: true }, { name: "name", type: "text", notNull: false }, { name: "statements", type: "text[]", notNull: false },
  ] }, ledger, { audit: 0, specs: 0, devices: 0, published: 0, definitions: 0 }];
  const entries = components.map((c, i) => [c.id, values[i]]);
  const state = reconstructSchemaState(entries);
  const packet = { stage2SchemaSha256: schemaDigest(state), migrationHashes: ledger.map(l => sha256(l.statements[0])) };
  let checks = 0;
  const run = async transform => {
    const calls = [];
    const result = await readSegmentedStage2({ packet, query: async (sql, componentId) => {
      calls.push(sql); const index = components.findIndex(c => c.sql === sql);
      assert(index >= 0); return transform?.(index, values[index], componentId) ?? { rows: [{ component: values[index] }] };
    } });
    assert.equal(calls.length, 11); assert(!calls.includes(STATE_SQL)); return result;
  };
  assert.deepEqual(await run(), state); assert.equal(Object.keys(state.counts).length, 5); checks++;
  assert.deepEqual(Object.keys(state.schema), ["views", "columns", "indexes", "policies", "triggers", "functions", "relations", "constraints"]); checks++;
  const payload = { longer: null, z: "preserved", number: 1.5 };
  assert.equal(reconstructSchemaState(entries.map(([id, value]) => [id, id === "RELATIONS_ACL" ? [payload] : value])).schema.relations[0], payload); checks++;
  for (const entriesFault of [entries.slice(1), [...entries, entries[0]], entries.map(([id, v]) => [id === "COLUMNS" ? "UNKNOWN" : id, v])]) {
    assert.throws(() => reconstructSchemaState(entriesFault), /IMPORT_SCHEMA_COMPONENT/); checks++;
  }
  for (const response of [{ rows: [] }, { rows: [{}] }, { rows: [{ component: [] }, { component: [] }] }, { rows: [{ component: "invalid" }] }]) {
    await assert.rejects(run(index => index === 0 ? response : undefined), /IMPORT_SCHEMA_COMPONENT/); checks++;
  }
  const timeout = new Error("Query read timeout");
  await assert.rejects(run(index => { if (index === 2) throw timeout; }), e => e === timeout && e.schemaComponentId === "CONSTRAINTS"); checks++;
  for (const [index, value] of [[0, null], [1, [{ missing: "column" }]], [8, null], [9, ledger.map(l => ({ ...l, statements: ["unexpected"] }))], [9, []], [10, { devices: 0, specs: 0 }]]) {
    await assert.rejects(run(i => i === index ? { rows: [{ component: value }] } : undefined)); checks++;
  }
  const wrongOrder = { ...state, schema: Object.fromEntries(components.slice(0, 8).map(c => [c.path[1], state.schema[c.path[1]]])) };
  assert.equal(canonical(wrongOrder), canonical(state)); assert.notEqual(schemaDigest(wrongOrder), schemaDigest(state)); checks++;
  assert.equal(SEGMENTED_CONTRACT.reconciliationSelectsMax, 13);
  assert.equal(SEGMENTED_CONTRACT.importSelectsMax, 49);
  assert.equal(SEGMENTED_CONTRACT.importDispatchesMax, 61);
  assert.equal(SEGMENTED_CONTRACT.queryDeadlineMs, 35000); checks++;
  return checks;
}

export async function runLocalSegmentedSchemaChecks({ config, admin, check, packet, prepared }) {
  assert.equal(config.host, "127.0.0.1", "SEGMENTED_PROOF_OWNED_LOOPBACK_ONLY");
  const { readSegmentedStage2 } = await import("./lib/catalog-production-segmented-schema.mjs");
  const proof = JSON.parse(readFileSync(new URL("./fixtures/catalog-stage-b-schema-proof.json", import.meta.url), "utf8"));
  const bundle = { states: proof.states, migrations: APPROVED_ARTIFACTS.migrations };
  const read = query => readSegmentedStage2({ packet, query: query ?? (sql => admin.query(sql)) });
  await admin.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;");
  try {
    const complete = (await admin.query(STATE_SQL)).rows[0].state;
    const segmented = await read();
    assert.deepEqual(segmented, complete, "SEGMENTED_ALL_VALUES_STRICT_FULL_QUERY_EQUIVALENCE");
    check(JSON.stringify(segmented) === JSON.stringify(complete), "SEGMENTED_POSTGRES_JSONB_ORDER_AND_REPRESENTATION_EQUAL");
    check(schemaDigest(segmented) === packet.stage2SchemaSha256 && schemaDigest(complete) === packet.stage2SchemaSha256, "SEGMENTED_FROZEN_SCHEMA_DIGEST_IDENTICAL");
    check(classifyState(segmented, bundle) === 2 && classifyState(complete, bundle) === 2, "SEGMENTED_EXACT_FROZEN_STAGE2_CLASSIFICATION");
    check(complete.schema.columns.some(column => Object.values(column).includes(null)), "SEGMENTED_GENUINE_NULL_METADATA_PRESERVED");
  } finally { await admin.query("ROLLBACK;"); }
  const driftCases = [
    ["MISSING_RELATION", "DROP VIEW public.public_device_detail_specs CASCADE;"],
    ["MISSING_COLUMN", "ALTER TABLE public.devices DROP COLUMN short_description CASCADE;"],
    ["ACL", "REVOKE SELECT ON public.devices FROM anon;"],
    ["RLS", "ALTER TABLE public.device_specs DISABLE ROW LEVEL SECURITY;"],
    ["POLICY", "CREATE POLICY owned_segmented_probe ON public.device_specs FOR SELECT TO anon USING(false);"],
    ["TRIGGER", "ALTER TABLE public.devices DISABLE TRIGGER USER;"],
    ["FUNCTION", "ALTER FUNCTION public.is_catalog_admin() COST 101;"],
    ["LEDGER_MISMATCH", "UPDATE supabase_migrations.schema_migrations SET name='owned_wrong_name' WHERE version='20261004003349';"],
    ["UNEXPECTED_MIGRATION_STATEMENT", "UPDATE supabase_migrations.schema_migrations SET statements=statements||ARRAY['OWNED_UNEXPECTED_SQL'] WHERE version='20261004003349';"],
  ];
  for (const [label, sql] of driftCases) {
    await admin.query("BEGIN;");
    try {
      await admin.query(sql);
      await assert.rejects(read(), /IMPORT_STAGE2_OR_READER_GRANTS_DRIFT/, `SEGMENTED_${label}_FAIL_CLOSED`);
    } finally { await admin.query("ROLLBACK;"); }
    await read();
    check(true, `SEGMENTED_${label}_GENUINE_DB_DRIFT_AND_ROLLBACK`);
  }
  await admin.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;");
  try {
    await assert.rejects(read(async sql => {
      const response = await admin.query(sql);
      if (sql === deriveSchemaComponents()[0].sql) response.rows = [];
      return response;
    }), /IMPORT_SCHEMA_COMPONENT_RESPONSE_INVALID/);
  } finally { await admin.query("ROLLBACK;"); }
  check(true, "SEGMENTED_MISSING_COMPONENT_FAIL_CLOSED_AND_ROLLBACK");
  const session = await createImportPostgresAdapter({ config })();
  try {
    await session.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;");
    await assert.rejects(read(sql => session.query(sql === deriveSchemaComponents()[0].sql ? "SELECT pg_sleep(10);" : sql, [], 50)),
      error => error.schemaComponentId === "RELATIONS_ACL" && /timeout/i.test(error.message));
    check(!session.connected, "SEGMENTED_COMPONENT_TIMEOUT_DISCONNECTS_NO_QUEUED_ROLLBACK");
    await assert.rejects(session.query("SELECT 1;"));
  } finally { await session.close(); }
  check(true, "SEGMENTED_COMPONENT_TIMEOUT_SAME_SESSION_CLEANUP_NO_RETRY");
  const identity = (await admin.query(IDENTITY_SQL)).rows[0];
  const identitySha256 = sha256(JSON.stringify({ database: identity.database, role: identity.role, port: identity.port, system_identifier: identity.system_identifier }));
  const raw = await createImportPostgresAdapter({ config })();
  const bounded = createSegmentedReadOnlySession({ session: raw, packet, expectedIdentity: identitySha256, deadline: performance.now() + 600000 });
  try {
    const report = await readImportReconciliation({ packet, prepared, session: bounded, expectedServerIdentitySha256: identitySha256 });
    check(bounded.evidence.schemaVerified && bounded.evidence.statements === 15 && bounded.evidence.selects === 13 && report.blockers.length === 0,
      "SEGMENTED_V4_GENUINE_LOCAL_ORDERED_SESSION_IDENTITY_PROOF_RECONCILIATION");
  } finally { await bounded.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(`SEGMENTED_SCHEMA_FOCUSED=PASS_${await runSegmentedSchemaUnitChecks()}`); }
  catch (error) { console.log(error instanceof assert.AssertionError ? error.message : "SEGMENTED_SCHEMA_FOCUSED=FAIL"); process.exitCode = 1; }
}
