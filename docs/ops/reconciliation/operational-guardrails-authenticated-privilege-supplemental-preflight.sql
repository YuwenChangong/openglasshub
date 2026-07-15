-- W6 authenticated privilege supplemental packet. Export the sole result set as CSV.
-- Catalog-only: it reads no application-table rows and changes no database state.
BEGIN TRANSACTION READ ONLY;

WITH RECURSIVE
target_roles AS (
  SELECT role_name, role_ref.oid, role_ref.rolinherit
  FROM (VALUES ('anon'::text), ('authenticated'), ('service_role'), ('authenticator')) AS target(role_name)
  LEFT JOIN pg_roles role_ref ON role_ref.rolname = target.role_name
),
role_closure AS (
  SELECT role_name AS root_role, oid AS role_oid, role_name AS effective_role, 0 AS depth, ARRAY[oid] AS path
  FROM target_roles
  WHERE oid IS NOT NULL
  UNION ALL
  SELECT closure.root_role, parent.oid, parent.rolname, closure.depth + 1, closure.path || parent.oid
  FROM role_closure closure
  JOIN pg_auth_members membership ON membership.member = closure.role_oid
  JOIN pg_roles parent ON parent.oid = membership.roleid
  WHERE NOT parent.oid = ANY(closure.path)
),
relevant_roles AS (
  SELECT DISTINCT effective_role AS role_name
  FROM role_closure
),
schema_ref AS (
  SELECT n.oid, n.nspacl, n.nspowner, pg_get_userbyid(n.nspowner) AS owner
  FROM pg_namespace n
  WHERE n.nspname = 'public'
),
schema_acl AS (
  SELECT entry.grantee, entry.grantor, entry.privilege_type, entry.is_grantable
  FROM schema_ref schema_ref
  CROSS JOIN LATERAL aclexplode(coalesce(schema_ref.nspacl, acldefault('n', schema_ref.nspowner))) AS entry
),
relation_ref AS (
  SELECT c.oid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'forum_upload_attempts' AND c.relkind = 'r'
),
sequence_refs AS (
  SELECT attribute.attname AS column_name, sequence_ref.oid, sequence_schema.nspname AS schema_name,
    sequence_ref.relname AS sequence_name, sequence_ref.relacl, sequence_ref.relowner,
    pg_get_userbyid(sequence_ref.relowner) AS owner,
    pg_get_expr(default_expr.adbin, default_expr.adrelid) AS default_expression
  FROM relation_ref relation_ref
  JOIN pg_attrdef default_expr ON default_expr.adrelid = relation_ref.oid
  JOIN pg_attribute attribute ON attribute.attrelid = relation_ref.oid AND attribute.attnum = default_expr.adnum
  JOIN pg_depend dependency ON dependency.classid = 'pg_attrdef'::regclass
    AND dependency.objid = default_expr.oid
    AND dependency.refclassid = 'pg_class'::regclass
  JOIN pg_class sequence_ref ON sequence_ref.oid = dependency.refobjid AND sequence_ref.relkind = 'S'
  JOIN pg_namespace sequence_schema ON sequence_schema.oid = sequence_ref.relnamespace
),
sequence_acl AS (
  SELECT sequence_ref.sequence_name, entry.grantee, entry.grantor, entry.privilege_type, entry.is_grantable
  FROM sequence_refs sequence_ref
  CROSS JOIN LATERAL aclexplode(coalesce(sequence_ref.relacl, acldefault('S', sequence_ref.relowner))) AS entry
),
packet_rows AS (
  SELECT 1 AS section_order, 'packet_manifest' AS section, row_key, 'public' AS object_schema, 'forum_upload_attempts' AS object_name,
    attribute, value, 'PRESENT' AS evidence_status, 'NON_SECURITY_DRIFT' AS security_classification
  FROM (VALUES
    ('packet', 'packet_identifier', 'operational-guardrails-authenticated-privilege-supplemental-preflight'),
    ('packet', 'packet_version', 'operational-guardrails-authenticated-privilege-supplemental-preflight-v1'),
    ('packet', 'expected_section_count', '8'),
    ('packet', 'target_relation', 'public.forum_upload_attempts'),
    ('packet', 'read_scope', 'PostgreSQL catalogs only; no application-table rows')
  ) AS value(row_key, attribute, value)
  UNION ALL
  SELECT 2, 'target_role_catalog', role.role_name, 'public', 'forum_upload_attempts', 'role',
    json_build_object('exists', role.oid IS NOT NULL, 'inherits_privileges', role.rolinherit)::text,
    CASE WHEN role.oid IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM target_roles role
  UNION ALL
  SELECT 3, 'role_membership_topology', closure.root_role || '->' || closure.effective_role, 'public', 'forum_upload_attempts', 'membership',
    json_build_object('root_role', closure.root_role, 'parent_role', closure.effective_role, 'membership_depth', closure.depth,
      'membership_kind', CASE WHEN closure.depth = 0 THEN 'SELF' WHEN closure.depth = 1 THEN 'DIRECT' ELSE 'TRANSITIVE' END)::text,
    'PRESENT', 'SECURITY_BROADENING'
  FROM role_closure closure
  UNION ALL
  SELECT 4, 'schema_acl_catalog', coalesce(CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END, 'NO_RELEVANT_ACL_ENTRY'),
    'public', 'schema', 'entry',
    CASE WHEN acl.grantee IS NULL THEN NULL ELSE json_build_object('grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
      'privilege', acl.privilege_type, 'grantable', acl.is_grantable)::text END,
    CASE WHEN acl.grantee IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM schema_acl acl
  WHERE acl.grantee = 0 OR EXISTS (SELECT 1 FROM relevant_roles role WHERE role.role_name = pg_get_userbyid(acl.grantee))
  UNION ALL
  SELECT 4, 'schema_acl_catalog', 'NO_RELEVANT_ACL_ENTRY', 'public', 'schema', 'entry', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE'
  WHERE NOT EXISTS (SELECT 1 FROM schema_acl acl WHERE acl.grantee = 0 OR EXISTS (SELECT 1 FROM relevant_roles role WHERE role.role_name = pg_get_userbyid(acl.grantee)))
  UNION ALL
  SELECT 5, 'effective_schema_privileges', role.role_name, 'public', 'schema', 'effective',
    json_build_object('USAGE', has_schema_privilege(role.role_name, 'public', 'USAGE'), 'CREATE', has_schema_privilege(role.role_name, 'public', 'CREATE'))::text,
    'PRESENT', 'SECURITY_BROADENING'
  FROM relevant_roles role
  UNION ALL
  SELECT 6, 'referenced_sequence_catalog', coalesce(sequence_ref.sequence_name, 'NO_REFERENCED_SEQUENCE'), 'public', 'forum_upload_attempts', 'dependency',
    CASE WHEN sequence_ref.oid IS NULL THEN NULL ELSE json_build_object('column', sequence_ref.column_name, 'sequence_schema', sequence_ref.schema_name,
      'sequence_name', sequence_ref.sequence_name, 'owner', sequence_ref.owner, 'default_expression', sequence_ref.default_expression)::text END,
    CASE WHEN sequence_ref.oid IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM (SELECT 1) seed LEFT JOIN sequence_refs sequence_ref ON true
  UNION ALL
  SELECT 7, 'sequence_acl_catalog', coalesce(sequence_acl.sequence_name || '|' || CASE WHEN sequence_acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(sequence_acl.grantee) END, 'NO_RELEVANT_SEQUENCE_ACL_ENTRY'),
    'public', 'forum_upload_attempts', 'entry',
    CASE WHEN sequence_acl.grantee IS NULL THEN NULL ELSE json_build_object('sequence_name', sequence_acl.sequence_name,
      'grantee', CASE WHEN sequence_acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(sequence_acl.grantee) END,
      'privilege', sequence_acl.privilege_type, 'grantable', sequence_acl.is_grantable)::text END,
    CASE WHEN sequence_acl.grantee IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM sequence_acl
  WHERE sequence_acl.grantee = 0 OR EXISTS (SELECT 1 FROM relevant_roles role WHERE role.role_name = pg_get_userbyid(sequence_acl.grantee))
  UNION ALL
  SELECT 7, 'sequence_acl_catalog', 'NO_RELEVANT_SEQUENCE_ACL_ENTRY', 'public', 'forum_upload_attempts', 'entry', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE'
  WHERE NOT EXISTS (SELECT 1 FROM sequence_acl acl WHERE acl.grantee = 0 OR EXISTS (SELECT 1 FROM relevant_roles role WHERE role.role_name = pg_get_userbyid(acl.grantee)))
  UNION ALL
  SELECT 8, 'effective_sequence_privileges', coalesce(sequence_ref.sequence_name || '|' || role.role_name, 'NO_REFERENCED_SEQUENCE|' || role.role_name),
    'public', 'forum_upload_attempts', 'effective',
    CASE WHEN sequence_ref.oid IS NULL THEN json_build_object('sequence_exists', false, 'USAGE', false, 'SELECT', false, 'UPDATE', false)::text
      ELSE json_build_object('sequence_exists', true, 'USAGE', has_sequence_privilege(role.role_name, sequence_ref.oid, 'USAGE'),
        'SELECT', has_sequence_privilege(role.role_name, sequence_ref.oid, 'SELECT'), 'UPDATE', has_sequence_privilege(role.role_name, sequence_ref.oid, 'UPDATE'))::text END,
    CASE WHEN sequence_ref.oid IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM relevant_roles role
  LEFT JOIN sequence_refs sequence_ref ON true
)
SELECT 'operational-guardrails-authenticated-privilege-supplemental-preflight-v1' AS packet_version,
  section_order, section, row_key, object_schema, object_name, attribute, value, evidence_status, security_classification
FROM packet_rows
ORDER BY section_order, section, row_key, attribute;

ROLLBACK;
