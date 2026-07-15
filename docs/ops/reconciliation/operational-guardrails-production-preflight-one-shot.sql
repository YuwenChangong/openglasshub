-- W6 operational guardrails: one result set, catalog plus aggregate-only evidence.
-- Run only in the confirmed production SQL editor and export the sole result set.
BEGIN TRANSACTION READ ONLY;

WITH
packet_manifest AS (
  SELECT * FROM (VALUES
    ('operational-guardrails-production-preflight', 'packet_identifier', 'operational-guardrails-production-preflight'),
    ('operational-guardrails-production-preflight', 'packet_version', 'operational-guardrails-preflight-v1'),
    ('operational-guardrails-production-preflight', 'expected_section_count', '9'),
    ('operational-guardrails-production-preflight', 'target_relation', 'public.forum_upload_attempts'),
    ('operational-guardrails-production-preflight', 'read_scope', 'PostgreSQL catalogs plus aggregate-only forum_upload_attempts safety counts')
  ) AS value(row_key, attribute, value)
),
target_columns AS (
  SELECT * FROM (VALUES ('user_id'), ('purpose'), ('ip_hash'), ('bytes'), ('created_at')) AS value(column_name)
),
target_indexes AS (
  SELECT * FROM (VALUES
    ('forum_upload_attempts_purpose_ip_created_idx', 'CREATE INDEX forum_upload_attempts_purpose_ip_created_idx ON public.forum_upload_attempts USING btree (purpose, ip_hash, created_at DESC)'),
    ('forum_upload_attempts_purpose_user_created_idx', 'CREATE INDEX forum_upload_attempts_purpose_user_created_idx ON public.forum_upload_attempts USING btree (purpose, user_id, created_at DESC)')
  ) AS value(index_name, expected_definition)
),
target_policies AS (
  SELECT * FROM (VALUES ('forum_upload_attempts_insert_self', 'INSERT'), ('forum_upload_attempts_select_self', 'SELECT')) AS value(policy_name, command_name)
),
relation_ref AS (
  SELECT c.oid, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'forum_upload_attempts' AND c.relkind = 'r'
),
packet_rows AS (
  SELECT 1 AS section_order, 'packet_manifest' AS section, row_key, 'public' AS object_schema, 'forum_upload_attempts' AS object_name, attribute, value, 'PRESENT' AS evidence_status, 'NON_SECURITY_DRIFT' AS security_classification FROM packet_manifest
  UNION ALL
  SELECT 2, 'attempts_relation_rls_acl', 'public.forum_upload_attempts', 'public', 'forum_upload_attempts', 'present', CASE WHEN EXISTS (SELECT 1 FROM relation_ref) THEN 'true' ELSE NULL END, CASE WHEN EXISTS (SELECT 1 FROM relation_ref) THEN 'PRESENT' ELSE 'MISSING' END, 'SECURITY_BROADENING'
  UNION ALL
  SELECT 2, 'attempts_relation_rls_acl', 'public', 'public', 'forum_upload_attempts', 'metadata', CASE WHEN EXISTS (SELECT 1 FROM relation_ref) THEN json_build_object('rls_enabled', (SELECT relrowsecurity FROM relation_ref), 'rls_forced', (SELECT relforcerowsecurity FROM relation_ref), 'owner', (SELECT owner FROM relation_ref))::text ELSE NULL END, CASE WHEN EXISTS (SELECT 1 FROM relation_ref) THEN 'PRESENT' ELSE 'MISSING' END, 'SECURITY_BROADENING'
  UNION ALL
  SELECT 3, 'attempts_columns', tc.column_name, 'public', 'forum_upload_attempts', 'definition', CASE WHEN a.attname IS NULL THEN NULL ELSE json_build_object('type', pg_catalog.format_type(a.atttypid, a.atttypmod), 'nullable', NOT a.attnotnull)::text END, CASE WHEN a.attname IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'INSUFFICIENT_EVIDENCE'
  FROM target_columns tc LEFT JOIN relation_ref r ON true LEFT JOIN pg_attribute a ON a.attrelid = r.oid AND a.attname = tc.column_name AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 4, 'expected_indexes', ti.index_name, 'public', 'forum_upload_attempts', 'definition', CASE WHEN pi.indexrelid IS NULL THEN NULL ELSE pg_get_indexdef(pi.indexrelid) END, CASE WHEN pi.indexrelid IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM target_indexes ti LEFT JOIN pg_class idx ON idx.relname = ti.index_name LEFT JOIN pg_namespace ns ON ns.oid = idx.relnamespace AND ns.nspname = 'public' LEFT JOIN pg_index pi ON pi.indexrelid = idx.oid AND pi.indrelid = 'public.forum_upload_attempts'::regclass
  UNION ALL
  SELECT 5, 'extra_policies', tp.policy_name, 'public', 'forum_upload_attempts', 'definition', CASE WHEN p.polname IS NULL THEN NULL ELSE json_build_object('command', p.polcmd, 'permissive', p.polpermissive, 'roles', array_to_string(ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY (p.polroles) ORDER BY rolname), ','), 'using', pg_get_expr(p.polqual, p.polrelid), 'with_check', pg_get_expr(p.polwithcheck, p.polrelid))::text END, CASE WHEN p.polname IS NULL THEN 'MISSING' ELSE 'PRESENT' END, 'SECURITY_BROADENING'
  FROM target_policies tp LEFT JOIN pg_policy p ON p.polrelid = 'public.forum_upload_attempts'::regclass AND p.polname = tp.policy_name
  UNION ALL
  SELECT 6, 'attempts_table_acl', 'public.forum_upload_attempts', 'public', 'forum_upload_attempts', 'acl', CASE WHEN EXISTS (SELECT 1 FROM relation_ref) THEN json_build_object('PUBLIC', has_table_privilege('PUBLIC', 'public.forum_upload_attempts', 'SELECT,INSERT,UPDATE,DELETE'), 'anon', has_table_privilege('anon', 'public.forum_upload_attempts', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated', has_table_privilege('authenticated', 'public.forum_upload_attempts', 'SELECT,INSERT,UPDATE,DELETE'), 'service_role', has_table_privilege('service_role', 'public.forum_upload_attempts', 'SELECT,INSERT,UPDATE,DELETE'))::text ELSE NULL END, CASE WHEN EXISTS (SELECT 1 FROM relation_ref) THEN 'PRESENT' ELSE 'MISSING' END, 'SECURITY_BROADENING'
  UNION ALL
  SELECT 7, 'aggregate_safety_counts', metric, 'public', 'forum_upload_attempts', metric, value::text, 'PRESENT', 'NON_SECURITY_DRIFT'
  FROM (
    SELECT 'total_attempt_count' AS metric, count(*)::bigint AS value FROM public.forum_upload_attempts
    UNION ALL SELECT 'null_user_id_count', count(*) FILTER (WHERE user_id IS NULL) FROM public.forum_upload_attempts
    UNION ALL SELECT 'null_purpose_count', count(*) FILTER (WHERE purpose IS NULL) FROM public.forum_upload_attempts
    UNION ALL SELECT 'null_ip_hash_count', count(*) FILTER (WHERE ip_hash IS NULL) FROM public.forum_upload_attempts
    UNION ALL SELECT 'negative_bytes_count', count(*) FILTER (WHERE bytes < 0) FROM public.forum_upload_attempts
    UNION ALL SELECT 'unknown_purpose_count', count(*) FILTER (WHERE purpose IS NOT NULL AND purpose NOT IN ('post_media_upload', 'external_video_upload', 'post_create', 'comment_create', 'circle_create')) FROM public.forum_upload_attempts
  ) aggregate_counts
  UNION ALL
  SELECT 8, 'runtime_dependency_contract', row_key, 'public', 'forum_upload_attempts', attribute, value, 'PRESENT', 'SECURITY_BROADENING'
  FROM (VALUES
    ('rate_limit', 'runtime_caller', 'src/lib/server/rate-limit.ts'),
    ('external_video_upload', 'runtime_caller', 'src/pages/api/forum/external-video-upload.ts'),
    ('purposes', 'allowed_purposes', 'post_media_upload,external_video_upload,post_create,comment_create,circle_create'),
    ('policy_intent', 'expected_extra_policies', 'forum_upload_attempts_insert_self and forum_upload_attempts_select_self are expected absent')
  ) AS value(row_key, attribute, value)
  UNION ALL
  SELECT 9, 'dependent_catalog_objects', row_key, 'public', 'forum_upload_attempts', attribute, value, 'PRESENT', 'SECURITY_BROADENING'
  FROM (VALUES
    ('table', 'required_relation', 'public.forum_upload_attempts'),
    ('indexes', 'expected_indexes', 'forum_upload_attempts_purpose_ip_created_idx,forum_upload_attempts_purpose_user_created_idx'),
    ('policies', 'extra_policy_review', 'forum_upload_attempts_insert_self,forum_upload_attempts_select_self')
  ) AS value(row_key, attribute, value)
)
SELECT 'operational-guardrails-preflight-v1' AS packet_version, section_order, section, row_key, object_schema, object_name, attribute, value, evidence_status, security_classification
FROM packet_rows
ORDER BY section_order, section, row_key, attribute;

ROLLBACK;
