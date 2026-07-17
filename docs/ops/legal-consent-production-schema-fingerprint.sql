-- OpenGlass Hub production schema fingerprint packet.
-- Read-only catalog evidence only. Do not add, remove, or edit statements.
BEGIN TRANSACTION READ ONLY;

WITH fingerprint_rows AS (
  SELECT 'packet_sections'::text AS section, 'section_marker'::text AS object_type,
    ''::text AS schema_name, required_section::text AS object_name,
    required_section::text AS identity, 'collected'::text AS attribute, 'true'::text AS value
  FROM (VALUES
    ('migration_ledger'), ('schemas_and_tables'), ('columns'), ('constraints_and_indexes'), ('types'),
    ('sequences'), ('functions'), ('function_acl'), ('triggers'), ('policies'), ('grants'), ('migration_configuration')
  ) required(required_section)

  UNION ALL
  SELECT
    'migration_ledger'::text AS section,
    'migration'::text AS object_type,
    'supabase_migrations'::text AS schema_name,
    coalesce(name, '')::text AS object_name,
    version::text AS identity,
    'statement_count'::text AS attribute,
    coalesce(cardinality(statements), 0)::text AS value
  FROM supabase_migrations.schema_migrations

  UNION ALL
  SELECT 'schemas_and_tables', 'schema', n.nspname, n.nspname, n.nspname,
    'exists', 'true'
  FROM pg_namespace n
  WHERE n.nspname IN ('public', 'storage')

  UNION ALL
  SELECT 'schemas_and_tables', 'table', n.nspname, c.relname,
    n.nspname || '.' || c.relname, 'rls_state',
    'enabled=' || c.relrowsecurity || ';forced=' || c.relforcerowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE (n.nspname = 'public' AND c.relkind IN ('r', 'p'))
     OR (n.nspname = 'storage' AND c.relname = 'objects' AND c.relkind IN ('r', 'p'))

  UNION ALL
  SELECT 'columns', 'column', table_schema, table_name,
    table_schema || '.' || table_name || '.' || column_name, 'definition',
    'type=' || data_type || coalesce('(' || character_maximum_length || ')', '') ||
    ';nullable=' || is_nullable || ';default=' || coalesce(column_default, '') ||
    ';generated=' || coalesce(is_generated, 'NEVER')
  FROM information_schema.columns
  WHERE table_schema = 'public'

  UNION ALL
  SELECT 'constraints_and_indexes', 'constraint', n.nspname, c.relname,
    n.nspname || '.' || c.relname || '.' || con.conname, contype::text,
    pg_get_constraintdef(con.oid, true)
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'

  UNION ALL
  SELECT 'constraints_and_indexes', 'index', n.nspname, c.relname,
    n.nspname || '.' || c.relname || '.' || idx.relname, 'definition',
    pg_get_indexdef(idx.oid)
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'

  UNION ALL
  SELECT 'types', 'type', n.nspname, t.typname, n.nspname || '.' || t.typname,
    CASE WHEN t.typtype = 'e' THEN 'enum_labels' ELSE 'type_kind' END,
    CASE WHEN t.typtype = 'e' THEN coalesce((SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid), '') ELSE t.typtype::text END
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd')

  UNION ALL
  SELECT 'sequences', 'sequence', n.nspname, c.relname, n.nspname || '.' || c.relname,
    'definition', pg_get_serial_sequence(n.nspname || '.' || c.relname, c.relname)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'S'

  UNION ALL
  SELECT 'functions', 'function', n.nspname, p.proname,
    p.oid::regprocedure::text, 'definition',
    'returns=' || pg_get_function_result(p.oid) || ';security_definer=' || p.prosecdef ||
    ';owner=' || pg_get_userbyid(p.proowner) || ';search_path=' || coalesce(array_to_string(p.proconfig, ','), '') ||
    ';body=' || pg_get_functiondef(p.oid)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'

  UNION ALL
  SELECT 'function_acl', 'function', n.nspname, p.proname,
    p.oid::regprocedure::text, role_name || '_execute',
    CASE
      WHEN role_name = 'PUBLIC' THEN EXISTS (
        SELECT 1
        FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) public_acl
        WHERE public_acl.grantee = 0 AND public_acl.privilege_type = 'EXECUTE'
      )
      ELSE has_function_privilege(role_name, p.oid, 'EXECUTE')
    END::text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (VALUES ('PUBLIC'::text), ('anon'::text), ('authenticated'::text), ('service_role'::text)) AS roles(role_name)
  WHERE n.nspname = 'public' AND p.prokind = 'f'

  UNION ALL
  SELECT 'triggers', 'trigger', event_schema.nspname, event_table.relname,
    event_schema.nspname || '.' || event_table.relname || '.' || trg.tgname,
    'definition', pg_get_triggerdef(trg.oid, true)
  FROM pg_trigger trg
  JOIN pg_class event_table ON event_table.oid = trg.tgrelid
  JOIN pg_namespace event_schema ON event_schema.oid = event_table.relnamespace
  JOIN pg_proc trigger_function ON trigger_function.oid = trg.tgfoid
  JOIN pg_namespace function_schema ON function_schema.oid = trigger_function.pronamespace
  WHERE NOT trg.tgisinternal AND (event_schema.nspname = 'public' OR function_schema.nspname = 'public')

  UNION ALL
  SELECT 'policies', 'policy', schemaname, tablename,
    schemaname || '.' || tablename || '.' || policyname, cmd,
    'permissive=' || permissive || ';roles=' || array_to_string(roles, ',') ||
    ';using=' || coalesce(qual, '') || ';with_check=' || coalesce(with_check, '')
  FROM pg_policies
  WHERE schemaname = 'public' OR (schemaname = 'storage' AND tablename = 'objects')

  UNION ALL
  SELECT 'grants', 'schema_grant', n.nspname, n.nspname, n.nspname,
    coalesce(grantee.rolname, 'PUBLIC') || ':' || acl.privilege_type,
    'grantable=' || acl.is_grantable
  FROM pg_namespace n
  CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
  LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
  WHERE n.nspname IN ('public', 'storage')

  UNION ALL
  SELECT 'grants', 'table_grant', n.nspname, c.relname, n.nspname || '.' || c.relname,
    coalesce(grantee.rolname, 'PUBLIC') || ':' || acl.privilege_type,
    'grantable=' || acl.is_grantable
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
  LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S')

  UNION ALL
  SELECT 'grants', 'function_grant', n.nspname, p.proname, p.oid::regprocedure::text,
    coalesce(grantee.rolname, 'PUBLIC') || ':' || acl.privilege_type,
    'grantable=' || acl.is_grantable
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
  WHERE n.nspname = 'public' AND p.prokind = 'f'

  UNION ALL
  SELECT 'migration_configuration', 'storage_bucket', 'storage', id, id,
    'definition',
    'name=' || coalesce(name, '') || ';public=' || public || ';file_size_limit=' || coalesce(file_size_limit::text, '') ||
    ';allowed_mime_types=' || coalesce(array_to_string(allowed_mime_types, ','), '')
  FROM storage.buckets
)
SELECT
  section,
  object_type,
  schema_name,
  object_name,
  identity,
  attribute,
  btrim(regexp_replace(regexp_replace(value, E'[\\n\\r\\t]+', ' ', 'g'), E' +', ' ', 'g')) AS value,
  encode(digest(btrim(regexp_replace(regexp_replace(value, E'[\\n\\r\\t]+', ' ', 'g'), E' +', ' ', 'g')), 'sha256'), 'hex') AS definition_hash
FROM fingerprint_rows
ORDER BY section, object_type, schema_name, object_name, identity, attribute;

ROLLBACK;
