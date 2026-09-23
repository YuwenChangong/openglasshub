import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

import { parseP9Connection } from "../p9-readonly-postgres-transport.mjs";

const { Client: PgClient } = pg;
export const RELEASE_B_PRODUCTION_CA_CERT_PATH_ENV = "P9_PRODUCTION_DATABASE_CA_CERT_PATH";
const CERTIFICATE_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const RELEASE_B_PRODUCTION_DATABASE_ROLE = "postgres";

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

function withReleaseBProductionDatabaseRole(connection) {
  if (connection?.safeTarget?.database !== "postgres") throw failure("PRODUCTION_CONNECTION_SOURCE_UNAVAILABLE");
  return Object.freeze({
    ...connection,
    safeTarget: Object.freeze({
      ...connection.safeTarget,
      databaseRole: RELEASE_B_PRODUCTION_DATABASE_ROLE,
    }),
  });
}

async function loadVerifiedCa(environment) {
  const caPath = environment?.[RELEASE_B_PRODUCTION_CA_CERT_PATH_ENV];
  if (typeof caPath !== "string" || !caPath.trim()) throw failure("RELEASE_B_POSTGRES_ADAPTER_CA_CERT_PATH_REQUIRED");

  let pem;
  try {
    pem = await readFile(caPath, "utf8");
  } catch {
    throw failure("RELEASE_B_POSTGRES_ADAPTER_CA_CERT_UNREADABLE");
  }

  const blocks = pem.match(CERTIFICATE_BLOCK) ?? [];
  if (blocks.length === 0 || pem.replace(CERTIFICATE_BLOCK, "").trim()) throw failure("RELEASE_B_POSTGRES_ADAPTER_CA_CERT_INVALID");

  try {
    for (const block of blocks) new X509Certificate(block);
  } catch {
    throw failure("RELEASE_B_POSTGRES_ADAPTER_CA_CERT_INVALID");
  }

  return pem;
}

function createClientConfig(pgEnv, ca) {
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
      ca,
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
    databaseRole: safeTarget.databaseRole,
    endpointClass: safeTarget.endpointClass,
  });
}

const POSTCHECK_SQL = `WITH
required_triggers(table_name, trigger_name) AS (VALUES
  ('device_specs', 'enforce_device_spec_definition'),
  ('devices', 'prevent_incompatible_device_schema_change'),
  ('device_spec_definitions', 'prevent_device_spec_definition_semantic_change'),
  ('device_spec_evidence', 'serialize_device_spec_evidence_change'),
  ('device_specs', 'device_specs_conflict_evidence'),
  ('device_spec_evidence', 'device_spec_evidence_conflict'),
  ('catalog_audit_events', 'catalog_audit_events_append_only')
),
trigger_failures AS (
  SELECT count(*)::int AS value FROM required_triggers required
  LEFT JOIN pg_catalog.pg_class relation ON relation.relname = required.table_name
  LEFT JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace AND namespace.nspname = 'public'
  LEFT JOIN pg_catalog.pg_trigger trigger ON trigger.tgrelid = relation.oid AND trigger.tgname = required.trigger_name AND NOT trigger.tgisinternal AND trigger.tgenabled <> 'D'
  WHERE trigger.oid IS NULL
),
conflict_failures AS (
  SELECT count(*)::int AS value FROM public.device_specs spec
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE evidence.is_primary AND NOT evidence.is_conflicting) AS primary_count,
      count(*) FILTER (WHERE NOT evidence.is_primary AND evidence.is_conflicting) AS conflicting_count
    FROM public.device_spec_evidence evidence WHERE evidence.device_spec_id = spec.id
  ) evidence_counts ON true
  WHERE (spec.state = 'CONFLICT' AND (evidence_counts.primary_count <> 1 OR evidence_counts.conflicting_count < 1))
    OR (spec.state <> 'CONFLICT' AND evidence_counts.conflicting_count <> 0)
),
spec_contract_failures AS (
  SELECT count(*)::int AS value FROM public.device_specs spec
  JOIN public.device_spec_definitions definition ON definition.id = spec.spec_definition_id
  JOIN public.devices device ON device.id = spec.device_id
  WHERE ((spec.state = 'KNOWN' AND num_nonnulls(spec.value_number, spec.value_boolean, spec.value_text, spec.value_json) <> 1)
      OR (spec.state IN ('NOT_DISCLOSED', 'NOT_APPLICABLE', 'UNKNOWN_UNVERIFIED') AND num_nonnulls(spec.value_number, spec.value_boolean, spec.value_text, spec.value_json) <> 0)
      OR (spec.state = 'CONFLICT' AND (num_nonnulls(spec.value_number, spec.value_boolean, spec.value_text, spec.value_json) > 1 OR spec.raw_value IS NULL OR spec.raw_value !~ '[^[:space:]]'))
      OR (spec.value_number IS NOT NULL AND definition.value_type <> 'number')
      OR (spec.value_boolean IS NOT NULL AND definition.value_type <> 'boolean')
      OR (spec.value_text IS NOT NULL AND definition.value_type <> 'text')
      OR (spec.value_json IS NOT NULL AND definition.value_type <> 'json')
      OR spec.canonical_unit IS DISTINCT FROM definition.canonical_unit
      OR spec.measurement_context IS DISTINCT FROM definition.measurement_context
      OR (device.schema_type = ANY(definition.applicable_schema_types)) IS NOT TRUE)
),
catalog_constraint_failures AS (
  SELECT count(*)::int AS value FROM pg_catalog.pg_constraint constraint_row
  JOIN pg_catalog.pg_class relation ON relation.oid = constraint_row.conrelid
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname IN ('devices', 'device_spec_definitions', 'device_specs', 'device_sources', 'device_source_links', 'device_spec_evidence', 'catalog_audit_events')
    AND NOT constraint_row.convalidated
),
duplicate_failures AS (
  SELECT (
    (SELECT count(*) - count(DISTINCT slug) FROM public.devices)
    + (SELECT count(*) - count(DISTINCT key) FROM public.device_spec_definitions)
    + (SELECT count(*) - count(DISTINCT url) FROM public.device_sources)
    + (SELECT count(*) - count(DISTINCT (device_id, spec_definition_id, region_key, variant_key)) FROM public.device_specs)
    + (SELECT count(*) - count(DISTINCT (device_id, source_id)) FROM public.device_source_links)
    + (SELECT count(*) - count(DISTINCT (device_spec_id, source_id, claimed_value)) FROM public.device_spec_evidence)
  )::int AS value
),
unknown_value_failures AS (
  SELECT count(*)::int AS value FROM public.device_specs
  WHERE state = 'UNKNOWN_UNVERIFIED' AND num_nonnulls(value_number, value_boolean, value_text, value_json) <> 0
)
SELECT
  (SELECT count(*)::int FROM public.devices) AS devices,
  (SELECT count(*)::int FROM public.device_spec_definitions) AS device_spec_definitions,
  (SELECT count(*)::int FROM public.device_specs) AS device_specs,
  (SELECT count(*)::int FROM public.device_sources) AS device_sources,
  (SELECT count(*)::int FROM public.device_source_links) AS device_source_links,
  (SELECT count(*)::int FROM public.device_spec_evidence) AS device_spec_evidence,
  (SELECT count(*)::int FROM public.catalog_audit_events) AS catalog_audit_events,
  (SELECT count(DISTINCT slug)::int FROM public.devices) AS unique_slugs,
  (SELECT count(*)::int FROM public.devices WHERE publication_status = 'published') AS published_devices,
  (SELECT catalog_constraint_failures.value + spec_contract_failures.value + conflict_failures.value FROM catalog_constraint_failures, spec_contract_failures, conflict_failures) AS constraint_failures,
  (SELECT value FROM trigger_failures) AS trigger_failures,
  (SELECT value FROM duplicate_failures) AS duplicate_failures,
  (SELECT value FROM conflict_failures) AS conflict_evidence_failures,
  (SELECT value FROM unknown_value_failures) AS unknown_unverified_known_data,
  (SELECT slug FROM public.devices WHERE slug = 'ray-ban-meta' LIMIT 1) AS ray_ban_identity,
  (SELECT count(*)::int FROM public.catalog_audit_events WHERE upper(action) = concat(chr(68), chr(69), chr(76), chr(69), chr(84), chr(69))) AS unexpected_deletes;`;

function rows(result) {
  if (!Array.isArray(result?.rows)) throw failure("RELEASE_B_POSTGRES_ADAPTER_POSTCHECK_RESULT_INVALID");
  return result.rows;
}

function numberField(row, key) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value)) throw failure("RELEASE_B_POSTGRES_ADAPTER_POSTCHECK_RESULT_INVALID");
  return value;
}

export function createReleaseBProductionPostgresAdapter({ environment = process.env, Client = PgClient } = {}) {
  async function createSession(input = null) {
    const connection = input ?? parseEnvironment(environment);
    assertSessionPooler(connection.safeTarget);
    const { pgEnv, safeTarget } = withReleaseBProductionDatabaseRole(connection);
    const ca = await loadVerifiedCa(environment);
    const client = new Client(createClientConfig(pgEnv, ca));
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

  async function readPostcheck({ queryReadOnly } = {}) {
    if (typeof queryReadOnly !== "function") throw failure("RELEASE_B_POSTGRES_ADAPTER_POSTCHECK_READER_REQUIRED");
    const row = rows(await queryReadOnly(POSTCHECK_SQL, []))[0];
    if (!row || typeof row !== "object") throw failure("RELEASE_B_POSTGRES_ADAPTER_POSTCHECK_RESULT_INVALID");
    const invariantFailures = [
      "constraint_failures",
      "trigger_failures",
      "duplicate_failures",
      "conflict_evidence_failures",
      "unknown_unverified_known_data",
    ].map((key) => numberField(row, key));

    return {
      counts: {
        devices: numberField(row, "devices"),
        deviceSpecDefinitions: numberField(row, "device_spec_definitions"),
        deviceSpecs: numberField(row, "device_specs"),
        deviceSources: numberField(row, "device_sources"),
        deviceSourceLinks: numberField(row, "device_source_links"),
        deviceSpecEvidence: numberField(row, "device_spec_evidence"),
        catalogAuditEvents: numberField(row, "catalog_audit_events"),
      },
      uniqueSlugs: numberField(row, "unique_slugs"),
      publishedDevices: numberField(row, "published_devices"),
      conflictInvariants: invariantFailures.every((value) => value === 0) ? "PASS" : "FAIL",
      rayBanIdentity: row.ray_ban_identity ?? null,
      unexpectedDeletes: numberField(row, "unexpected_deletes"),
    };
  }

  return Object.freeze({ createSession, readPostcheck });
}
