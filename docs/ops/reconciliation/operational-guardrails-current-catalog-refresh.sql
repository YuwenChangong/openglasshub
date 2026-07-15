-- W6 current catalog refresh. Export the sole result set as CSV.
-- Catalog-only evidence: no application-table, auth-user, or business-row reads.
BEGIN TRANSACTION READ ONLY;

WITH RECURSIVE
packet_manifest AS (
  SELECT * FROM (VALUES
    ('packet', 'packet_identifier', 'operational-guardrails-current-catalog-refresh'),
    ('packet', 'packet_version', 'operational-guardrails-current-catalog-refresh-v1'),
    ('packet', 'expected_section_count', '20'),
    ('packet', 'target_relation', 'public.forum_upload_attempts'),
    ('packet', 'read_scope', 'PostgreSQL catalogs only; no application-table or auth-user rows')
  ) AS value(row_key, attribute, value)
),
target_indexes AS (
  SELECT * FROM (VALUES
    ('forum_upload_attempts_purpose_ip_created_idx', ARRAY['purpose', 'ip_hash', 'created_at DESC']::text[]),
    ('forum_upload_attempts_purpose_user_created_idx', ARRAY['purpose', 'user_id', 'created_at DESC']::text[])
  ) AS value(index_name, expected_keys)
),
target_policies AS (
  SELECT * FROM (VALUES
    ('forum_upload_attempts_insert_authenticated'), ('forum_upload_attempts_insert_self'),
    ('forum_upload_attempts_select_authenticated'), ('forum_upload_attempts_select_self')
  ) AS value(policy_name)
),
target_roles AS (
  SELECT * FROM (VALUES ('PUBLIC'::text), ('anon'), ('authenticated'), ('service_role'), ('postgres'), ('authenticator')) AS value(role_name)
),
relation_ref AS (
  SELECT c.oid, c.relacl, c.relowner, c.relrowsecurity, c.relforcerowsecurity, c.relkind, pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'forum_upload_attempts' AND c.relkind = 'r'
),
all_indexes AS (
  SELECT ic.oid, ic.relname AS index_name, am.amname AS access_method, pi.indisunique, pi.indisvalid, pi.indisready, pi.indislive,
    pi.indisprimary, pi.indisexclusion, pg_get_indexdef(ic.oid) AS definition, pg_get_expr(pi.indpred, pi.indrelid) AS predicate,
    ARRAY(SELECT pg_get_indexdef(ic.oid, position, true) FROM generate_series(1, pi.indnkeyatts) AS position) AS key_parts,
    ARRAY(SELECT pg_get_indexdef(ic.oid, position, true) FROM generate_series(pi.indnkeyatts + 1, pi.indnatts) AS position) AS included_parts,
    EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = ic.oid) AS constraint_backed
  FROM relation_ref relation_ref
  JOIN pg_index pi ON pi.indrelid = relation_ref.oid
  JOIN pg_class ic ON ic.oid = pi.indexrelid
  JOIN pg_am am ON am.oid = ic.relam
),
policy_catalog AS (
  SELECT p.oid, p.polname, p.polcmd, p.polpermissive,
    array_to_string(ARRAY(SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE coalesce(role_ref.rolname, 'UNKNOWN_ROLE_OID_' || role_oid::text) END FROM unnest(p.polroles) AS policy_role(role_oid) LEFT JOIN pg_roles role_ref ON role_ref.oid = policy_role.role_oid ORDER BY 1), ',') AS roles,
    pg_get_expr(p.polqual, p.polrelid) AS using_expression, pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expression
  FROM relation_ref relation_ref JOIN pg_policy p ON p.polrelid = relation_ref.oid
),
role_catalog AS (
  SELECT target.role_name, CASE WHEN target.role_name = 'PUBLIC' THEN 0::oid ELSE role_ref.oid END AS role_oid
  FROM target_roles target LEFT JOIN pg_roles role_ref ON role_ref.rolname = target.role_name AND target.role_name <> 'PUBLIC'
),
role_closure(subject_role, subject_oid, current_oid, path, depth, membership_kind) AS (
  SELECT role_name, role_oid, role_oid, ARRAY[role_oid], 0, 'SELF'::text COLLATE "C"
  FROM role_catalog WHERE role_oid IS NOT NULL AND role_name <> 'PUBLIC'
  UNION ALL
  SELECT closure.subject_role, closure.subject_oid, membership.roleid, closure.path || membership.roleid, closure.depth + 1,
    CASE WHEN closure.depth = 0 THEN 'DIRECT' ELSE 'TRANSITIVE' END::text COLLATE "C"
  FROM role_closure closure
  JOIN pg_auth_members membership ON membership.member = closure.current_oid
  WHERE NOT membership.roleid = ANY(closure.path)
),
relation_acl AS (
  SELECT entry.grantee, entry.grantor, entry.privilege_type, entry.is_grantable
  FROM relation_ref relation_ref
  CROSS JOIN LATERAL aclexplode(coalesce(relation_ref.relacl, acldefault('r', relation_ref.relowner))) AS entry
),
schema_ref AS (
  SELECT n.oid, n.nspacl, n.nspowner FROM pg_namespace n WHERE n.nspname = 'public'
),
schema_acl AS (
  SELECT entry.grantee, entry.grantor, entry.privilege_type, entry.is_grantable
  FROM schema_ref schema_ref
  CROSS JOIN LATERAL aclexplode(coalesce(schema_ref.nspacl, acldefault('n', schema_ref.nspowner))) AS entry
),
sequence_catalog AS (
  SELECT DISTINCT seq.oid, seq.relname AS sequence_name, seq.relacl, seq.relowner
  FROM relation_ref relation_ref
  JOIN pg_attribute attribute ON attribute.attrelid = relation_ref.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
  JOIN pg_attrdef definition ON definition.adrelid = relation_ref.oid AND definition.adnum = attribute.attnum
  JOIN pg_depend dependency ON dependency.classid = 'pg_attrdef'::regclass AND dependency.objid = definition.oid AND dependency.refclassid = 'pg_class'::regclass
  JOIN pg_class seq ON seq.oid = dependency.refobjid AND seq.relkind = 'S'
),
sequence_acl AS (
  SELECT sequence.sequence_name, entry.grantee, entry.grantor, entry.privilege_type, entry.is_grantable
  FROM sequence_catalog sequence
  CROSS JOIN LATERAL aclexplode(coalesce(sequence.relacl, acldefault('S', sequence.relowner))) AS entry
),
policy_function_dependencies AS (
  SELECT policy.polname AS policy_name, proc.oid, proc.oid::regprocedure::text AS function_signature
  FROM policy_catalog policy
  JOIN pg_depend dependency ON dependency.classid = 'pg_policy'::regclass AND dependency.objid = policy.oid AND dependency.refclassid = 'pg_proc'::regclass
  JOIN pg_proc proc ON proc.oid = dependency.refobjid
),
runtime_functions AS (
  SELECT proc.oid, proc.oid::regprocedure::text AS function_signature
  FROM pg_proc proc JOIN pg_namespace n ON n.oid = proc.pronamespace
  WHERE n.nspname = 'public' AND proc.proname = 'consume_verification_email_resend_limit'
),
relevant_functions AS (
  SELECT oid, function_signature FROM policy_function_dependencies
  UNION
  SELECT oid, function_signature FROM runtime_functions
),
function_acl AS (
  SELECT function_ref.function_signature, entry.grantee, entry.grantor, entry.privilege_type, entry.is_grantable
  FROM relevant_functions function_ref
  JOIN pg_proc proc ON proc.oid = function_ref.oid
  CROSS JOIN LATERAL aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) AS entry
),
packet_rows AS (
  SELECT 1 AS section_order, 'packet_manifest' AS section, row_key, 'public' AS object_schema, 'forum_upload_attempts' AS object_name, attribute, value, 'PRESENT' AS evidence_status, 'NON_SECURITY_DRIFT' AS security_classification FROM packet_manifest
  UNION ALL
  SELECT 2, 'target_relation_identity', 'public.forum_upload_attempts', 'public', 'forum_upload_attempts', 'catalog',
    CASE WHEN EXISTS (SELECT 1 FROM relation_ref) THEN json_build_object('exists', true, 'relation_kind', (SELECT relkind FROM relation_ref), 'owner', (SELECT owner FROM relation_ref))::text ELSE NULL END,
    CASE WHEN EXISTS (SELECT 1 FROM relation_ref) THEN 'PRESENT' ELSE 'MISSING' END, 'SECURITY_BROADENING'
  UNION ALL
  SELECT 3, 'all_table_indexes', coalesce(index_name, 'NO_TABLE_INDEXES'), 'public', 'forum_upload_attempts', 'catalog',
    CASE WHEN index_name IS NULL THEN NULL ELSE json_build_object('name', index_name, 'method', access_method, 'unique', indisunique, 'valid', indisvalid, 'ready', indisready, 'live', indislive, 'primary', indisprimary, 'exclusion', indisexclusion, 'definition', definition, 'key_parts', key_parts, 'predicate', predicate, 'included_parts', included_parts, 'constraint_backed', constraint_backed)::text END,
    CASE WHEN index_name IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING' FROM all_indexes
  UNION ALL SELECT 3, 'all_table_indexes', 'NO_TABLE_INDEXES', 'public', 'forum_upload_attempts', 'catalog', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE' WHERE NOT EXISTS (SELECT 1 FROM all_indexes)
  UNION ALL
  SELECT 4, 'target_index_evidence', target.index_name, 'public', 'forum_upload_attempts', 'expected_shape',
    json_build_object('name', target.index_name, 'method', 'btree', 'unique', false, 'keys', target.expected_keys, 'predicate', null, 'included_parts', ARRAY[]::text[])::text, 'PRESENT', 'SECURITY_BROADENING' FROM target_indexes target
  UNION ALL
  SELECT 5, 'equivalent_index_detection', target.index_name || '|' || coalesce(candidate.index_name, 'NO_CANDIDATE'), 'public', 'forum_upload_attempts', 'candidate',
    CASE WHEN candidate.index_name IS NULL THEN json_build_object('expected_name', target.index_name, 'expected_keys', target.expected_keys)::text ELSE json_build_object('expected_name', target.index_name, 'candidate_name', candidate.index_name, 'method', candidate.access_method, 'unique', candidate.indisunique, 'valid', candidate.indisvalid, 'ready', candidate.indisready, 'live', candidate.indislive, 'keys', candidate.key_parts, 'predicate', candidate.predicate, 'included_parts', candidate.included_parts)::text END,
    CASE WHEN candidate.index_name IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING' FROM target_indexes target LEFT JOIN all_indexes candidate ON true
  UNION ALL
  SELECT 6, 'all_table_policies', coalesce(policy.polname, 'NO_TABLE_POLICIES'), 'public', 'forum_upload_attempts', 'definition',
    CASE WHEN policy.polname IS NULL THEN NULL ELSE json_build_object('name', policy.polname, 'command', policy.polcmd, 'permissive', policy.polpermissive, 'roles', policy.roles, 'using', policy.using_expression, 'with_check', policy.with_check_expression)::text END,
    CASE WHEN policy.polname IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING' FROM policy_catalog policy
  UNION ALL SELECT 6, 'all_table_policies', 'NO_TABLE_POLICIES', 'public', 'forum_upload_attempts', 'definition', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE' WHERE NOT EXISTS (SELECT 1 FROM policy_catalog)
  UNION ALL
  SELECT 7, 'target_policy_evidence', target.policy_name, 'public', 'forum_upload_attempts', 'definition',
    CASE WHEN policy.polname IS NULL THEN NULL ELSE json_build_object('name', policy.polname, 'command', policy.polcmd, 'permissive', policy.polpermissive, 'roles', policy.roles, 'using', policy.using_expression, 'with_check', policy.with_check_expression)::text END,
    CASE WHEN policy.polname IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING' FROM target_policies target LEFT JOIN policy_catalog policy ON policy.polname = target.policy_name
  UNION ALL
  SELECT 8, 'rls_state', 'public.forum_upload_attempts', 'public', 'forum_upload_attempts', 'state',
    CASE WHEN EXISTS (SELECT 1 FROM relation_ref) THEN json_build_object('enabled', (SELECT relrowsecurity FROM relation_ref), 'forced', (SELECT relforcerowsecurity FROM relation_ref))::text ELSE NULL END,
    CASE WHEN EXISTS (SELECT 1 FROM relation_ref) THEN 'PRESENT' ELSE 'MISSING' END, 'SECURITY_BROADENING'
  UNION ALL
  SELECT 9, 'relation_acl_catalog', coalesce(CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END, 'NO_DIRECT_ACL_ENTRY'), 'public', 'forum_upload_attempts', 'entry',
    CASE WHEN acl.grantee IS NULL THEN NULL ELSE json_build_object('grantee_oid', acl.grantee, 'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END, 'privilege', acl.privilege_type, 'grantable', acl.is_grantable)::text END,
    CASE WHEN acl.grantee IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING' FROM relation_acl acl
  UNION ALL SELECT 9, 'relation_acl_catalog', 'NO_DIRECT_ACL_ENTRY', 'public', 'forum_upload_attempts', 'entry', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE' WHERE NOT EXISTS (SELECT 1 FROM relation_acl)
  UNION ALL
  SELECT 10, 'effective_table_privileges', role.role_name, 'public', 'forum_upload_attempts', 'effective',
    CASE WHEN role.role_name = 'PUBLIC' THEN json_build_object('role_exists', true, 'SELECT', EXISTS (SELECT 1 FROM relation_acl WHERE grantee = 0 AND privilege_type = 'SELECT'), 'INSERT', EXISTS (SELECT 1 FROM relation_acl WHERE grantee = 0 AND privilege_type = 'INSERT'))::text
         WHEN role.role_oid IS NULL THEN json_build_object('role_exists', false)::text
         ELSE json_build_object('role_exists', true, 'SELECT', has_table_privilege(role.role_name, 'public.forum_upload_attempts', 'SELECT'), 'INSERT', has_table_privilege(role.role_name, 'public.forum_upload_attempts', 'INSERT'))::text END,
    CASE WHEN role.role_oid IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING' FROM role_catalog role
  UNION ALL
  SELECT 11, 'role_membership_topology', closure.subject_role || '|' || closure.membership_kind || '|' || closure.depth::text, 'public', 'forum_upload_attempts', 'membership',
    json_build_object('subject_role', closure.subject_role, 'inherited_role', pg_get_userbyid(closure.current_oid), 'depth', closure.depth, 'kind', closure.membership_kind)::text, 'PRESENT', 'SECURITY_BROADENING' FROM role_closure closure
  UNION ALL
  SELECT 12, 'schema_acl_catalog', coalesce(CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END, 'NO_DIRECT_SCHEMA_ACL_ENTRY'), 'public', 'forum_upload_attempts', 'entry',
    CASE WHEN acl.grantee IS NULL THEN NULL ELSE json_build_object('grantee_oid', acl.grantee, 'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END, 'privilege', acl.privilege_type, 'grantable', acl.is_grantable)::text END,
    CASE WHEN acl.grantee IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING' FROM schema_acl acl
  UNION ALL SELECT 12, 'schema_acl_catalog', 'NO_DIRECT_SCHEMA_ACL_ENTRY', 'public', 'forum_upload_attempts', 'entry', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE' WHERE NOT EXISTS (SELECT 1 FROM schema_acl)
  UNION ALL
  SELECT 13, 'effective_schema_privileges', role.role_name, 'public', 'forum_upload_attempts', 'effective',
    CASE WHEN role.role_name = 'PUBLIC' THEN json_build_object('role_exists', true, 'USAGE', EXISTS (SELECT 1 FROM schema_acl WHERE grantee = 0 AND privilege_type = 'USAGE'), 'CREATE', EXISTS (SELECT 1 FROM schema_acl WHERE grantee = 0 AND privilege_type = 'CREATE'))::text
         WHEN role.role_oid IS NULL THEN json_build_object('role_exists', false)::text
         ELSE json_build_object('role_exists', true, 'USAGE', has_schema_privilege(role.role_name, 'public', 'USAGE'), 'CREATE', has_schema_privilege(role.role_name, 'public', 'CREATE'))::text END,
    CASE WHEN role.role_oid IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING' FROM role_catalog role
  UNION ALL
  SELECT 14, 'sequence_identity_dependencies', coalesce(sequence_name, 'NO_SEQUENCE_DEPENDENCY'), 'public', 'forum_upload_attempts', 'sequence',
    CASE WHEN sequence_name IS NULL THEN json_build_object('sequence_dependency', false)::text ELSE json_build_object('sequence_dependency', true, 'sequence_name', sequence_name)::text END,
    'PRESENT', 'SECURITY_BROADENING' FROM sequence_catalog
  UNION ALL SELECT 14, 'sequence_identity_dependencies', 'NO_SEQUENCE_DEPENDENCY', 'public', 'forum_upload_attempts', 'sequence', json_build_object('sequence_dependency', false)::text, 'PRESENT', 'SECURITY_BROADENING' WHERE NOT EXISTS (SELECT 1 FROM sequence_catalog)
  UNION ALL
  SELECT 15, 'sequence_acl_catalog', sequence.sequence_name || '|' || CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END, 'public', 'forum_upload_attempts', 'entry',
    json_build_object('sequence_name', sequence.sequence_name, 'grantee_oid', acl.grantee, 'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END, 'privilege', acl.privilege_type, 'grantable', acl.is_grantable)::text, 'PRESENT', 'SECURITY_BROADENING'
  FROM sequence_acl acl JOIN sequence_catalog sequence ON sequence.sequence_name = acl.sequence_name
  UNION ALL SELECT 15, 'sequence_acl_catalog', 'NO_SEQUENCE_ACL', 'public', 'forum_upload_attempts', 'entry', json_build_object('sequence_dependency', false)::text, 'PRESENT', 'SECURITY_BROADENING' WHERE NOT EXISTS (SELECT 1 FROM sequence_catalog)
  UNION ALL
  SELECT 16, 'relevant_function_catalog', coalesce(function_ref.function_signature, 'NO_RELEVANT_FUNCTION'), 'public', 'forum_upload_attempts', 'metadata',
    CASE WHEN function_ref.oid IS NULL THEN json_build_object('function_present', false)::text ELSE json_build_object('function_signature', function_ref.function_signature, 'owner', pg_get_userbyid(proc.proowner), 'security_definer', proc.prosecdef, 'search_path', coalesce(array_to_string(proc.proconfig, ','), ''), 'return_type', pg_get_function_result(proc.oid), 'body_md5', md5(pg_get_functiondef(proc.oid)))::text END,
    CASE WHEN function_ref.oid IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING' FROM relevant_functions function_ref JOIN pg_proc proc ON proc.oid = function_ref.oid
  UNION ALL SELECT 16, 'relevant_function_catalog', 'NO_RELEVANT_FUNCTION', 'public', 'forum_upload_attempts', 'metadata', json_build_object('function_present', false)::text, 'PRESENT', 'INSUFFICIENT_EVIDENCE' WHERE NOT EXISTS (SELECT 1 FROM relevant_functions)
  UNION ALL
  SELECT 17, 'function_acl_catalog', coalesce(function_acl.function_signature, 'NO_FUNCTION_ACL'), 'public', 'forum_upload_attempts', 'entry',
    CASE WHEN function_acl.function_signature IS NULL THEN json_build_object('function_acl', false)::text ELSE json_build_object('function_signature', function_acl.function_signature, 'grantee_oid', function_acl.grantee, 'grantee', CASE WHEN function_acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(function_acl.grantee) END, 'privilege', function_acl.privilege_type, 'grantable', function_acl.is_grantable)::text END,
    CASE WHEN function_acl.function_signature IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING' FROM function_acl
  UNION ALL SELECT 17, 'function_acl_catalog', 'NO_FUNCTION_ACL', 'public', 'forum_upload_attempts', 'entry', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE' WHERE NOT EXISTS (SELECT 1 FROM function_acl)
  UNION ALL
  SELECT 18, 'policy_function_dependency_catalog', coalesce(dependency.policy_name || '|' || dependency.function_signature, 'NO_POLICY_FUNCTION_DEPENDENCY'), 'public', 'forum_upload_attempts', 'dependency',
    CASE WHEN dependency.policy_name IS NULL THEN json_build_object('dependency', false)::text ELSE json_build_object('policy_name', dependency.policy_name, 'function_signature', dependency.function_signature)::text END,
    'PRESENT', 'SECURITY_BROADENING' FROM policy_function_dependencies dependency
  UNION ALL SELECT 18, 'policy_function_dependency_catalog', 'NO_POLICY_FUNCTION_DEPENDENCY', 'public', 'forum_upload_attempts', 'dependency', json_build_object('dependency', false)::text, 'PRESENT', 'SECURITY_BROADENING' WHERE NOT EXISTS (SELECT 1 FROM policy_function_dependencies)
  UNION ALL
  SELECT 19, 'runtime_contract_manifest', row_key, 'public', 'forum_upload_attempts', attribute, value, 'PRESENT', 'SECURITY_BROADENING'
  FROM (VALUES
    ('server_rate_limit', 'caller', 'src/lib/server/rate-limit.ts'),
    ('direct_table_path', 'operations', 'authenticated SELECT and INSERT are currently required by enforceUserRateLimit and enforceUploadRateLimit'),
    ('approved_architecture', 'decision', 'server-only atomic fail-closed RPC; no direct client table privileges'),
    ('policy_removal_gate', 'condition', 'hold until runtime callers are migrated and verified')
  ) AS value(row_key, attribute, value)
  UNION ALL
  SELECT 20, 'object_fingerprints', row_key, 'public', 'forum_upload_attempts', attribute, value, 'PRESENT', 'SECURITY_BROADENING'
  FROM (
    SELECT 'relation' AS row_key, 'relation_metadata_md5' AS attribute, md5(coalesce((SELECT relrowsecurity::text || '|' || relforcerowsecurity::text || '|' || relowner::text || '|' || coalesce(relacl::text, '') FROM relation_ref), 'MISSING')) AS value
    UNION ALL SELECT 'indexes', 'all_index_catalog_md5', md5(coalesce((SELECT string_agg(index_name || '|' || definition || '|' || indisvalid::text || '|' || indisready::text || '|' || indislive::text, E'\n' ORDER BY index_name) FROM all_indexes), 'MISSING'))
    UNION ALL SELECT 'policies', 'all_policy_catalog_md5', md5(coalesce((SELECT string_agg(polname || '|' || polcmd::text || '|' || polpermissive::text || '|' || coalesce(roles, '') || '|' || coalesce(using_expression, '') || '|' || coalesce(with_check_expression, ''), E'\n' ORDER BY polname) FROM policy_catalog), 'MISSING'))
  ) AS fingerprints
)
SELECT 'operational-guardrails-current-catalog-refresh-v1' AS packet_version, section_order, section, row_key, object_schema, object_name, attribute, value, evidence_status, security_classification
FROM packet_rows
ORDER BY section_order, section, row_key, attribute;

ROLLBACK;
