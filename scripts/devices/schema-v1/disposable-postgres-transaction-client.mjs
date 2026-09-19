const ENTITY_ORDER = Object.freeze(["definition", "device", "source", "sourceLink", "spec", "evidence", "compatibility"]);

function requiredRow(row, entity) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new TypeError(`${entity} SQL row must be an object`);
  return row;
}

function text(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function boolean(value) {
  if (typeof value !== "boolean") throw new TypeError("SQL boolean value is required");
  return value ? "TRUE" : "FALSE";
}

function number(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("Finite SQL number value is required");
  return String(value);
}

function json(value) {
  return value === null || value === undefined ? "NULL" : `${text(JSON.stringify(value))}::jsonb`;
}

function schemaTypes(value) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("At least one applicable schema type is required");
  return `ARRAY[${value.map(text).join(", ")}]::public.device_schema_type[]`;
}

function insertUpsert({ table, columns, values, conflict, updates }) {
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")}) ON CONFLICT (${conflict.join(", ")}) DO UPDATE SET ${updates.map((column) => `${column} = EXCLUDED.${column}`).join(", ")};`;
}

function definitionSql(input) {
  const row = requiredRow(input, "definition");
  const columns = ["key", "group_key", "label", "help_text", "value_type", "canonical_unit", "measurement_context", "comparison_mode", "require_same_context", "applicable_schema_types", "is_core", "admin_order", "is_active"];
  return insertUpsert({
    table: "public.device_spec_definitions",
    columns,
    values: [text(row.key), text(row.groupKey), text(row.label), text(row.helpText), text(row.valueType), text(row.canonicalUnit), text(row.measurementContext), text(row.comparisonMode), boolean(row.requireSameContext), schemaTypes(row.applicableSchemaTypes), boolean(row.isCore), number(row.adminOrder), boolean(row.isActive)],
    conflict: ["key"],
    updates: columns.slice(1),
  });
}

const DEVICE_COLUMNS = Object.freeze([
  "slug", "brand_key", "brand_name", "name", "short_description", "long_description", "positioning", "release_year", "availability",
  "type_label", "status_label", "media", "product_image_url", "official_image_url", "image_alt", "product_url", "official_product_url", "buy_url",
  "category", "route_label", "route_description", "best_for", "not_ideal_for", "key_limitations", "key_specs", "full_specs", "publication_status",
  "generation", "schema_type", "device_type", "status",
]);

function deviceSql(input) {
  const row = requiredRow(input, "device");
  const values = DEVICE_COLUMNS.map((column) => {
    if (["media", "best_for", "not_ideal_for", "key_limitations", "key_specs", "full_specs"].includes(column)) return json(row[column]);
    return text(row[column]);
  });
  return insertUpsert({ table: "public.devices", columns: DEVICE_COLUMNS, values, conflict: ["slug"], updates: DEVICE_COLUMNS.slice(1) });
}

function sourceSql(input) {
  const row = requiredRow(input, "source");
  const columns = ["url", "publisher", "title", "source_type", "published_at", "accessed_at", "region"];
  return insertUpsert({
    table: "public.device_sources",
    columns,
    values: [text(row.url), text(row.publisher), text(row.title), text(row.sourceType), text(row.publishedAt), text(row.accessedAt), text(row.region)],
    conflict: ["url"],
    updates: columns.slice(1),
  });
}

function sourceLinkSql(input) {
  const row = requiredRow(input, "sourceLink");
  return `INSERT INTO public.device_source_links (device_id, source_id, is_primary) VALUES ((SELECT id FROM public.devices WHERE slug = ${text(row.deviceSlug)}), (SELECT id FROM public.device_sources WHERE url = ${text(row.sourceUrl)}), ${boolean(row.isPrimary)}) ON CONFLICT (device_id, source_id) DO UPDATE SET is_primary = EXCLUDED.is_primary;`;
}

function specSql(input) {
  const row = requiredRow(input, "spec");
  const columns = ["device_id", "spec_definition_id", "state", "value_number", "value_boolean", "value_text", "value_json", "canonical_unit", "measurement_context", "raw_value", "region", "variant", "confidence", "verified_at"];
  const values = [
    `(SELECT id FROM public.devices WHERE slug = ${text(row.deviceSlug)})`,
    `(SELECT id FROM public.device_spec_definitions WHERE key = ${text(row.definitionKey)})`,
    text(row.state), number(row.valueNumber), row.valueBoolean === null || row.valueBoolean === undefined ? "NULL" : boolean(row.valueBoolean),
    text(row.valueText), json(row.valueJson), text(row.canonicalUnit), text(row.measurementContext), text(row.rawValue), text(row.region), text(row.variant),
    text(row.confidence), text(row.verifiedAt),
  ];
  return insertUpsert({
    table: "public.device_specs",
    columns,
    values,
    conflict: ["device_id", "spec_definition_id", "region_key", "variant_key"],
    updates: columns.slice(2),
  });
}

function evidenceSql(input) {
  const row = requiredRow(input, "evidence");
  const specId = `(SELECT s.id FROM public.device_specs s JOIN public.devices d ON d.id = s.device_id JOIN public.device_spec_definitions def ON def.id = s.spec_definition_id WHERE d.slug = ${text(row.deviceSlug)} AND def.key = ${text(row.definitionKey)} AND s.region_key = 'Global' AND s.variant_key = '')`;
  return `INSERT INTO public.device_spec_evidence (device_spec_id, source_id, claimed_value, is_primary, is_conflicting) VALUES (${specId}, (SELECT id FROM public.device_sources WHERE url = ${text(row.sourceUrl)}), ${text(row.claimedValue)}, ${boolean(row.isPrimary)}, ${boolean(row.isConflicting)}) ON CONFLICT (device_spec_id, source_id, claimed_value) DO UPDATE SET is_primary = EXCLUDED.is_primary, is_conflicting = EXCLUDED.is_conflicting;`;
}

function compatibilitySql(input) {
  const row = requiredRow(input, "compatibility");
  return `DO $openglass_compat$ BEGIN UPDATE public.devices SET key_specs = ${json(row.key_specs)}, full_specs = ${json(row.full_specs)} WHERE slug = ${text(row.deviceSlug)}; IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_SCHEMA_V1_COMPATIBILITY_DEVICE_MISSING'; END IF; END $openglass_compat$;`;
}

const RENDERERS = Object.freeze({
  definition: definitionSql,
  device: deviceSql,
  source: sourceSql,
  sourceLink: sourceLinkSql,
  spec: specSql,
  evidence: evidenceSql,
  compatibility: compatibilitySql,
});

export function createDisposablePostgresTransactionClient({ executeSql, createSession }) {
  if (typeof executeSql !== "function") throw new TypeError("Owned disposable SQL executor is required");
  return Object.freeze({
    async transaction(work) {
      if (typeof work !== "function") throw new TypeError("Transaction work callback is required");
      const writes = [];
      const session = createSession ? await createSession() : null;
      let failure;
      try {
        if (session) await session.query("BEGIN;\nSET CONSTRAINTS ALL DEFERRED;");
        await work(Object.freeze({
          async readPrecheckForUpdate(sql) {
            if (!session) throw new Error("RELEASE_B_TRANSACTION_SESSION_REQUIRED");
            if (typeof sql !== "string" || !sql.trim()) throw new TypeError("Disposable transaction precheck SQL is required");
            if (writes.length) throw new Error("RELEASE_B_PRECHECK_MUST_PRECEDE_WRITES");
            return parseSchemaV1SqlState(await session.query(sql));
          },
          async upsert(entity, row) {
            if (!ENTITY_ORDER.includes(entity)) throw new TypeError(`Unsupported disposable SQL entity: ${entity}`);
            writes.push([entity, row]);
          },
        }));
        const statements = writes.map(([entity, row]) => RENDERERS[entity](row));
        if (session) await session.query([...statements, "COMMIT;", ""].join("\n"));
        else await executeSql(["BEGIN;", "SET CONSTRAINTS ALL DEFERRED;", ...statements, "COMMIT;", ""].join("\n"));
      } catch (error) {
        failure = error;
        if (session) try { await session.query("ROLLBACK;"); } catch { /* Connection closure also aborts the open transaction. */ }
        throw error;
      } finally {
        if (session) try { await session.close(); } catch (error) { if (!failure) throw error; }
      }
    },
  });
}

export function parseSchemaV1SqlState(csv) {
  const lines = String(csv).trim().split(/\r?\n/);
  if (lines.length !== 2 || lines[0] !== "payload" || !/^[a-f0-9]+$/i.test(lines[1]) || lines[1].length % 2 !== 0) {
    throw new Error("Malformed disposable Schema v1 SQL state envelope");
  }
  const parsed = JSON.parse(Buffer.from(lines[1], "hex").toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Malformed disposable Schema v1 SQL state payload");
  return parsed;
}

const SQL_STATE_QUERY = `SELECT encode(convert_to(jsonb_build_object(
  'definitions', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.key) FROM (
    SELECT key, group_key AS "groupKey", label, help_text AS "helpText", value_type AS "valueType",
      canonical_unit AS "canonicalUnit", measurement_context AS "measurementContext", comparison_mode AS "comparisonMode",
      require_same_context AS "requireSameContext", applicable_schema_types AS "applicableSchemaTypes",
      is_core AS "isCore", admin_order AS "adminOrder", is_active AS "isActive"
    FROM public.device_spec_definitions
  ) row_value), '[]'::jsonb),
  'devices', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.slug) FROM (
    SELECT slug, brand_key, brand_name, name, short_description, long_description, positioning, release_year, availability,
      type_label, status_label, media, product_image_url, official_image_url, image_alt, product_url, official_product_url,
      buy_url, category, route_label, route_description, best_for, not_ideal_for, key_limitations, key_specs, full_specs,
      publication_status, generation, schema_type, device_type, status
    FROM public.devices
  ) row_value), '[]'::jsonb),
  'sources', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.url) FROM (
    SELECT url, publisher, title, source_type AS "sourceType", published_at::text AS "publishedAt",
      accessed_at::text AS "accessedAt", region
    FROM public.device_sources
  ) row_value), '[]'::jsonb),
  'sourceLinks', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value."deviceSlug", row_value."sourceUrl") FROM (
    SELECT d.slug AS "deviceSlug", src.url AS "sourceUrl", link.is_primary AS "isPrimary"
    FROM public.device_source_links link
    JOIN public.devices d ON d.id = link.device_id
    JOIN public.device_sources src ON src.id = link.source_id
  ) row_value), '[]'::jsonb),
  'specs', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value."deviceSlug", row_value."definitionKey", row_value.region, row_value.variant) FROM (
    SELECT d.slug AS "deviceSlug", def.key AS "definitionKey", spec.state, spec.value_number AS "valueNumber",
      spec.value_boolean AS "valueBoolean", spec.value_text AS "valueText", spec.value_json AS "valueJson",
      spec.canonical_unit AS "canonicalUnit", spec.measurement_context AS "measurementContext", spec.raw_value AS "rawValue",
      spec.region, spec.variant, spec.confidence, spec.verified_at::text AS "verifiedAt"
    FROM public.device_specs spec
    JOIN public.devices d ON d.id = spec.device_id
    JOIN public.device_spec_definitions def ON def.id = spec.spec_definition_id
  ) row_value), '[]'::jsonb),
  'evidence', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value."deviceSlug", row_value."definitionKey", row_value."sourceUrl", row_value."claimedValue") FROM (
    SELECT d.slug AS "deviceSlug", def.key AS "definitionKey", src.url AS "sourceUrl", ev.claimed_value AS "claimedValue",
      ev.is_primary AS "isPrimary", ev.is_conflicting AS "isConflicting"
    FROM public.device_spec_evidence ev
    JOIN public.device_specs spec ON spec.id = ev.device_spec_id
    JOIN public.devices d ON d.id = spec.device_id
    JOIN public.device_spec_definitions def ON def.id = spec.spec_definition_id
    JOIN public.device_sources src ON src.id = ev.source_id
  ) row_value), '[]'::jsonb),
  'compatibility', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value."deviceSlug") FROM (
    SELECT slug AS "deviceSlug", key_specs, full_specs FROM public.devices
  ) row_value), '[]'::jsonb),
  'auditEvents', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM (
    SELECT id::text AS id FROM public.catalog_audit_events
  ) row_value), '[]'::jsonb)
)::text, 'UTF8'), 'hex') AS payload;`;

export async function readSchemaV1SqlState({ executeSql }) {
  if (typeof executeSql !== "function") throw new TypeError("Owned disposable SQL executor is required");
  return parseSchemaV1SqlState(await executeSql(SQL_STATE_QUERY));
}

const SQL_VERIFICATION_QUERY = `WITH
expected_triggers(table_name, trigger_name) AS (VALUES
  ('device_specs', 'enforce_device_spec_definition'),
  ('devices', 'prevent_incompatible_device_schema_change'),
  ('device_spec_definitions', 'prevent_device_spec_definition_semantic_change'),
  ('device_spec_evidence', 'serialize_device_spec_evidence_change'),
  ('device_specs', 'device_specs_conflict_evidence'),
  ('device_spec_evidence', 'device_spec_evidence_conflict'),
  ('catalog_audit_events', 'catalog_audit_events_append_only')
),
trigger_failures AS (
  SELECT count(*)::int AS value FROM expected_triggers expected
  LEFT JOIN pg_catalog.pg_class relation ON relation.relname = expected.table_name
  LEFT JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace AND namespace.nspname = 'public'
  LEFT JOIN pg_catalog.pg_trigger trigger ON trigger.tgrelid = relation.oid AND trigger.tgname = expected.trigger_name AND NOT trigger.tgisinternal AND trigger.tgenabled <> 'D'
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
SELECT encode(convert_to(jsonb_build_object(
  'devices', (SELECT count(*)::int FROM public.devices),
  'uniqueSlugs', (SELECT count(DISTINCT slug)::int FROM public.devices),
  'published', (SELECT count(*)::int FROM public.devices WHERE publication_status = 'published'),
  'definitions', (SELECT count(*)::int FROM public.device_spec_definitions),
  'specs', (SELECT count(*)::int FROM public.device_specs),
  'sources', (SELECT count(*)::int FROM public.device_sources),
  'sourceLinks', (SELECT count(*)::int FROM public.device_source_links),
  'evidence', (SELECT count(*)::int FROM public.device_spec_evidence),
  'auditEvents', (SELECT count(*)::int FROM public.catalog_audit_events),
  'constraintFailures', (SELECT catalog_constraint_failures.value + spec_contract_failures.value + conflict_failures.value FROM catalog_constraint_failures, spec_contract_failures, conflict_failures),
  'triggerFailures', (SELECT value FROM trigger_failures),
  'duplicateFailures', (SELECT value FROM duplicate_failures),
  'conflictEvidenceFailures', (SELECT value FROM conflict_failures),
  'unknownUnverifiedKnownData', (SELECT value FROM unknown_value_failures)
)::text, 'UTF8'), 'hex') AS payload;`;

export async function readSchemaV1SqlVerification({ executeSql }) {
  if (typeof executeSql !== "function") throw new TypeError("Owned disposable SQL executor is required");
  return parseSchemaV1SqlState(await executeSql(SQL_VERIFICATION_QUERY));
}
