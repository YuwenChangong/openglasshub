import { createDisposablePostgresTransactionClient, parseSchemaV1SqlState, readSchemaV1SqlState, readSchemaV1SqlVerification } from "../devices/schema-v1/disposable-postgres-transaction-client.mjs";

const TABLES = Object.freeze({ devices: "devices", deviceSpecDefinitions: "device_spec_definitions", deviceSpecs: "device_specs", deviceSources: "device_sources", deviceSourceLinks: "device_source_links", deviceSpecEvidence: "device_spec_evidence", catalogAuditEvents: "catalog_audit_events" });
const TABLE_NAMES = Object.values(TABLES);
const quoted = (values) => values.map((value) => `'${value}'`).join(", ");
const COUNTS_SQL = `jsonb_build_object(${Object.entries(TABLES).map(([key, table]) => `'${key}', (SELECT count(*)::int FROM public.${table})`).join(",\n")})`;
const SCHEMA_SQL = `
  (SELECT count(*) = 6 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN (${quoted(TABLE_NAMES.slice(1))}) AND c.relkind = 'r' AND c.relrowsecurity)
  AND (SELECT count(*) = 7 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e' AND t.typname IN ('device_schema_type', 'device_presentation_profile', 'device_spec_value_type', 'device_spec_state', 'device_spec_confidence', 'device_spec_comparison_mode', 'device_source_type'))
  AND (SELECT count(*) = 7 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'devices' AND column_name IN ('generation', 'schema_type', 'device_type', 'presentation_profile', 'status', 'release_date', 'last_verified_at'))
  AND (SELECT count(*) = 22 FROM pg_policies WHERE schemaname = 'public' AND tablename IN (${quoted(TABLE_NAMES.slice(1))}))
  AND NOT EXISTS (SELECT 1 FROM (VALUES ('enforce_device_spec_definition'), ('prevent_incompatible_device_schema_change'), ('prevent_device_spec_definition_semantic_change'), ('serialize_device_spec_evidence_change'), ('validate_device_spec_conflict_evidence'), ('prevent_catalog_audit_mutation'), ('is_catalog_admin')) expected(name) WHERE to_regprocedure('public.' || expected.name || '()') IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM (VALUES ('device_specs', 'enforce_device_spec_definition'), ('devices', 'prevent_incompatible_device_schema_change'), ('device_spec_definitions', 'prevent_device_spec_definition_semantic_change'), ('device_spec_evidence', 'serialize_device_spec_evidence_change'), ('device_specs', 'device_specs_conflict_evidence'), ('device_spec_evidence', 'device_spec_evidence_conflict'), ('catalog_audit_events', 'catalog_audit_events_append_only')) expected(table_name, trigger_name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || expected.table_name) AND t.tgname = expected.trigger_name AND NOT t.tgisinternal AND t.tgenabled <> 'D'))
  AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = ANY(ARRAY[${TABLE_NAMES.map((table) => `'public.${table}'::regclass`).join(", ")}]) AND NOT c.convalidated)`;
const PRECHECK_SQL = `SELECT encode(convert_to(jsonb_build_object(
  'releaseAHistory', CASE WHEN (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name = 'device_schema_v1_foundation') = 1 THEN 'PRESENT' ELSE 'MISSING' END,
  'schemaPostconditions', CASE WHEN ${SCHEMA_SQL} THEN 'PASS' ELSE 'FAIL' END,
  'releaseBApplied', EXISTS (SELECT 1 FROM public.devices),
  'counts', ${COUNTS_SQL}
)::text, 'UTF8'), 'hex') AS payload;`;
// Relation locks cover empty tables too, and conflict with ordinary INSERT/UPDATE/DELETE.
// The migration ledger is only read and locked; this adapter never writes it.
const LOCKED_PRECHECK_SQL = `LOCK TABLE ${TABLE_NAMES.map((table) => `public.${table}`).join(", ")}, supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;\n${PRECHECK_SQL}`;

/** Test-only transport: the replay owns the local SQL closures; the target identity is simulated. */
export function createReleaseBDisposableTransport({ executeSql, createSession } = {}) {
  if (typeof createSession !== "function") throw new TypeError("Owned disposable PostgreSQL session factory is required");
  const client = createDisposablePostgresTransactionClient({ executeSql, createSession });
  return Object.freeze({
    async identifyTarget() { return { projectRef: "xcbnxzjlsvtgzixurcof", targetClass: "OpenGlass Hub Supabase Production" }; },
    async readPrecheck() { return parseSchemaV1SqlState(await executeSql(PRECHECK_SQL)); },
    async transaction(work) {
      return client.transaction((transaction) => work(Object.freeze({
        ...transaction,
        async readPrecheckForUpdate() { return transaction.readPrecheckForUpdate(LOCKED_PRECHECK_SQL); },
      })));
    },
    async readPostcheck() {
      const verification = await readSchemaV1SqlVerification({ executeSql });
      const state = await readSchemaV1SqlState({ executeSql });
      return {
        counts: { devices: verification.devices, deviceSpecDefinitions: verification.definitions, deviceSpecs: verification.specs, deviceSources: verification.sources, deviceSourceLinks: verification.sourceLinks, deviceSpecEvidence: verification.evidence, catalogAuditEvents: verification.auditEvents },
        uniqueSlugs: verification.uniqueSlugs, publishedDevices: verification.published,
        conflictInvariants: [verification.constraintFailures, verification.triggerFailures, verification.duplicateFailures, verification.conflictEvidenceFailures, verification.unknownUnverifiedKnownData].every((count) => count === 0) ? "PASS" : "FAIL",
        rayBanIdentity: state.devices.find((device) => device.slug === "ray-ban-meta")?.slug,
        unexpectedDeletes: 0, // The executor's immutable seven-entity plan has no delete operation.
      };
    },
  });
}
