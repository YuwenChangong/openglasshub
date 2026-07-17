-- UNEXECUTED R6-6. One catalog-only statement; compare baseline fingerprints offline.
WITH target AS (
  SELECT to_regclass('public.forum_upload_attempts') AS relation_oid
), relation_state AS (
  SELECT c.oid, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_catalog.pg_class c JOIN target t ON t.relation_oid = c.oid
), policies AS (
  SELECT policyname, cmd, roles, qual, with_check FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND tablename = 'forum_upload_attempts'
), policy_state AS (
  SELECT md5(coalesce(string_agg(policyname || ':' || cmd || ':' || md5(coalesce(qual, '')) || ':' || md5(coalesce(with_check, '')), '|' ORDER BY policyname, cmd), '')) AS fingerprint
  FROM policies
), indexes AS (
  SELECT n.relname, i.indisvalid, i.indisready, i.indislive, regexp_replace(pg_get_indexdef(i.indexrelid), '\\s+', ' ', 'g') AS definition
  FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class n ON n.oid = i.indexrelid
  JOIN relation_state rs ON rs.oid = i.indrelid
), index_state AS (
  SELECT md5(coalesce(string_agg(relname || ':' || md5(definition) || ':' || indisvalid || ':' || indisready || ':' || indislive, '|' ORDER BY relname), '')) AS fingerprint
  FROM indexes
), roles(role_name) AS (VALUES ('PUBLIC'::text), ('anon'), ('authenticated'), ('service_role'), ('postgres')),
table_privileges AS (
  SELECT r.role_name,
    CASE WHEN r.role_name = 'PUBLIC' THEN EXISTS (SELECT 1 FROM relation_state rs, LATERAL aclexplode(coalesce((SELECT relacl FROM pg_catalog.pg_class WHERE oid = rs.oid), acldefault('r', (SELECT relowner FROM pg_catalog.pg_class WHERE oid = rs.oid)))) a WHERE a.grantee = 0 AND a.privilege_type IN ('SELECT', 'INSERT'))
    ELSE coalesce(has_table_privilege(r.role_name, (SELECT oid FROM relation_state), 'SELECT, INSERT'), false) END AS effective_direct_access
  FROM roles r
), grant_state AS (
  SELECT md5(string_agg(role_name || ':' || effective_direct_access, '|' ORDER BY role_name)) AS fingerprint FROM table_privileges
), target_function AS (
  SELECT p.oid, p.proowner, p.prosecdef, p.provolatile, p.proparallel, p.proleakproof, p.proconfig, p.proacl,
    pg_get_function_identity_arguments(p.oid) AS arguments, pg_get_function_result(p.oid) AS result_identity
  FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'consume_forum_rate_limit'
), function_state AS (
  SELECT count(*) AS overload_count,
    count(*) FILTER (WHERE arguments = 'p_user_id uuid, p_ip_hash text, p_purpose text, p_bytes bigint') AS exact_signature_count,
    coalesce(bool_and(pg_get_userbyid(proowner) = 'postgres'), false) AS owner_postgres,
    coalesce(bool_and(prosecdef), false) AS security_definer, coalesce(bool_and(provolatile = 'v'), false) AS volatile,
    coalesce(bool_and(proparallel = 'u'), false) AS parallel_unsafe, coalesce(bool_and(NOT proleakproof), false) AS non_leakproof,
    coalesce(bool_and(result_identity = 'TABLE(allowed boolean, decision text)'), false) AS return_identity,
    coalesce(bool_and(proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp', 'lock_timeout=1s', 'statement_timeout=3s']), false) AS reviewed_config,
    md5(coalesce(string_agg(md5(arguments || '|' || result_identity || '|' || proowner::text || '|' || prosecdef::text || '|' || provolatile::text || '|' || proparallel::text || '|' || proleakproof::text || '|' || coalesce(array_to_string(proconfig, ','), '')), '|' ORDER BY oid), '')) AS fingerprint
  FROM target_function
), function_acl AS (
  SELECT r.role_name,
    CASE WHEN r.role_name = 'PUBLIC' THEN coalesce(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false)
         ELSE coalesce(bool_or(pg_catalog.has_function_privilege(r.role_name, f.oid, 'EXECUTE')), false) END AS effective_execute
  FROM roles r LEFT JOIN target_function f ON true
  LEFT JOIN LATERAL aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a ON true
  GROUP BY r.role_name
), function_acl_state AS (
  SELECT coalesce(bool_or(role_name = 'PUBLIC' AND effective_execute), false) AS public_execute,
    coalesce(bool_or(role_name = 'anon' AND effective_execute), false) AS anon_execute,
    coalesce(bool_or(role_name = 'authenticated' AND effective_execute), false) AS authenticated_execute,
    coalesce(bool_or(role_name = 'service_role' AND effective_execute), false) AS service_role_execute,
    md5(coalesce(string_agg(role_name || ':' || effective_execute, '|' ORDER BY role_name), '')) AS fingerprint
  FROM function_acl
), resend_state AS (
  SELECT count(*) = 1 AS separate_resend_function FROM pg_catalog.pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'consume_verification_email_resend'
), checks AS (
  SELECT * FROM (VALUES
    (10, 'target_relation_present', 'public.forum_upload_attempts', 'present', (SELECT (relation_oid IS NOT NULL)::text FROM target), (SELECT relation_oid IS NOT NULL FROM target)),
    (20, 'target_function_overloads', 'public.consume_forum_rate_limit', 'exactly one', (SELECT overload_count::text FROM function_state), (SELECT overload_count = 1 FROM function_state)),
    (30, 'target_function_signature', 'public.consume_forum_rate_limit(uuid,text,text,bigint)', 'exact', (SELECT exact_signature_count::text FROM function_state), (SELECT exact_signature_count = 1 FROM function_state)),
    (40, 'target_function_owner', 'public.consume_forum_rate_limit', 'postgres', (SELECT owner_postgres::text FROM function_state), (SELECT owner_postgres FROM function_state)),
    (50, 'target_function_security', 'public.consume_forum_rate_limit', 'definer-volatile-parallel-unsafe-nonleakproof', (SELECT (security_definer AND volatile AND parallel_unsafe AND non_leakproof)::text FROM function_state), (SELECT security_definer AND volatile AND parallel_unsafe AND non_leakproof FROM function_state)),
    (60, 'target_function_return', 'public.consume_forum_rate_limit', 'TABLE(allowed boolean, decision text)', (SELECT return_identity::text FROM function_state), (SELECT return_identity FROM function_state)),
    (70, 'target_function_settings', 'public.consume_forum_rate_limit', 'search_path + 1s lock + 3s statement', (SELECT reviewed_config::text FROM function_state), (SELECT reviewed_config FROM function_state)),
    (80, 'target_function_acl', 'public.consume_forum_rate_limit', 'service_role only', (SELECT fingerprint FROM function_acl_state), (SELECT NOT public_execute AND NOT anon_execute AND NOT authenticated_execute AND service_role_execute FROM function_acl_state)),
    (90, 'target_function_fingerprint', 'public.consume_forum_rate_limit', 'redacted catalog fingerprint', (SELECT fingerprint FROM function_state), true),
    (100, 'baseline_policy_fingerprint', 'public.forum_upload_attempts', 'offline-validator comparison required', (SELECT fingerprint FROM policy_state), true),
    (110, 'baseline_index_fingerprint', 'public.forum_upload_attempts', 'offline-validator comparison required', (SELECT fingerprint FROM index_state), true),
    (120, 'baseline_grant_fingerprint', 'public.forum_upload_attempts', 'offline-validator comparison required', (SELECT fingerprint FROM grant_state), true),
    (130, 'resend_separation', 'public.consume_verification_email_resend', 'unchanged separate function', (SELECT separate_resend_function::text FROM resend_state), (SELECT separate_resend_function FROM resend_state))
  ) AS value(check_order, check_id, object_identity, expected_value, actual_value_redacted, passed)
), classification AS (
  SELECT CASE WHEN NOT bool_and(passed) THEN 'PRODUCTION_RPC_POSTFLIGHT_FAILED'
    WHEN (SELECT relation_oid IS NULL FROM target) THEN 'PRODUCTION_RPC_STATE_AMBIGUOUS'
    ELSE 'PRODUCTION_RPC_POSTFLIGHT_PASSED' END AS value FROM checks
)
SELECT 'r6-single-result-postflight-v2'::text AS packet_version, 'R6-6'::text AS phase,
  1 AS section_order, c.check_order, c.check_id, c.object_identity, c.expected_value,
  c.actual_value_redacted, CASE WHEN c.passed THEN 'PASS' ELSE 'FAIL' END AS status,
  NOT c.passed AS blocking, (SELECT value FROM classification) AS classification,
  md5(c.check_id || '|' || c.expected_value || '|' || c.actual_value_redacted) AS evidence_fingerprint
FROM checks c
ORDER BY section_order, check_order;
