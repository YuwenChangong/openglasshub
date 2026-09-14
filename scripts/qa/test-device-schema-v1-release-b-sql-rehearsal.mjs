import assert from "node:assert/strict";
import { runLocalSchemaV1Import } from "../devices/import-device-schema-v1.mjs";
import {
  createDisposablePostgresTransactionClient,
  parseSchemaV1SqlState,
  readSchemaV1SqlState,
  readSchemaV1SqlVerification,
} from "../devices/schema-v1/disposable-postgres-transaction-client.mjs";
import { adaptSqlStateForRecoveryPlan, assertReleaseBSqlRehearsalReceipt } from "./device-schema-v1-release-b-sql-rehearsal.mjs";

const entries = [
  ["definition", "display.refresh_rate_hz", {
    key: "display.refresh_rate_hz", groupKey: "display", label: "Refresh rate", helpText: null,
    valueType: "number", canonicalUnit: "Hz", measurementContext: "maximum", comparisonMode: "higher",
    requireSameContext: true, applicableSchemaTypes: ["display_ar"], isCore: true, adminOrder: 1, isActive: true,
  }],
  ["device", "example-viewer", {
    slug: "example-viewer", brand_key: "example", brand_name: "Example", name: "Example Viewer",
    short_description: "Short", long_description: "Long", positioning: null, release_year: "2026", availability: null,
    type_label: "Display", status_label: "Current", media: { imageAlt: "O'Brien" }, product_image_url: null,
    official_image_url: null, image_alt: "Example Viewer", product_url: null, official_product_url: "https://example.test/viewer",
    buy_url: null, category: "display", route_label: "Display", route_description: "Route", best_for: ["Tests"],
    not_ideal_for: [], key_limitations: [], key_specs: [], full_specs: {}, publication_status: "published",
    generation: "One", schema_type: "display_ar", device_type: "AR glasses", status: "Current",
  }],
  ["source", "https://example.test/source", {
    url: "https://example.test/source", publisher: "Example", title: "O'Brien", sourceType: "official_spec_sheet",
    publishedAt: null, accessedAt: "2026-09-14", region: "Global",
  }],
  ["sourceLink", "example-viewer\u0000https://example.test/source", {
    deviceSlug: "example-viewer", sourceUrl: "https://example.test/source", isPrimary: false,
  }],
  ["spec", "example-viewer\u0000display.refresh_rate_hz\u0000Global\u0000", {
    deviceSlug: "example-viewer", definitionKey: "display.refresh_rate_hz", state: "KNOWN", valueNumber: 120,
    valueBoolean: null, valueText: null, valueJson: null, canonicalUnit: "Hz", measurementContext: "maximum",
    rawValue: "120 Hz", region: "Global", variant: "", confidence: "HIGH", verifiedAt: "2026-09-14",
  }],
  ["compatibility", "example-viewer", {
    deviceSlug: "example-viewer", key_specs: [{ field: "display.refresh_rate_hz", label: "Refresh rate", value: "120 Hz" }],
    full_specs: { display: { refresh_rate_hz: "120 Hz" } }, compatibilityGaps: [],
    BOOTSTRAP_SPEC_VALUES_AUTHORITATIVE: false, LEGACY_COMPAT_SPEC_SOURCE: "YAML_DERIVED",
  }],
];
const plan = { delete: "NONE", entries: entries.map(([entity, key, desired]) => ({ entity, key, desired, existing: null, operation: "INSERT", blockers: [] })) };

const transcripts = [];
const receipt = await runLocalSchemaV1Import({
  target: "http://127.0.0.1:54321",
  plan,
  createClient: async () => createDisposablePostgresTransactionClient({
    executeSql: async (sql) => { transcripts.push(sql); return ""; },
  }),
});
assert.equal(transcripts.length, 1, "the importer emits one SQL transaction transcript");
assert.match(transcripts[0], /^BEGIN;/);
assert.match(transcripts[0], /COMMIT;\s*$/);
assert.doesNotMatch(transcripts[0], /\b(?:delete|truncate)\b/i);
assert.ok(transcripts[0].indexOf("device_spec_definitions") < transcripts[0].indexOf("public.devices"));
assert.ok(transcripts[0].indexOf("public.devices") < transcripts[0].indexOf("device_sources"));
assert.match(transcripts[0], /O''Brien/, "SQL string values are quoted without changing the importer row");
assert.deepEqual(receipt.operations, { definition: 1, device: 1, source: 1, sourceLink: 1, spec: 1, evidence: 0, compatibility: 1 });

await assert.rejects(
  () => createDisposablePostgresTransactionClient({ executeSql: async () => { throw new Error("late SQL constraint failure"); } }).transaction(async (transaction) => {
    for (const [entity, , row] of entries) await transaction.upsert(entity, row);
  }),
  /late SQL constraint failure/,
  "a late PostgreSQL failure rejects the importer transaction",
);

const state = { definitions: [], devices: [{ slug: "example-viewer" }], sources: [], sourceLinks: [], specs: [], evidence: [], compatibility: [] };
const csv = `payload\n${Buffer.from(JSON.stringify(state), "utf8").toString("hex")}\n`;
assert.deepEqual(parseSchemaV1SqlState(csv), state, "the owned psql CSV state envelope is decoded without an in-memory catalog substitute");
let stateQuery = "";
assert.deepEqual(await readSchemaV1SqlState({ executeSql: async (sql) => { stateQuery = sql; return csv; } }), state);
for (const table of ["devices", "device_spec_definitions", "device_specs", "device_sources", "device_source_links", "device_spec_evidence", "catalog_audit_events"]) {
  assert.match(stateQuery, new RegExp(`public\\.${table}`), `the SQL state receipt reads ${table} from PostgreSQL`);
}
const verification = { devices: 24, uniqueSlugs: 24, published: 24, definitions: 92, specs: 1488, sources: 39, sourceLinks: 46, evidence: 15, auditEvents: 0, constraintFailures: 0, triggerFailures: 0, duplicateFailures: 0, conflictEvidenceFailures: 0, unknownUnverifiedKnownData: 0 };
const verificationCsv = `payload\n${Buffer.from(JSON.stringify(verification), "utf8").toString("hex")}\n`;
let verificationQuery = "";
assert.deepEqual(await readSchemaV1SqlVerification({ executeSql: async (sql) => { verificationQuery = sql; return verificationCsv; } }), verification);
assert.match(verificationQuery, /pg_catalog\.pg_trigger/, "the SQL receipt verifies that migration-created triggers remain enabled");
assert.match(verificationQuery, /state = 'CONFLICT'/, "the SQL receipt verifies deferred conflict evidence in committed state");

const validReceipt = {
  format: "openglass-device-schema-v1-release-b-sql-rehearsal-v1",
  status: "PASS",
  target: "LOCAL_DISPOSABLE_SQL",
  disposableSupabase: true,
  fullCanonicalMigrationChain: true,
  releaseASchemaPresent: true,
  manuallyRecreatedSchemaObjects: 0,
  yamlDeviceCount: 24,
  identityMapCount: 24,
  unresolvedIdentities: 0,
  unresolvedEvidenceMaps: 0,
  dryRunBlocked: 0,
  dryRunDelete: "NONE",
  transactionResult: "COMMIT",
  counts: verification,
  sqlConstraintFailures: 0,
  sqlTriggerFailures: 0,
  deleteOperations: 0,
  conflictEvidenceFailures: 0,
  duplicateFailures: 0,
  unknownUnverifiedKnownData: 0,
  legacyYamlDerived: true,
  invalidPayloadResult: "FAIL",
  invalidPayloadSqlState: "23514",
  rowsCommittedAfterFailure: 0,
  transactionRollbackAtomicity: "PASS",
  secondRunBlocked: 0,
  secondRunDelete: "NONE",
  secondRunOperations: { definition: 0, device: 0, source: 0, sourceLink: 0, spec: 0, evidence: 0, compatibility: 0 },
  productCompatibilityLocal: "PASS",
};
assert.equal(assertReleaseBSqlRehearsalReceipt(validReceipt), true);
for (const invalid of [
  { counts: { ...verification, specs: 1487 } },
  { rowsCommittedAfterFailure: 1 },
  { secondRunOperations: { ...validReceipt.secondRunOperations, spec: 1 } },
  { sqlTriggerFailures: 1 },
  { productCompatibilityLocal: "BLOCKED" },
]) {
  assert.throws(() => assertReleaseBSqlRehearsalReceipt({ ...validReceipt, ...invalid }), /RELEASE_B_SQL_REHEARSAL_RECEIPT_INVALID/);
}
const textEncodedPlan = { entries: [
  { entity: "spec", desired: { deviceSlug: "example-viewer", definitionKey: "display.refresh_rate_hz", region: "Global", variant: "", rawValue: 120 } },
  { entity: "evidence", desired: { deviceSlug: "example-viewer", definitionKey: "display.refresh_rate_hz", sourceUrl: "https://example.test/source", claimedValue: 120 } },
] };
const textEncodedState = { definitions: [], devices: [], sources: [], sourceLinks: [], compatibility: [], specs: [{ ...textEncodedPlan.entries[0].desired, rawValue: "120" }], evidence: [{ ...textEncodedPlan.entries[1].desired, claimedValue: "120" }] };
const adapted = adaptSqlStateForRecoveryPlan(textEncodedState, textEncodedPlan);
assert.equal(adapted.specs[0].rawValue, 120, "the adapter restores the importer value type after PostgreSQL raw_value text encoding");
assert.equal(adapted.evidence[0].claimedValue, 120, "the adapter restores the importer value type after PostgreSQL claimed_value text encoding");

console.log("DEVICE_SCHEMA_V1_RELEASE_B_SQL_ADAPTER_OK");
