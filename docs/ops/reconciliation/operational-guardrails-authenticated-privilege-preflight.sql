-- W6 authenticated privilege-contract packet. Export the sole result set as CSV.
-- Catalog-only: it neither reads forum_upload_attempts rows nor changes database state.
BEGIN TRANSACTION READ ONLY;

WITH
relation_ref AS (
  SELECT c.oid, c.relacl, c.relowner, c.relrowsecurity, c.relforcerowsecurity,
    c.relkind, pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'forum_upload_attempts' AND c.relkind = 'r'
),
policy_catalog AS (
  SELECT p.polname, p.polcmd, p.polpermissive,
    array_to_string(ARRAY(
      SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE coalesce(role_ref.rolname, 'UNKNOWN_ROLE_OID_' || role_oid::text) END
      FROM unnest(p.polroles) AS policy_role(role_oid)
      LEFT JOIN pg_roles role_ref ON role_ref.oid = policy_role.role_oid
      ORDER BY 1
    ), ',') AS roles,
    ARRAY(SELECT role_oid::text FROM unnest(p.polroles) AS policy_role(role_oid) ORDER BY 1) AS role_oids,
    pg_get_expr(p.polqual, p.polrelid) AS using_expression,
    pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expression
  FROM relation_ref relation_ref
  JOIN pg_policy p ON p.polrelid = relation_ref.oid
),
acl_catalog AS (
  SELECT entry.grantee, entry.grantor, entry.privilege_type, entry.is_grantable
  FROM relation_ref relation_ref
  CROSS JOIN LATERAL aclexplode(coalesce(relation_ref.relacl, acldefault('r', relation_ref.relowner))) AS entry
),
target_roles AS (
  SELECT role_name, role_ref.oid
  FROM (VALUES ('anon'::text), ('authenticated'), ('service_role'), ('postgres')) AS target(role_name)
  LEFT JOIN pg_roles role_ref ON role_ref.rolname = target.role_name
),
resend_rpc AS (
  SELECT p.oid, p.proacl, p.proowner, p.prosecdef, p.proconfig,
    p.oid::regprocedure::text AS identity,
    pg_get_userbyid(p.proowner) AS owner
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'consume_verification_email_resend_limit'
    AND pg_get_function_identity_arguments(p.oid) = 'input_ip_hash text, max_attempts integer, window_hours integer'
),
rpc_acl_catalog AS (
  SELECT rpc.identity, entry.grantee, entry.grantor, entry.privilege_type, entry.is_grantable
  FROM resend_rpc rpc
  CROSS JOIN LATERAL aclexplode(coalesce(rpc.proacl, acldefault('f', rpc.proowner))) AS entry
),
packet_rows AS (
  SELECT 1 AS section_order, 'packet_manifest' AS section, row_key, 'public' AS object_schema, 'forum_upload_attempts' AS object_name,
    attribute, value, 'PRESENT' AS evidence_status, 'NON_SECURITY_DRIFT' AS security_classification
  FROM (VALUES
    ('packet', 'packet_identifier', 'operational-guardrails-authenticated-privilege-preflight'),
    ('packet', 'packet_version', 'operational-guardrails-authenticated-privilege-preflight-v1'),
    ('packet', 'expected_section_count', '8'),
    ('packet', 'target_relation', 'public.forum_upload_attempts'),
    ('packet', 'read_scope', 'PostgreSQL catalogs only; no application-table rows')
  ) AS value(row_key, attribute, value)
  UNION ALL
  SELECT 2, 'relation_and_rls_state', 'public.forum_upload_attempts', 'public', 'forum_upload_attempts', 'state',
    CASE WHEN EXISTS (SELECT 1 FROM relation_ref) THEN json_build_object(
      'exists', true, 'owner', (SELECT owner FROM relation_ref), 'relation_kind', (SELECT relkind FROM relation_ref),
      'rls_enabled', (SELECT relrowsecurity FROM relation_ref), 'rls_forced', (SELECT relforcerowsecurity FROM relation_ref)
    )::text ELSE NULL END,
    CASE WHEN EXISTS (SELECT 1 FROM relation_ref) THEN 'PRESENT' ELSE 'MISSING' END, 'SECURITY_BROADENING'
  UNION ALL
  SELECT 3, 'all_table_policies', coalesce(policy.polname, 'NO_TABLE_POLICIES'), 'public', 'forum_upload_attempts', 'definition',
    CASE WHEN policy.polname IS NULL THEN NULL ELSE json_build_object(
      'name', policy.polname, 'command', policy.polcmd, 'permissive', policy.polpermissive,
      'roles', policy.roles, 'role_oids', policy.role_oids, 'using', policy.using_expression, 'with_check', policy.with_check_expression
    )::text END,
    CASE WHEN policy.polname IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM policy_catalog policy
  UNION ALL
  SELECT 3, 'all_table_policies', 'NO_TABLE_POLICIES', 'public', 'forum_upload_attempts', 'definition', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE'
  WHERE NOT EXISTS (SELECT 1 FROM policy_catalog)
  UNION ALL
  SELECT 4, 'relation_acl_catalog', coalesce(CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END, 'NO_DIRECT_ACL_ENTRY'),
    'public', 'forum_upload_attempts', 'entry',
    CASE WHEN acl.grantee IS NULL THEN NULL ELSE json_build_object(
      'grantee_oid', acl.grantee, 'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
      'grantor_oid', acl.grantor, 'privilege', acl.privilege_type, 'grantable', acl.is_grantable
    )::text END,
    CASE WHEN acl.grantee IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM acl_catalog acl
  UNION ALL
  SELECT 4, 'relation_acl_catalog', 'NO_DIRECT_ACL_ENTRY', 'public', 'forum_upload_attempts', 'entry', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE'
  WHERE NOT EXISTS (SELECT 1 FROM acl_catalog)
  UNION ALL
  SELECT 5, 'effective_table_privileges', role.role_name, 'public', 'forum_upload_attempts', 'effective',
    json_build_object(
      'role_exists', role.oid IS NOT NULL,
      'SELECT', CASE WHEN role.oid IS NULL THEN NULL ELSE has_table_privilege(role.role_name, 'public.forum_upload_attempts', 'SELECT') END,
      'INSERT', CASE WHEN role.oid IS NULL THEN NULL ELSE has_table_privilege(role.role_name, 'public.forum_upload_attempts', 'INSERT') END
    )::text,
    CASE WHEN role.oid IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM target_roles role
  UNION ALL
  SELECT 6, 'resend_rpc_metadata', coalesce(rpc.identity, 'NO_MATCHING_RPC'), 'public', 'consume_verification_email_resend_limit', 'metadata',
    CASE WHEN rpc.oid IS NULL THEN NULL ELSE json_build_object(
      'identity', rpc.identity, 'owner', rpc.owner, 'security_definer', rpc.prosecdef,
      'search_path', coalesce(array_to_string(rpc.proconfig, ','), '')
    )::text END,
    CASE WHEN rpc.oid IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM (SELECT 1) seed LEFT JOIN resend_rpc rpc ON true
  UNION ALL
  SELECT 7, 'resend_rpc_acl_catalog', coalesce(CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END, 'NO_DIRECT_ACL_ENTRY'),
    'public', 'consume_verification_email_resend_limit', 'entry',
    CASE WHEN acl.grantee IS NULL THEN NULL ELSE json_build_object(
      'grantee_oid', acl.grantee, 'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
      'grantor_oid', acl.grantor, 'privilege', acl.privilege_type, 'grantable', acl.is_grantable
    )::text END,
    CASE WHEN acl.grantee IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM rpc_acl_catalog acl
  UNION ALL
  SELECT 7, 'resend_rpc_acl_catalog', 'NO_DIRECT_ACL_ENTRY', 'public', 'consume_verification_email_resend_limit', 'entry', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE'
  WHERE NOT EXISTS (SELECT 1 FROM rpc_acl_catalog)
  UNION ALL
  SELECT 8, 'effective_rpc_execute_privileges', role.role_name, 'public', 'consume_verification_email_resend_limit', 'effective',
    CASE WHEN rpc.oid IS NULL THEN NULL ELSE json_build_object(
      'role_exists', role.oid IS NOT NULL,
      'EXECUTE', CASE WHEN role.oid IS NULL THEN NULL ELSE has_function_privilege(role.role_name, rpc.oid, 'EXECUTE') END
    )::text END,
    CASE WHEN rpc.oid IS NULL OR role.oid IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM target_roles role
  LEFT JOIN resend_rpc rpc ON true
)
SELECT 'operational-guardrails-authenticated-privilege-preflight-v1' AS packet_version,
  section_order, section, row_key, object_schema, object_name, attribute, value, evidence_status, security_classification
FROM packet_rows
ORDER BY section_order, section, row_key, attribute;

ROLLBACK;
