import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { prepareImport, reconcileImport, verifyImport, safeImportFailure, canonical, sha256, key, buildImportBody } from "./lib/catalog-production-import.mjs";
import { validateAuthorization, claimImportAuthorization, executeImport } from "./lib/catalog-production-import-executor.mjs";
import { createImportPostgresAdapter } from "./lib/catalog-production-import-postgres.mjs";
import { runImportMain } from "./catalog-production-import-runner.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const prepared = await prepareImport(root);
assert.equal(prepared.sourceSha256, "3aa86ad35fc021f24056774ec4afda676035b1624ed58321c370ee6ab082368a");
assert.equal(prepared.knownValues, 829);
assert.equal(prepared.operations.filter(op => op.entity === "spec").length, 1488);
const empty = { devices: [], definitions: [], sources: [], sourceLinks: [], specs: [], evidence: [], auditEvents: [], auditActor: null };
const initial = reconcileImport(prepared, empty);
assert.equal(initial.blockers.length, 0);
assert.equal(initial.inserts.spec, 1488);
assert.equal(initial.inserts.device, 24);
assert.equal(initial.actions.length, 24 + 92 + 39 + 46 + 1488 + 15);
assert.equal(initial.actions.filter(a => a.classification === "INSERT_UNKNOWN").length, 659);
const claim = prepared.operations.find(op => op.entity === "evidence" && typeof op.row.claimedValue === "number").row;
assert.equal(key("evidence", claim), key("evidence", { ...claim, claimedValue: String(claim.claimedValue) }), "SQL_TEXT_CLAIM_IDENTITY_EQUIVALENCE");
const database = structuredClone(empty);
for (const { entity, row } of prepared.operations) {
  if (entity === "device") database.devices.push({ ...row, catalog_normalized: false });
  if (entity === "definition") database.definitions.push({ key: row.key, value_type: row.valueType, canonical_unit: row.canonicalUnit, measurement_context: row.measurementContext, comparison_mode: row.comparisonMode, require_same_context: row.requireSameContext, applicable_schema_types: row.applicableSchemaTypes });
  if (entity === "source") database.sources.push(row);
  if (entity === "sourceLink") database.sourceLinks.push(row);
  if (entity === "spec") database.specs.push({ deviceSlug: row.deviceSlug, definitionKey: row.definitionKey, region: row.region, variant: row.variant, state: row.state, value_number: row.valueNumber, value_boolean: row.valueBoolean, value_text: row.valueText, value_json: row.valueJson, raw_value: row.rawValue === null ? null : String(row.rawValue), canonical_unit: row.canonicalUnit, measurement_context: row.measurementContext });
  if (entity === "evidence") database.evidence.push({ deviceSlug: row.deviceSlug, definitionKey: row.definitionKey, sourceUrl: row.sourceUrl, claimed_value: String(row.claimedValue), is_primary: row.isPrimary, is_conflicting: row.isConflicting });
}
assert.equal(verifyImport(prepared, empty, database, initial), true, "SQL_TYPED_FACT_PLUS_ORIGINAL_RAW_TEXT_POSTCHECK");
assert.equal(reconcileImport(prepared, database).blockers.length, 0);
assert.ok(!/INSERT INTO/i.test(buildImportBody(prepared, reconcileImport(prepared, database))), "EXISTING_IDENTITIES_NEVER_REDISPATCH_INSERT_TRIGGERS");
const richer = structuredClone(database);
const richerSpec = richer.specs.find(s => s.state === "KNOWN" && s.value_text !== null);
richerSpec.value_text = "LOCAL_ADMIN_FACT"; richerSpec.updated_by = "LOCAL_ACTOR";
assert.ok(reconcileImport(prepared, richer).actions.some(a => a.classification === "PRESERVE_ADMIN_VALUE"));
assert.equal(verifyImport(prepared, richer, structuredClone(richer), reconcileImport(prepared, richer)), true);
const unavailable = structuredClone(database);
const unavailableSpec = unavailable.specs.find(s => s.state === "KNOWN" && s.value_text !== null);
unavailableSpec.state = "NOT_DISCLOSED"; unavailableSpec.value_text = null;
assert.ok(reconcileImport(prepared, unavailable).blockers.some(b => b.classification === "BLOCK_EXISTING_EMPTY_REQUIRES_ADJUDICATION"));
const changed = structuredClone(database); changed.specs[0].raw_value = "LOCAL_TAMPER";
assert.throws(() => verifyImport(prepared, database, changed, reconcileImport(prepared, database)), /EXISTING_ROW_CHANGED/);
const incompatible = structuredClone(database); incompatible.definitions[0].value_type = "invalid";
assert.ok(reconcileImport(prepared, incompatible).blockers.some(b => b.classification === "BLOCK_DEFINITION_INCOMPATIBLE"));
const large = { ...empty, sources: Array(50001).fill({ url: "local" }) };
assert.throws(() => reconcileImport(prepared, large), /SNAPSHOT_INVALID_OR_LIMIT/);
assert.ok(!/DO UPDATE|DELETE|REVOKE|catalog_normalized\s*=\s*true/i.test(prepared.sql));
assert.equal(prepared.sql, execFileSync("git", ["-C", root, "show", "HEAD:artifacts/qa/catalog-migration-packet-v1/canonical-import.sql"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }));
const dirty = Object.assign(new Error("postgresql://secret:password@private.invalid host credential"), { code: "28P01", detail: "secret" });
const diagnostic = safeImportFailure(dirty, "CONNECT", 10, false);
assert.equal(diagnostic.sqlstate, "28P01");
assert.ok(!JSON.stringify(diagnostic).includes("secret"));
assert.ok(!JSON.stringify(diagnostic).includes("private.invalid"));
assert.equal(safeImportFailure({ code: "anything_sensitive" }, "ATTACK", 0, false).sqlstate, "UNKNOWN");
assert.equal(safeImportFailure({}, "ATTACK", 0, false).operation, "UNKNOWN");
assert.equal(safeImportFailure({ importCode: "IMPORT_UNREVIEWED_PRIVATE_VALUE" }, "CONNECT", 0, false).failureClass, "DATABASE_OR_TRANSPORT_FAILURE");
assert.throws(() => verifyImport(prepared, empty, empty, initial), /IMPORT_POSTCHECK/);
assert.deepEqual(await runImportMain({ args: [] }), { status: "NOT_AUTHORIZED", connections: 0, importAttempts: 0, activationAttempts: 0 });
await assert.rejects(runImportMain({ args: ["--execute-production"], environment: {} }), /IMPORT_CLI_SCOPE/);
await assert.rejects(executeImport({ bundle: {}, open: () => assert.fail("UNAUTHORIZED_OPEN"), claim: () => assert.fail("UNAUTHORIZED_CLAIM") }), /VALIDATED_BUNDLE/);
const packet = { candidateHead: "a".repeat(40), checkoutSha256: "b".repeat(64) };
const auth = { format: "catalog-stage-c-authorization-v1", authorizationId: "stage-c-unit-test", packetSha256: sha256(canonical(packet)), candidateHead: packet.candidateHead,
  checkoutSha256: packet.checkoutSha256, targetClass: "SUPAVISOR_SESSION", serverIdentitySha256: "c".repeat(64), reconciliationSha256: "d".repeat(64),
  windowStartUTC: "2020-01-01T00:00:00Z", windowEndUTC: "2020-01-01T00:10:00Z", humanGates: { backupRecoveryReady: true, catalogWritesPaused: true, currentReaderCompatible: true,
    stageBCompleted: true, productionReconciliationReviewed: true, rollbackOperatorReady: true } };
validateAuthorization(auth, packet, Date.parse("2020-01-01T00:01:00Z"));
for (const [name, value] of [["candidateHead", "f".repeat(40)], ["packetSha256", "f".repeat(64)], ["checkoutSha256", "f".repeat(64)], ["targetClass", "DIRECT"], ["windowEndUTC", "2020-01-01T00:00:00Z"], ["windowStartUTC", "2020-01-01T00:00:00+12:00"]]) {
  assert.throws(() => validateAuthorization({ ...auth, [name]: value }, packet, Date.parse("2020-01-01T00:01:00Z")), /IMPORT_/);
}
for (const gate of Object.keys(auth.humanGates)) assert.throws(() => validateAuthorization({ ...auth, humanGates: { ...auth.humanGates, [gate]: false } }, packet, Date.parse("2020-01-01T00:01:00Z")), /HUMAN_GATE/);
assert.throws(() => validateAuthorization({ ...auth, unknown: true }, packet), /SHAPE_INVALID/);
let opens = 0;
class FailingClient { on() {} async connect() { opens++; throw dirty; } async end() {} }
const adapter = createImportPostgresAdapter({ config: {}, Client: FailingClient });
await assert.rejects(adapter(), error => error === dirty);
await assert.rejects(adapter(), /RECONNECT_FORBIDDEN/);
assert.equal(opens, 1);
const directory = await mkdtemp(path.join(os.tmpdir(), "ogh-import-claim-test-"));
try {
  execFileSync("git", ["init", directory], { stdio: "ignore" });
  await claimImportAuthorization(directory, "stage-c-test-consumption", "a".repeat(64));
  await assert.rejects(claimImportAuthorization(directory, "stage-c-test-consumption", "b".repeat(64)), /ALREADY_CLAIMED/);
  await assert.rejects(claimImportAuthorization(directory, "../outside", "a".repeat(64)), /CLAIM_INVALID/);
} finally { await rm(directory, { recursive: true, force: true }); }
console.log("STAGE_C_IMPORT_FOCUSED=PASS");
