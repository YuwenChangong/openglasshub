import assert from "node:assert/strict";
import { IDENTITY_SQL, STATE_SQL, schemaDigest } from "./lib/catalog-production-migration-transport.mjs";
import { deriveSchemaComponents } from "./lib/catalog-production-schema-diagnostics.mjs";
import { reconstructSchemaState } from "./lib/catalog-production-segmented-schema.mjs";
import { createSegmentedReadOnlySession, renderSegmentedReadOnlySql, V4_APPROVAL } from "./lib/catalog-production-segmented-readonly.mjs";
import { SNAPSHOT_SQL, sha256 } from "./lib/catalog-production-import.mjs";

const components = deriveSchemaComponents();
const ledger = ["public_device_detail_v1", "catalog_editor_presentation_v1"].map((name, i) => ({ name, version: ["20261004003349", "20261004014637"][i], statements: [`owned-${i}`] }));
const values = [...Array.from({ length: 8 }, () => []), { owner: "postgres", primaryKey: "PRIMARY KEY (version)", columns: [
  { name: "version", type: "text", notNull: true }, { name: "name", type: "text", notNull: false }, { name: "statements", type: "text[]", notNull: false },
] }, ledger, { devices: 0, specs: 0, audit: 0, published: 0, definitions: 0 }];
const packet = { stage2SchemaSha256: schemaDigest(reconstructSchemaState(components.map((c, i) => [c.id, values[i]]))), migrationHashes: ledger.map(l => sha256(l.statements[0])) };
const row = { database: "owned", role: "owned", port: 5432, system_identifier: "owned" };
const identity = sha256(JSON.stringify(row));
const sequence = ["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;", IDENTITY_SQL, ...components.map(c => c.sql), SNAPSHOT_SQL, "COMMIT;"];
let checks = 0;
const make = ({ fault, expectedIdentity = identity, deadline = 600000, now = () => 0 } = {}) => {
  const trace = [];
  const session = createSegmentedReadOnlySession({ packet, expectedIdentity, deadline, now, session: { connected: true, async close() {}, async query(sql, _, timeout) {
    trace.push({ sql, timeout });
    await fault?.(sql);
    if (sql === IDENTITY_SQL) return { rows: [row] };
    const index = components.findIndex(c => c.sql === sql);
    return { rows: [index < 0 ? { snapshot: {} } : { component: values[index] }] };
  } } });
  return { session, trace };
};
const run = async session => { for (const sql of sequence) await session.query(sql); };
try {
  const good = make(); await run(good.session);
  assert.equal(good.trace.length, 15); assert.equal(good.session.evidence.selects, 13);
  assert(good.session.evidence.schemaVerified && good.session.evidence.identity && good.session.evidence.snapshotCompleted);
  assert(!good.trace.some(q => q.sql === STATE_SQL)); checks++;
  assert(renderSegmentedReadOnlySql().includes("-- LEDGER_RECORDS"));
  assert.equal(V4_APPROVAL, "AUTHORIZE_STAGE_C_SEGMENTED_READ_ONLY_RECONCILIATION_V4"); checks++;
  for (const sql of ["BEGIN;", "SELECT 1;", STATE_SQL, "SET ROLE postgres;", "DELETE FROM public.devices;", sequence[0] + " SELECT 1;", "ROLLBACK;"]) {
    const bad = make(); await assert.rejects(bad.session.query(sql), /IMPORT_READ_ONLY_EXECUTION_CONTRACT/);
    assert.equal(bad.trace.length, 0); checks++;
  }
  const args = make(); await assert.rejects(args.session.query(sequence[0], ["unsafe"]));
  await assert.rejects(args.session.query(sequence[0], [], Infinity)); assert.equal(args.trace.length, 0); checks++;
  const wrong = make({ expectedIdentity: "a".repeat(64) });
  await wrong.session.query(sequence[0]); await assert.rejects(wrong.session.query(IDENTITY_SQL), /IDENTITY/);
  await assert.rejects(wrong.session.query(components[0].sql)); await wrong.session.query("ROLLBACK;", [], 5000);
  assert.equal(wrong.trace.at(-1).timeout, 5000); await assert.rejects(wrong.session.query("ROLLBACK;")); checks++;
  const original = new Error("Query read timeout");
  const failure = make({ fault: sql => { if (sql === components[1].sql) throw original; } });
  for (const sql of sequence.slice(0, 3)) await failure.session.query(sql);
  await assert.rejects(failure.session.query(components[1].sql), e => e === original);
  await failure.session.query("ROLLBACK;", [], 5000);
  assert.equal(failure.session.evidence.firstDiagnostic.componentId, "COLUMNS");
  assert.equal(failure.session.evidence.firstDiagnostic.failureClass, "CLIENT_QUERY_TIMEOUT"); checks++;
  const expired = make({ deadline: 1, now: () => 2 }); await assert.rejects(expired.session.query(sequence[0])); assert.equal(expired.trace.length, 0); checks++;
  const cap = make({ deadline: 7 }); await cap.session.query(sequence[0], [], 999999); assert.equal(cap.trace[0].timeout, 7); checks++;
  const closed = make(); await closed.session.close(); await assert.rejects(closed.session.query(sequence[0])); checks++;
  const terminated = make();
  for (const sql of sequence.slice(0, 13)) await terminated.session.query(sql);
  await terminated.session.query("ROLLBACK;");
  await assert.rejects(terminated.session.query(SNAPSHOT_SQL), /IMPORT_READ_ONLY_EXECUTION_CONTRACT/, "ROLLBACK_TERMINATES_PROOF_SEQUENCE"); checks++;
  const drift = make(); await drift.session.query(sequence[0]); await drift.session.query(IDENTITY_SQL);
  const old = ledger[0].name; ledger[0].name = "UNREVIEWED";
  try {
    for (const c of components.slice(0, -1)) await drift.session.query(c.sql);
    await assert.rejects(drift.session.query(components.at(-1).sql), /STAGE2/);
    await assert.rejects(drift.session.query(SNAPSHOT_SQL)); assert(!drift.session.evidence.schemaVerified);
    await drift.session.query("ROLLBACK;"); checks++;
  } finally { ledger[0].name = old; }
  console.log(`SEGMENTED_READONLY_FOCUSED=PASS_${checks}`);
} catch (error) { console.log(error instanceof assert.AssertionError ? error.message : "SEGMENTED_READONLY_FOCUSED=FAIL"); process.exitCode = 1; }
