-- W6 supplemental catalog packet. Export the sole result set as CSV.
BEGIN TRANSACTION READ ONLY;

WITH
target_indexes AS (
  SELECT * FROM (VALUES
    ('forum_upload_attempts_purpose_ip_created_idx', ARRAY['purpose', 'ip_hash', 'created_at DESC']::text[]),
    ('forum_upload_attempts_purpose_user_created_idx', ARRAY['purpose', 'user_id', 'created_at DESC']::text[])
  ) AS value(index_name, expected_keys)
),
target_policies AS (
  SELECT * FROM (VALUES
    ('forum_upload_attempts_insert_authenticated'), ('forum_upload_attempts_select_authenticated'),
    ('forum_upload_attempts_insert_self'), ('forum_upload_attempts_select_self')
  ) AS value(policy_name)
),
relation_ref AS (
  SELECT c.oid, c.relacl, c.relowner, c.relrowsecurity, c.relforcerowsecurity, c.relkind, pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'forum_upload_attempts' AND c.relkind = 'r'
),
all_indexes AS (
  SELECT ic.oid, ic.relname AS index_name, am.amname AS access_method, pi.indisunique, pi.indisvalid, pi.indisready,
    pi.indisprimary, pi.indisexclusion, pg_get_indexdef(ic.oid) AS definition, pg_get_expr(pi.indpred, pi.indrelid) AS predicate,
    ARRAY(SELECT pg_get_indexdef(ic.oid, position, true) FROM generate_series(1, pi.indnkeyatts) AS position) AS key_parts,
    ARRAY(SELECT pg_get_indexdef(ic.oid, position, true) FROM generate_series(pi.indnkeyatts + 1, pi.indnatts) AS position) AS included_parts,
    EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = ic.oid) AS constraint_backed,
    pg_relation_size(ic.oid) AS size_bytes
  FROM relation_ref relation_ref
  JOIN pg_index pi ON pi.indrelid = relation_ref.oid
  JOIN pg_class ic ON ic.oid = pi.indexrelid
  JOIN pg_am am ON am.oid = ic.relam
),
policy_catalog AS (
  SELECT p.oid, p.polname, p.polcmd, p.polpermissive,
    array_to_string(ARRAY(SELECT CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC' ELSE coalesce(role_ref.rolname, 'UNKNOWN_ROLE_OID_' || policy_role.role_oid::text) END FROM unnest(p.polroles) AS policy_role(role_oid) LEFT JOIN pg_roles role_ref ON role_ref.oid = policy_role.role_oid ORDER BY 1), ',') AS roles,
    ARRAY(SELECT policy_role.role_oid::text FROM unnest(p.polroles) AS policy_role(role_oid) ORDER BY 1) AS role_oids,
    pg_get_expr(p.polqual, p.polrelid) AS using_expression, pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expression
  FROM relation_ref relation_ref JOIN pg_policy p ON p.polrelid = relation_ref.oid
),
acl_catalog AS (
  SELECT entry.grantee, entry.grantor, entry.privilege_type, entry.is_grantable
  FROM relation_ref relation_ref CROSS JOIN LATERAL aclexplode(coalesce(relation_ref.relacl, acldefault('r', relation_ref.relowner))) AS entry
),
actual_roles AS (
  SELECT target.role_name, role_ref.oid
  FROM (VALUES ('anon'::text), ('authenticated'), ('service_role'), ('postgres')) AS target(role_name)
  LEFT JOIN pg_roles role_ref ON role_ref.rolname = target.role_name
),
packet_rows AS (
  SELECT 1 AS section_order, 'packet_manifest' AS section, row_key, 'public' AS object_schema, 'forum_upload_attempts' AS object_name, attribute, value, 'PRESENT' AS evidence_status, 'NON_SECURITY_DRIFT' AS security_classification
  FROM (VALUES
    ('packet', 'packet_identifier', 'operational-guardrails-production-preflight-supplemental'),
    ('packet', 'packet_version', 'operational-guardrails-supplemental-preflight-v1'),
    ('packet', 'expected_section_count', '10'),
    ('packet', 'target_relation', 'public.forum_upload_attempts'),
    ('packet', 'read_scope', 'PostgreSQL catalogs only; no application-table rows')
  ) AS value(row_key, attribute, value)
  UNION ALL
  SELECT 2, 'all_table_indexes', coalesce(index_name, 'NO_TABLE_INDEXES'), 'public', 'forum_upload_attempts', 'catalog',
    CASE WHEN index_name IS NULL THEN NULL ELSE json_build_object('name', index_name, 'method', access_method, 'unique', indisunique, 'valid', indisvalid, 'ready', indisready, 'primary', indisprimary, 'exclusion', indisexclusion, 'definition', definition, 'key_parts', key_parts, 'predicate', predicate, 'included_parts', included_parts, 'constraint_backed', constraint_backed, 'size_bytes', size_bytes)::text END,
    CASE WHEN index_name IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM all_indexes
  UNION ALL
  SELECT 2, 'all_table_indexes', 'NO_TABLE_INDEXES', 'public', 'forum_upload_attempts', 'catalog', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE'
  WHERE NOT EXISTS (SELECT 1 FROM all_indexes)
  UNION ALL
  SELECT 3, 'target_index_equivalence_evidence', target.index_name || '|' || coalesce(candidate.index_name, 'NO_CANDIDATE'), 'public', 'forum_upload_attempts', 'candidate',
    CASE WHEN candidate.index_name IS NULL THEN json_build_object('expected_name', target.index_name, 'expected_method', 'btree', 'expected_unique', false, 'expected_keys', target.expected_keys, 'expected_predicate', null, 'expected_included_parts', ARRAY[]::text[])::text ELSE json_build_object('expected_name', target.index_name, 'expected_method', 'btree', 'expected_unique', false, 'expected_keys', target.expected_keys, 'expected_predicate', null, 'expected_included_parts', ARRAY[]::text[], 'candidate_name', candidate.index_name, 'candidate_method', candidate.access_method, 'candidate_unique', candidate.indisunique, 'candidate_valid', candidate.indisvalid, 'candidate_ready', candidate.indisready, 'candidate_keys', candidate.key_parts, 'candidate_predicate', candidate.predicate, 'candidate_included_parts', candidate.included_parts)::text END,
    CASE WHEN candidate.index_name IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM target_indexes target LEFT JOIN all_indexes candidate ON true
  UNION ALL
  SELECT 4, 'relevant_policies', target.policy_name, 'public', 'forum_upload_attempts', 'definition',
    CASE WHEN policy.polname IS NULL THEN NULL ELSE json_build_object('name', policy.polname, 'command', policy.polcmd, 'permissive', policy.polpermissive, 'roles', policy.roles, 'role_oids', policy.role_oids, 'using', policy.using_expression, 'with_check', policy.with_check_expression, 'normalized_definition', regexp_replace(concat_ws(' ', policy.polcmd, policy.polpermissive::text, policy.roles, policy.using_expression, policy.with_check_expression), '\\s+', ' ', 'g'))::text END,
    CASE WHEN policy.polname IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM target_policies target LEFT JOIN policy_catalog policy ON policy.polname = target.policy_name
  UNION ALL
  SELECT 5, 'all_table_policies', coalesce(policy.polname, 'NO_TABLE_POLICIES'), 'public', 'forum_upload_attempts', 'definition',
    CASE WHEN policy.polname IS NULL THEN NULL ELSE json_build_object('name', policy.polname, 'command', policy.polcmd, 'permissive', policy.polpermissive, 'roles', policy.roles, 'role_oids', policy.role_oids, 'using', policy.using_expression, 'with_check', policy.with_check_expression, 'normalized_definition', regexp_replace(concat_ws(' ', policy.polcmd, policy.polpermissive::text, policy.roles, policy.using_expression, policy.with_check_expression), '\\s+', ' ', 'g'))::text END,
    CASE WHEN policy.polname IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM policy_catalog policy
  UNION ALL
  SELECT 5, 'all_table_policies', 'NO_TABLE_POLICIES', 'public', 'forum_upload_attempts', 'definition', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE'
  WHERE NOT EXISTS (SELECT 1 FROM policy_catalog)
  UNION ALL
  SELECT 6, 'relation_acl_catalog', coalesce(CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END, 'NO_DIRECT_ACL_ENTRY'), 'public', 'forum_upload_attempts', 'entry',
    CASE WHEN acl.grantee IS NULL THEN NULL ELSE json_build_object('grantee_oid', acl.grantee, 'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END, 'grantor_oid', acl.grantor, 'privilege', acl.privilege_type, 'grantable', acl.is_grantable)::text END,
    CASE WHEN acl.grantee IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM acl_catalog acl
  UNION ALL
  SELECT 6, 'relation_acl_catalog', 'NO_DIRECT_ACL_ENTRY', 'public', 'forum_upload_attempts', 'entry', NULL, 'MISSING', 'INSUFFICIENT_EVIDENCE'
  WHERE NOT EXISTS (SELECT 1 FROM acl_catalog)
  UNION ALL
  SELECT 7, 'effective_role_privileges', role.role_name, 'public', 'forum_upload_attempts', 'effective',
    json_build_object('role_exists', role.oid IS NOT NULL, 'SELECT', CASE WHEN role.oid IS NULL THEN NULL ELSE has_table_privilege(role.role_name, 'public.forum_upload_attempts', 'SELECT') END, 'INSERT', CASE WHEN role.oid IS NULL THEN NULL ELSE has_table_privilege(role.role_name, 'public.forum_upload_attempts', 'INSERT') END, 'UPDATE', CASE WHEN role.oid IS NULL THEN NULL ELSE has_table_privilege(role.role_name, 'public.forum_upload_attempts', 'UPDATE') END, 'DELETE', CASE WHEN role.oid IS NULL THEN NULL ELSE has_table_privilege(role.role_name, 'public.forum_upload_attempts', 'DELETE') END, 'TRUNCATE', CASE WHEN role.oid IS NULL THEN NULL ELSE has_table_privilege(role.role_name, 'public.forum_upload_attempts', 'TRUNCATE') END, 'REFERENCES', CASE WHEN role.oid IS NULL THEN NULL ELSE has_table_privilege(role.role_name, 'public.forum_upload_attempts', 'REFERENCES') END, 'TRIGGER', CASE WHEN role.oid IS NULL THEN NULL ELSE has_table_privilege(role.role_name, 'public.forum_upload_attempts', 'TRIGGER') END)::text,
    CASE WHEN role.oid IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM actual_roles role
  UNION ALL
  SELECT 8, 'rls_state', 'public.forum_upload_attempts', 'public', 'forum_upload_attempts', 'state',
    CASE WHEN EXISTS (SELECT 1 FROM relation_ref) THEN json_build_object('exists', true, 'rls_enabled', (SELECT relrowsecurity FROM relation_ref), 'rls_forced', (SELECT relforcerowsecurity FROM relation_ref), 'owner', (SELECT owner FROM relation_ref), 'relation_kind', (SELECT relkind FROM relation_ref))::text ELSE NULL END,
    CASE WHEN EXISTS (SELECT 1 FROM relation_ref) THEN 'PRESENT' ELSE 'MISSING' END, 'SECURITY_BROADENING'
  UNION ALL
  SELECT 9, 'policy_dependency_catalog', target.policy_name || '|' || coalesce(proc_ref.oid::regprocedure::text, 'NO_FUNCTION_DEPENDENCY'), 'public', 'forum_upload_attempts', 'dependency',
    CASE WHEN policy.oid IS NULL THEN NULL WHEN proc_ref.oid IS NULL THEN json_build_object('policy_present', true, 'referenced_function', null)::text ELSE json_build_object('policy_present', true, 'referenced_function', proc_ref.oid::regprocedure::text)::text END,
    CASE WHEN policy.oid IS NULL THEN 'MISSING' WHEN proc_ref.oid IS NULL THEN 'PRESENT' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM target_policies target LEFT JOIN policy_catalog policy ON policy.polname = target.policy_name LEFT JOIN pg_depend dependency ON dependency.classid = 'pg_policy'::regclass AND dependency.objid = policy.oid AND dependency.refclassid = 'pg_proc'::regclass LEFT JOIN pg_proc proc_ref ON proc_ref.oid = dependency.refobjid
  UNION ALL
  SELECT 10, 'runtime_contract_manifest', row_key, 'public', 'forum_upload_attempts', attribute, value, 'PRESENT', 'SECURITY_BROADENING'
  FROM (VALUES
    ('canonical_insert_policy', 'name', 'forum_upload_attempts_insert_authenticated'),
    ('canonical_select_policy', 'name', 'forum_upload_attempts_select_authenticated'),
    ('extra_insert_policy', 'name', 'forum_upload_attempts_insert_self'),
    ('extra_select_policy', 'name', 'forum_upload_attempts_select_self'),
    ('purposes', 'valid_values', 'post_media_upload,external_video_upload,post_create,comment_create,circle_create,verification_email_resend'),
    ('data_scope', 'rows', 'no individual business rows')
  ) AS value(row_key, attribute, value)
)
SELECT 'operational-guardrails-supplemental-preflight-v1' AS packet_version, section_order, section, row_key, object_schema, object_name, attribute, value, evidence_status, security_classification
FROM packet_rows
ORDER BY section_order, section, row_key, attribute;

ROLLBACK;
