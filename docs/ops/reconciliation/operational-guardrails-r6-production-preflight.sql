-- UNEXECUTED R6-2. One catalog-only statement; it returns one redacted result set.
-- The offline validator binds the safe expected target marker before execution.
WITH target AS (
  SELECT to_regclass('public.forum_upload_attempts') AS relation_oid,
         md5(current_database()) AS database_fingerprint
), relation_state AS (
  SELECT c.oid, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls
  FROM pg_catalog.pg_class c
  JOIN target t ON t.relation_oid = c.oid
), required_columns(column_name, expected_type, expected_nullable, expected_default) AS (
  VALUES
    ('user_id'::text, 'uuid'::text, 'YES'::text, ''::text),
    ('purpose', 'text', 'NO', ''),
    ('ip_hash', 'text', 'NO', ''),
    ('bytes', 'bigint', 'NO', '0'),
    ('created_at', 'timestamp with time zone', 'NO', 'now()')
), column_state AS (
  SELECT rc.column_name,
         coalesce(format_type(a.atttypid, a.atttypmod), '') = rc.expected_type
           AND CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END = rc.expected_nullable
           AND (rc.expected_default = '' OR coalesce(pg_get_expr(d.adbin, d.adrelid), '') LIKE rc.expected_default || '%') AS matches
  FROM required_columns rc
  LEFT JOIN relation_state rs ON true
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = rs.oid AND a.attname = rc.column_name
    AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
), indexes AS (
  SELECT i.indexrelid, n.relname, i.indisvalid, i.indisready, i.indislive,
         regexp_replace(pg_get_indexdef(i.indexrelid), '\\s+', ' ', 'g') AS definition
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class n ON n.oid = i.indexrelid
  JOIN relation_state rs ON rs.oid = i.indrelid
), index_state AS (
  SELECT
    coalesce(bool_or(relname = 'forum_upload_attempts_purpose_ip_created_idx'
      AND indisvalid AND indisready AND indislive
      AND definition = 'CREATE INDEX forum_upload_attempts_purpose_ip_created_idx ON public.forum_upload_attempts USING btree (purpose, ip_hash, created_at DESC)'), false) AS ip_exact,
    coalesce(bool_or(relname = 'forum_upload_attempts_purpose_user_created_idx'
      AND indisvalid AND indisready AND indislive
      AND definition = 'CREATE INDEX forum_upload_attempts_purpose_user_created_idx ON public.forum_upload_attempts USING btree (purpose, user_id, created_at DESC)'), false) AS user_exact,
    count(*) FILTER (WHERE definition IN (
      'CREATE INDEX forum_upload_attempts_purpose_ip_created_idx ON public.forum_upload_attempts USING btree (purpose, ip_hash, created_at DESC)',
      'CREATE INDEX forum_upload_attempts_purpose_user_created_idx ON public.forum_upload_attempts USING btree (purpose, user_id, created_at DESC)'
    )) = 2 AS no_equivalent_conflict,
    md5(coalesce(string_agg(relname || ':' || md5(definition) || ':' || indisvalid || ':' || indisready || ':' || indislive, '|' ORDER BY relname), '')) AS index_fingerprint
  FROM indexes
), policies AS (
  SELECT policyname, cmd, roles, qual, with_check
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND tablename = 'forum_upload_attempts'
), policy_state AS (
  SELECT count(*) >= 1 AS inventory_present,
         md5(coalesce(string_agg(policyname || ':' || cmd || ':' || md5(coalesce(qual, '')) || ':' || md5(coalesce(with_check, '')), '|' ORDER BY policyname, cmd), '')) AS policy_fingerprint
  FROM policies
), roles(role_name) AS (
  VALUES ('PUBLIC'::text), ('anon'), ('authenticated'), ('service_role'), ('postgres')
), table_privileges AS (
  SELECT r.role_name,
    CASE WHEN r.role_name = 'PUBLIC' THEN EXISTS (
      SELECT 1 FROM relation_state rs, LATERAL aclexplode(coalesce((SELECT relacl FROM pg_catalog.pg_class WHERE oid = rs.oid), acldefault('r', (SELECT relowner FROM pg_catalog.pg_class WHERE oid = rs.oid)))) a
      WHERE a.grantee = 0 AND a.privilege_type = 'SELECT'
    ) ELSE coalesce(has_table_privilege(r.role_name, (SELECT oid FROM relation_state), 'SELECT'), false) END AS effective_select,
    CASE WHEN r.role_name = 'PUBLIC' THEN EXISTS (
      SELECT 1 FROM relation_state rs, LATERAL aclexplode(coalesce((SELECT relacl FROM pg_catalog.pg_class WHERE oid = rs.oid), acldefault('r', (SELECT relowner FROM pg_catalog.pg_class WHERE oid = rs.oid)))) a
      WHERE a.grantee = 0 AND a.privilege_type = 'INSERT'
    ) ELSE coalesce(has_table_privilege(r.role_name, (SELECT oid FROM relation_state), 'INSERT'), false) END AS effective_insert
  FROM roles r
), grant_state AS (
  SELECT md5(string_agg(role_name || ':' || effective_select || ':' || effective_insert, '|' ORDER BY role_name)) AS grant_fingerprint
  FROM table_privileges
), target_function AS (
  SELECT p.oid, p.proowner, p.prosecdef, p.provolatile, p.proparallel, p.proleakproof, p.proconfig, p.proacl,
         pg_get_function_identity_arguments(p.oid) AS arguments,
         pg_get_function_result(p.oid) AS result_identity
  FROM pg_catalog.pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'consume_forum_rate_limit'
), function_state AS (
  SELECT count(*) AS overload_count,
    count(*) FILTER (WHERE arguments = 'p_user_id uuid, p_ip_hash text, p_purpose text, p_bytes bigint') AS exact_signature_count,
    coalesce(bool_and(pg_get_userbyid(proowner) = 'postgres'), false) AS owner_postgres,
    coalesce(bool_and(prosecdef), false) AS security_definer,
    coalesce(bool_and(provolatile = 'v'), false) AS volatile,
    coalesce(bool_and(proparallel = 'u'), false) AS parallel_unsafe,
    coalesce(bool_and(NOT proleakproof), false) AS non_leakproof,
    coalesce(bool_and(result_identity = 'TABLE(allowed boolean, decision text)'), false) AS return_identity,
    coalesce(bool_and(proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp', 'lock_timeout=1s', 'statement_timeout=3s']), false) AS reviewed_config,
    md5(coalesce(string_agg(md5(arguments || '|' || result_identity || '|' || proowner::text || '|' || prosecdef::text || '|' || provolatile::text || '|' || proparallel::text || '|' || proleakproof::text || '|' || coalesce(array_to_string(proconfig, ','), '')), '|' ORDER BY oid), '')) AS function_fingerprint
  FROM target_function
), function_acl AS (
  SELECT r.role_name,
    CASE WHEN r.role_name = 'PUBLIC' THEN coalesce(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false)
         ELSE coalesce(bool_or(pg_catalog.has_function_privilege(r.role_name, f.oid, 'EXECUTE')), false) END AS effective_execute
  FROM roles r
  LEFT JOIN target_function f ON true
  LEFT JOIN LATERAL aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a ON true
  GROUP BY r.role_name
), function_acl_state AS (
  SELECT coalesce(bool_or(role_name = 'PUBLIC' AND effective_execute), false) AS public_execute,
    coalesce(bool_or(role_name = 'anon' AND effective_execute), false) AS anon_execute,
    coalesce(bool_or(role_name = 'authenticated' AND effective_execute), false) AS authenticated_execute,
    coalesce(bool_or(role_name = 'service_role' AND effective_execute), false) AS service_role_execute,
    md5(coalesce(string_agg(role_name || ':' || effective_execute, '|' ORDER BY role_name), '')) AS acl_fingerprint
  FROM function_acl
), resend_state AS (
  SELECT count(*) = 1 AS separate_resend_function
  FROM pg_catalog.pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'consume_verification_email_resend'
), checks AS (
  SELECT * FROM (VALUES
    (10, 'target_database_fingerprint', 'database', 'offline-bound safe target marker', (SELECT database_fingerprint FROM target), true),
    (20, 'attempts_relation', 'public.forum_upload_attempts', 'present', (SELECT (relation_oid IS NOT NULL)::text FROM target), (SELECT relation_oid IS NOT NULL FROM target)),
    (30, 'required_columns', 'public.forum_upload_attempts', 'five exact reviewed columns', (SELECT count(*) FILTER (WHERE matches)::text FROM column_state), (SELECT count(*) = 5 AND bool_and(matches) FROM column_state)),
    (40, 'index_ip_exact', 'forum_upload_attempts_purpose_ip_created_idx', 'valid-ready-live exact definition', (SELECT ip_exact::text FROM index_state), (SELECT ip_exact FROM index_state)),
    (50, 'index_user_exact', 'forum_upload_attempts_purpose_user_created_idx', 'valid-ready-live exact definition', (SELECT user_exact::text FROM index_state), (SELECT user_exact FROM index_state)),
    (60, 'index_no_equivalent_conflict', 'public.forum_upload_attempts', 'exactly two reviewed structural definitions', (SELECT no_equivalent_conflict::text FROM index_state), (SELECT no_equivalent_conflict FROM index_state)),
    (70, 'rls_enabled', 'public.forum_upload_attempts', 'true', coalesce((SELECT rls_enabled::text FROM relation_state), 'false'), coalesce((SELECT rls_enabled FROM relation_state), false)),
    (80, 'force_rls_state', 'public.forum_upload_attempts', 'catalog fingerprint', md5(coalesce((SELECT force_rls::text FROM relation_state), 'missing')), true),
    (90, 'policy_inventory_fingerprint', 'public.forum_upload_attempts', 'nonempty redacted inventory', (SELECT policy_fingerprint FROM policy_state), (SELECT inventory_present FROM policy_state)),
    (100, 'table_privileges_fingerprint', 'public.forum_upload_attempts', 'PUBLIC/anon/authenticated/service_role/postgres', (SELECT grant_fingerprint FROM grant_state), true),
    (110, 'target_function_overloads', 'public.consume_forum_rate_limit', 'zero or one overload', (SELECT overload_count::text FROM function_state), (SELECT overload_count <= 1 FROM function_state)),
    (120, 'target_function_signature', 'public.consume_forum_rate_limit(uuid,text,text,bigint)', 'exact when present', (SELECT exact_signature_count::text FROM function_state), (SELECT overload_count = 0 OR exact_signature_count = 1 FROM function_state)),
    (130, 'target_function_metadata_fingerprint', 'public.consume_forum_rate_limit', 'redacted catalog fingerprint', (SELECT function_fingerprint FROM function_state), true),
    (140, 'target_function_acl_fingerprint', 'public.consume_forum_rate_limit', 'redacted effective execute matrix', (SELECT acl_fingerprint FROM function_acl_state), true),
    (150, 'resend_separation', 'public.consume_verification_email_resend', 'one separate resend function', (SELECT separate_resend_function::text FROM resend_state), (SELECT separate_resend_function FROM resend_state))
  ) AS value(check_order, check_id, object_identity, expected_value, actual_value_redacted, passed)
), classification AS (
  SELECT CASE
    WHEN NOT bool_and(passed) THEN 'INSUFFICIENT_EVIDENCE'
    WHEN (SELECT overload_count FROM function_state) = 0 THEN 'FUNCTION_ABSENT_SAFE_TO_CREATE'
    WHEN (SELECT overload_count FROM function_state) = 1
      AND (SELECT exact_signature_count = 1 AND owner_postgres AND security_definer AND volatile AND parallel_unsafe AND non_leakproof AND return_identity AND reviewed_config FROM function_state)
      AND NOT (SELECT public_execute OR anon_execute OR authenticated_execute FROM function_acl_state)
      AND (SELECT service_role_execute FROM function_acl_state) THEN 'EXACT_FUNCTION_ALREADY_PRESENT'
    ELSE 'CONFLICTING_FUNCTION_PRESENT'
  END AS value
  FROM checks
)
SELECT 'r6-single-result-preflight-v2'::text AS packet_version, 'R6-2'::text AS phase,
  1 AS section_order, c.check_order, c.check_id, c.object_identity, c.expected_value,
  c.actual_value_redacted, CASE WHEN c.passed THEN 'PASS' ELSE 'FAIL' END AS status,
  NOT c.passed AS blocking, (SELECT value FROM classification) AS classification,
  md5(c.check_id || '|' || c.expected_value || '|' || c.actual_value_redacted) AS evidence_fingerprint
FROM checks c
ORDER BY section_order, check_order;
