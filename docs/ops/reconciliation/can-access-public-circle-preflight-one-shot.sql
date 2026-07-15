-- READ ONLY ONE-SHOT PRODUCTION PREREQUISITE PREFLIGHT.
-- Returns exactly one catalog-only result set for offline review.
WITH
packet AS (
  SELECT 'can-access-public-circle-preflight-v1'::text AS packet_version
),
function_target AS (
  SELECT
    p.oid,
    language.lanname AS language,
    pg_get_userbyid(p.proowner) AS owner,
    p.prosecdef,
    p.provolatile::text AS volatility,
    p.proisstrict,
    p.proleakproof,
    p.proparallel::text AS parallel_safety,
    coalesce(array_to_string(p.proconfig, ', '), '') AS configuration,
    pg_get_function_result(p.oid) AS return_type,
    pg_get_functiondef(p.oid) AS function_definition
  FROM pg_proc p
  JOIN pg_language language ON language.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.can_access_public_circle(uuid)')
),
function_acl AS (
  SELECT
    p.oid,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'grantee', coalesce(grantee.rolname, 'PUBLIC'),
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        )
        ORDER BY coalesce(grantee.rolname, 'PUBLIC'), acl.privilege_type
      ) FILTER (WHERE acl.privilege_type IS NOT NULL),
      '[]'::jsonb
    )::text AS execute_acl
  FROM function_target p
  LEFT JOIN LATERAL aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid = p.oid), acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = p.oid)))) acl ON true
  LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
  GROUP BY p.oid
),
circles_relation AS (
  SELECT
    n.nspname AS schema_name,
    c.relname AS relation_name,
    c.relkind::text AS relation_kind,
    pg_get_userbyid(c.relowner) AS owner,
    coalesce(c.relacl::text, '') AS relation_acl,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.oid = to_regclass('public.circles')
),
expected_columns AS (
  SELECT * FROM (VALUES ('id'), ('status'), ('slug'), ('name')) AS value(column_name)
),
circles_columns AS (
  SELECT
    a.attname AS column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
    a.attnotnull AS not_null,
    pg_get_expr(d.adbin, d.adrelid) AS default_expression
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = to_regclass('public.circles')
    AND a.attname IN ('id', 'status', 'slug', 'name')
    AND a.attnum > 0
    AND NOT a.attisdropped
),
circles_constraints AS (
  SELECT
    con.conname AS constraint_name,
    con.contype::text AS constraint_type,
    pg_get_constraintdef(con.oid, true) AS constraint_definition
  FROM pg_constraint con
  WHERE con.conrelid = to_regclass('public.circles')
),
expected_roles AS (
  SELECT * FROM (VALUES ('anon'), ('authenticated'), ('postgres')) AS value(role_name)
),
required_roles AS (
  SELECT
    role.rolname AS role_name,
    role.rolcanlogin,
    role.rolinherit,
    role.rolbypassrls
  FROM pg_roles role
  WHERE role.rolname IN ('anon', 'authenticated', 'postgres')
),
circles_policies AS (
  SELECT
    policy.polname AS policy_name,
    policy.polcmd::text AS command,
    pg_get_expr(policy.polqual, policy.polrelid) AS using_expression,
    pg_get_expr(policy.polwithcheck, policy.polrelid) AS with_check_expression
  FROM pg_policy policy
  WHERE policy.polrelid = to_regclass('public.circles')
),
packet_rows AS (
  SELECT packet_version, 0 AS section_order, 'packet_manifest'::text AS section, 'packet'::text AS row_key, 'public'::text AS object_schema, 'can_access_public_circle'::text AS object_name, 'packet_identifier'::text AS attribute, 'can-access-public-circle-prerequisite'::text AS value, 'PRESENT'::text AS evidence_status FROM packet
  UNION ALL SELECT packet_version, 0, 'packet_manifest', 'packet', 'public', 'can_access_public_circle', 'packet_version', packet_version, 'PRESENT' FROM packet
  UNION ALL SELECT packet_version, 0, 'packet_manifest', 'packet', 'public', 'can_access_public_circle', 'expected_section_count', '7', 'PRESENT' FROM packet
  UNION ALL SELECT packet_version, 0, 'packet_manifest', 'packet', 'public', 'can_access_public_circle', 'target_function', 'public.can_access_public_circle(uuid)', 'PRESENT' FROM packet
  UNION ALL SELECT packet_version, 0, 'packet_manifest', 'packet', 'public', 'circles', 'target_relation', 'public.circles', 'PRESENT' FROM packet
  UNION ALL SELECT packet_version, 0, 'packet_manifest', 'packet', 'public', 'circles', 'query_scope', 'PostgreSQL catalogs and public.circles structural metadata only', 'PRESENT' FROM packet
  UNION ALL SELECT packet_version, 0, 'packet_manifest', 'packet', 'public', 'circles', 'read_only_classification', 'CATALOG_ONLY_READ_ONLY', 'PRESENT' FROM packet
),
function_metadata_rows AS (
  SELECT packet.packet_version, 1, 'function_metadata_acl', 'public.can_access_public_circle(uuid)', 'public', 'can_access_public_circle', item.attribute, item.value, 'PRESENT'
  FROM packet
  CROSS JOIN function_target function_ref
  JOIN function_acl acl ON acl.oid = function_ref.oid
  CROSS JOIN LATERAL (
    VALUES
      ('present'::text, 'true'::text),
      ('signature', function_ref.oid::regprocedure::text),
      ('return_type', function_ref.return_type),
      ('language', function_ref.language),
      ('owner', function_ref.owner),
      ('security_definer', function_ref.prosecdef::text),
      ('volatility', function_ref.volatility),
      ('strict', function_ref.proisstrict::text),
      ('leakproof', function_ref.proleakproof::text),
      ('parallel_safety', function_ref.parallel_safety),
      ('configuration', function_ref.configuration),
      ('function_definition', function_ref.function_definition),
      ('execute_acl', acl.execute_acl)
  ) item(attribute, value)
  UNION ALL
  SELECT packet.packet_version, 1, 'function_metadata_acl', 'public.can_access_public_circle(uuid)', 'public', 'can_access_public_circle', 'present', 'false', 'MISSING'
  FROM packet
  WHERE NOT EXISTS (SELECT 1 FROM function_target)
),
signature_rows AS (
  SELECT packet.packet_version, 2, 'function_signature_overloads', 'public.can_access_public_circle(uuid)', 'public', 'can_access_public_circle', 'exact_signature', coalesce(to_regprocedure('public.can_access_public_circle(uuid)')::text, ''), CASE WHEN to_regprocedure('public.can_access_public_circle(uuid)') IS NULL THEN 'MISSING' ELSE 'PRESENT' END
  FROM packet
  UNION ALL
  SELECT packet.packet_version, 2, 'function_signature_overloads', 'public.can_access_public_circle(uuid)', 'public', 'can_access_public_circle', 'overload_count', count(*)::text, CASE WHEN count(*) = 0 THEN 'MISSING' ELSE 'PRESENT' END
  FROM packet
  CROSS JOIN pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'can_access_public_circle'
  GROUP BY packet.packet_version
  UNION ALL
  SELECT packet.packet_version, 2, 'function_signature_overloads', 'public.can_access_public_circle(uuid)', 'public', 'can_access_public_circle', 'overload_count', '0', 'MISSING'
  FROM packet
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'can_access_public_circle'
  )
),
relation_rows AS (
  SELECT packet.packet_version, 3, 'circles_relation_rls_acl', 'public.circles', 'public', 'circles', item.attribute, item.value, 'PRESENT'
  FROM packet
  CROSS JOIN circles_relation relation_ref
  CROSS JOIN LATERAL (
    VALUES
      ('present'::text, 'true'::text),
      ('relation_kind', relation_ref.relation_kind),
      ('owner', relation_ref.owner),
      ('relation_acl', relation_ref.relation_acl),
      ('rls_enabled', relation_ref.rls_enabled::text),
      ('rls_forced', relation_ref.rls_forced::text)
  ) item(attribute, value)
  UNION ALL
  SELECT packet.packet_version, 3, 'circles_relation_rls_acl', 'public.circles', 'public', 'circles', 'present', 'false', 'MISSING'
  FROM packet
  WHERE NOT EXISTS (SELECT 1 FROM circles_relation)
),
column_rows AS (
  SELECT
    packet.packet_version,
    4,
    'circles_columns',
    expected.column_name,
    'public',
    'circles',
    expected.column_name,
    CASE WHEN column_ref.column_name IS NULL THEN '' ELSE jsonb_build_object('data_type', column_ref.data_type, 'not_null', column_ref.not_null, 'default_expression', column_ref.default_expression)::text END,
    CASE WHEN column_ref.column_name IS NULL THEN 'MISSING' ELSE 'PRESENT' END
  FROM packet
  CROSS JOIN expected_columns expected
  LEFT JOIN circles_columns column_ref ON column_ref.column_name = expected.column_name
),
constraint_rows AS (
  SELECT packet.packet_version, 5, 'circles_constraints', constraint_ref.constraint_name, 'public', 'circles', constraint_ref.constraint_name, jsonb_build_object('constraint_type', constraint_ref.constraint_type, 'definition', constraint_ref.constraint_definition)::text, 'PRESENT'
  FROM packet
  CROSS JOIN circles_constraints constraint_ref
  UNION ALL
  SELECT packet.packet_version, 5, 'circles_constraints', 'none', 'public', 'circles', 'present', '', 'MISSING'
  FROM packet
  WHERE NOT EXISTS (SELECT 1 FROM circles_constraints)
),
policy_rows AS (
  SELECT packet.packet_version, 6, 'circles_policies', policy_ref.policy_name, 'public', 'circles', policy_ref.policy_name, jsonb_build_object('command', policy_ref.command, 'using_expression', policy_ref.using_expression, 'with_check_expression', policy_ref.with_check_expression)::text, 'PRESENT'
  FROM packet
  CROSS JOIN circles_policies policy_ref
  UNION ALL
  SELECT packet.packet_version, 6, 'circles_policies', 'none', 'public', 'circles', 'present', '', 'MISSING'
  FROM packet
  WHERE NOT EXISTS (SELECT 1 FROM circles_policies)
),
role_rows AS (
  SELECT
    packet.packet_version,
    7,
    'required_roles',
    expected.role_name,
    'postgres',
    expected.role_name,
    expected.role_name,
    CASE WHEN role_ref.role_name IS NULL THEN '' ELSE jsonb_build_object('can_login', role_ref.rolcanlogin, 'inherit', role_ref.rolinherit, 'bypass_rls', role_ref.rolbypassrls)::text END,
    CASE WHEN role_ref.role_name IS NULL THEN 'MISSING' ELSE 'PRESENT' END
  FROM packet
  CROSS JOIN expected_roles expected
  LEFT JOIN required_roles role_ref ON role_ref.role_name = expected.role_name
)
SELECT packet_version, section_order, section, row_key, object_schema, object_name, attribute, value, evidence_status
FROM (
  SELECT * FROM packet_rows
  UNION ALL SELECT * FROM function_metadata_rows
  UNION ALL SELECT * FROM signature_rows
  UNION ALL SELECT * FROM relation_rows
  UNION ALL SELECT * FROM column_rows
  UNION ALL SELECT * FROM constraint_rows
  UNION ALL SELECT * FROM policy_rows
  UNION ALL SELECT * FROM role_rows
) unified_packet
ORDER BY section_order, row_key, attribute;
