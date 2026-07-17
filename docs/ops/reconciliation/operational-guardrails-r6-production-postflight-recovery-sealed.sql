-- UNEXECUTED R6N recovery. One read-only catalog statement, one sealed scalar.
-- The payload is the exact compact recovery packet serialized deterministically.
-- It never reads application rows, function bodies, credentials, or auth data.
WITH target_relation AS (
  SELECT to_regclass('public.forum_upload_attempts') AS oid
), indexes AS (
  SELECT n.relname, i.indisvalid, i.indisready, i.indislive,
    regexp_replace(pg_catalog.pg_get_indexdef(i.indexrelid), '\\s+', ' ', 'g') AS definition
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class n ON n.oid = i.indexrelid
  JOIN target_relation t ON t.oid = i.indrelid
), index_state AS (
  SELECT
    coalesce(bool_or(relname = 'forum_upload_attempts_purpose_ip_created_idx' AND indisvalid AND indisready AND indislive
      AND definition = 'CREATE INDEX forum_upload_attempts_purpose_ip_created_idx ON public.forum_upload_attempts USING btree (purpose, ip_hash, created_at DESC)'), false) AS ip_exact,
    coalesce(bool_or(relname = 'forum_upload_attempts_purpose_user_created_idx' AND indisvalid AND indisready AND indislive
      AND definition = 'CREATE INDEX forum_upload_attempts_purpose_user_created_idx ON public.forum_upload_attempts USING btree (purpose, user_id, created_at DESC)'), false) AS user_exact,
    count(*) FILTER (WHERE definition IN (
      'CREATE INDEX forum_upload_attempts_purpose_ip_created_idx ON public.forum_upload_attempts USING btree (purpose, ip_hash, created_at DESC)',
      'CREATE INDEX forum_upload_attempts_purpose_user_created_idx ON public.forum_upload_attempts USING btree (purpose, user_id, created_at DESC)'
    )) = 2 AS no_equivalent_conflict,
    md5(coalesce(string_agg(relname || ':' || md5(definition) || ':' || indisvalid || ':' || indisready || ':' || indislive, '|' ORDER BY relname), '')) AS fingerprint
  FROM indexes
), policies AS (
  SELECT policyname, cmd, roles, qual, with_check FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND tablename = 'forum_upload_attempts'
), policy_state AS (
  SELECT md5(coalesce(string_agg(policyname || ':' || cmd || ':' || md5(coalesce(qual, '')) || ':' || md5(coalesce(with_check, '')), '|' ORDER BY policyname, cmd), '')) AS fingerprint
  FROM policies
), roles(role_name) AS (VALUES ('PUBLIC'::text), ('anon'), ('authenticated'), ('service_role'), ('postgres')),
table_privileges AS (
  SELECT r.role_name,
    CASE WHEN r.role_name = 'PUBLIC' THEN EXISTS (
      SELECT 1 FROM target_relation t, pg_catalog.pg_class c,
        LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = t.oid AND a.grantee = 0 AND a.privilege_type = 'SELECT'
    ) ELSE coalesce(has_table_privilege(nullif(r.role_name, 'PUBLIC'), (SELECT oid FROM target_relation), 'SELECT'), false) END AS effective_select,
    CASE WHEN r.role_name = 'PUBLIC' THEN EXISTS (
      SELECT 1 FROM target_relation t, pg_catalog.pg_class c,
        LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = t.oid AND a.grantee = 0 AND a.privilege_type = 'INSERT'
    ) ELSE coalesce(has_table_privilege(nullif(r.role_name, 'PUBLIC'), (SELECT oid FROM target_relation), 'INSERT'), false) END AS effective_insert
  FROM roles r
), grant_state AS (
  SELECT md5(string_agg(role_name || ':' || effective_select || ':' || effective_insert, '|' ORDER BY role_name)) AS fingerprint
  FROM table_privileges
), target_function AS (
  SELECT p.oid, p.proowner, p.prosecdef, p.provolatile, p.proparallel, p.proleakproof, p.proconfig, p.proacl,
    pg_get_function_identity_arguments(p.oid) AS arguments, pg_get_function_result(p.oid) AS result_identity
  FROM pg_catalog.pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'consume_forum_rate_limit'
), target_state AS (
  SELECT count(*) AS overload_count,
    count(*) FILTER (WHERE arguments = 'p_user_id uuid, p_ip_hash text, p_purpose text, p_bytes bigint') AS exact_signature_count,
    coalesce(bool_and(pg_get_userbyid(proowner) = 'postgres'), false) AS owner_postgres,
    coalesce(bool_and(prosecdef), false) AS security_definer,
    coalesce(bool_and(provolatile = 'v'), false) AS volatile,
    coalesce(bool_and(proparallel = 'u'), false) AS parallel_unsafe,
    coalesce(bool_and(NOT proleakproof), false) AS non_leakproof,
    coalesce(bool_and(result_identity = 'TABLE(allowed boolean, decision text)'), false) AS return_identity,
    coalesce(bool_and(proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']), false) AS search_path_exact,
    coalesce(bool_and(proconfig @> ARRAY['lock_timeout=1s']), false) AS lock_timeout_exact,
    coalesce(bool_and(proconfig @> ARRAY['statement_timeout=3s']), false) AS statement_timeout_exact,
    md5(coalesce(string_agg(md5(arguments || '|' || result_identity || '|' || proowner::text || '|' || prosecdef::text || '|' || provolatile::text || '|' || proparallel::text || '|' || proleakproof::text || '|' || coalesce(array_to_string(proconfig, ','), '')), '|' ORDER BY oid), '')) AS fingerprint
  FROM target_function
), target_acl AS (
  SELECT r.role_name,
    CASE WHEN r.role_name = 'PUBLIC' THEN coalesce(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false)
    ELSE coalesce(bool_or(has_function_privilege(nullif(r.role_name, 'PUBLIC'), f.oid, 'EXECUTE')), false) END AS effective_execute
  FROM roles r LEFT JOIN target_function f ON true
  LEFT JOIN LATERAL aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a ON true
  GROUP BY r.role_name
), target_acl_state AS (
  SELECT coalesce(bool_or(role_name = 'PUBLIC' AND effective_execute), false) AS public_execute,
    coalesce(bool_or(role_name = 'anon' AND effective_execute), false) AS anon_execute,
    coalesce(bool_or(role_name = 'authenticated' AND effective_execute), false) AS authenticated_execute,
    coalesce(bool_or(role_name = 'service_role' AND effective_execute), false) AS service_role_execute,
    md5(coalesce(string_agg(role_name || ':' || effective_execute, '|' ORDER BY role_name), '')) AS fingerprint
  FROM target_acl
), resend_function AS (
  SELECT p.oid, p.proowner, p.prosecdef, p.provolatile, p.proparallel, p.proleakproof, p.proconfig, p.proacl,
    pg_get_function_identity_arguments(p.oid) AS arguments, pg_get_function_result(p.oid) AS result_identity
  FROM pg_catalog.pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'consume_verification_email_resend_limit'
), resend_state AS (
  SELECT count(*) AS overload_count,
    count(*) FILTER (WHERE arguments = 'input_ip_hash text, max_attempts integer, window_hours integer') AS exact_signature_count,
    coalesce(bool_and(result_identity = 'TABLE(allowed boolean, attempts integer)' AND pg_get_userbyid(proowner) = 'postgres' AND prosecdef AND provolatile = 'v' AND proparallel = 'u' AND NOT proleakproof AND proconfig = ARRAY['search_path=public, pg_temp']), false) AS identity_exact,
    md5(coalesce(string_agg(md5(arguments || '|' || result_identity || '|' || proowner::text || '|' || prosecdef::text || '|' || provolatile::text || '|' || proparallel::text || '|' || proleakproof::text || '|' || coalesce(array_to_string(proconfig, ','), '')), '|' ORDER BY oid), '')) AS metadata_fingerprint
  FROM resend_function
), resend_acl AS (
  SELECT r.role_name,
    CASE WHEN r.role_name = 'PUBLIC' THEN coalesce(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false)
    ELSE coalesce(bool_or(has_function_privilege(nullif(r.role_name, 'PUBLIC'), f.oid, 'EXECUTE')), false) END AS effective_execute
  FROM roles r LEFT JOIN resend_function f ON true
  LEFT JOIN LATERAL aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a ON true
  GROUP BY r.role_name
), resend_acl_state AS (
  SELECT coalesce(bool_or(role_name = 'PUBLIC' AND effective_execute), false) AS public_execute,
    coalesce(bool_or(role_name = 'anon' AND effective_execute), false) AS anon_execute,
    coalesce(bool_or(role_name = 'authenticated' AND effective_execute), false) AS authenticated_execute,
    coalesce(bool_or(role_name = 'service_role' AND effective_execute), false) AS service_role_execute,
    md5(coalesce(string_agg(role_name || ':' || effective_execute, '|' ORDER BY role_name), '')) AS fingerprint
  FROM resend_acl
), facts AS (
  SELECT (SELECT oid IS NOT NULL FROM target_relation) AS relation_present,
    (SELECT overload_count FROM target_state) AS overload_count,
    (SELECT exact_signature_count = 1 FROM target_state) AS signature_exact,
    (SELECT owner_postgres FROM target_state) AS owner_postgres,
    (SELECT security_definer FROM target_state) AS security_definer,
    (SELECT volatile FROM target_state) AS volatile,
    (SELECT parallel_unsafe FROM target_state) AS parallel_unsafe,
    (SELECT non_leakproof FROM target_state) AS non_leakproof,
    (SELECT return_identity FROM target_state) AS return_identity,
    (SELECT search_path_exact FROM target_state) AS search_path_exact,
    (SELECT lock_timeout_exact FROM target_state) AS lock_timeout_exact,
    (SELECT statement_timeout_exact FROM target_state) AS statement_timeout_exact,
    (SELECT public_execute FROM target_acl_state) AS public_execute,
    (SELECT anon_execute FROM target_acl_state) AS anon_execute,
    (SELECT authenticated_execute FROM target_acl_state) AS authenticated_execute,
    (SELECT service_role_execute FROM target_acl_state) AS service_role_execute,
    (SELECT ip_exact FROM index_state) AS index_ip_exact,
    (SELECT user_exact FROM index_state) AS index_user_exact,
    (SELECT no_equivalent_conflict FROM index_state) AS index_no_equivalent_conflict,
    (SELECT overload_count = 1 AND exact_signature_count = 1 AND identity_exact FROM resend_state) AS resend_identity_exact,
    (SELECT NOT public_execute AND anon_execute AND authenticated_execute AND NOT service_role_execute FROM resend_acl_state) AS resend_acl_exact,
    NOT EXISTS (SELECT 1 FROM target_function tf JOIN resend_function rf ON rf.oid = tf.oid) AS target_resend_identity_separate
), checks AS (
  SELECT json_build_object(
    'index_ip_exact', relation_present AND index_ip_exact,
    'index_no_equivalent_conflict', relation_present AND index_no_equivalent_conflict,
    'index_user_exact', relation_present AND index_user_exact,
    'resend_acl_exact', resend_acl_exact,
    'resend_identity_exact', resend_identity_exact,
    'target_acl_exact', NOT public_execute AND NOT anon_execute AND NOT authenticated_execute AND service_role_execute,
    'target_owner_postgres', owner_postgres,
    'target_parallel_unsafe', parallel_unsafe,
    'target_relation_present', relation_present,
    'target_return_identity', return_identity,
    'target_search_path', search_path_exact,
    'target_security_definer', security_definer,
    'target_signature', overload_count = 1 AND signature_exact,
    'target_statement_timeout', statement_timeout_exact,
    'target_volatile', volatile,
    'target_lock_timeout', lock_timeout_exact,
    'target_non_leakproof', non_leakproof,
    'target_resend_identity_separate', target_resend_identity_separate
  ) AS value FROM facts
), summary AS (
  SELECT f.*, (SELECT regexp_replace(value::text, '[[:space:]]+', '', 'g') FROM checks) AS check_statuses_compact,
    (SELECT count(*) FROM json_each((SELECT value FROM checks)) e WHERE e.value::text = 'false')::integer AS blocking_count,
    coalesce((SELECT string_agg(key, ',' ORDER BY key) FROM json_each((SELECT value FROM checks)) e WHERE e.value::text = 'false'), '') AS failed_check_ids,
    CASE WHEN f.overload_count = 0 THEN 'ABSENT'
      WHEN f.overload_count = 1 AND f.signature_exact AND f.owner_postgres AND f.security_definer AND f.volatile AND f.parallel_unsafe AND f.non_leakproof AND f.return_identity AND f.search_path_exact AND f.lock_timeout_exact AND f.statement_timeout_exact AND NOT f.public_execute AND NOT f.anon_execute AND NOT f.authenticated_execute AND f.service_role_execute THEN 'EXACT_CANDIDATE'
      ELSE 'CONFLICTING' END AS target_state
  FROM facts f
), packet AS (
  SELECT 'r6-compact-postflight-recovery-v1'::text AS packet_version, 'R6-6-recovery'::text AS phase,
    s.target_state, s.blocking_count, s.failed_check_ids, s.check_statuses_compact,
    (SELECT fingerprint FROM target_state) AS target_metadata_fingerprint,
    (SELECT fingerprint FROM target_acl_state) AS target_acl_fingerprint,
    (SELECT fingerprint FROM index_state) AS index_inventory_fingerprint,
    (SELECT fingerprint FROM policy_state) AS policy_inventory_fingerprint,
    (SELECT fingerprint FROM grant_state) AS table_privileges_fingerprint,
    (SELECT metadata_fingerprint FROM resend_state) AS resend_metadata_fingerprint,
    (SELECT fingerprint FROM resend_acl_state) AS resend_acl_fingerprint,
    s.relation_present, s.overload_count::integer, s.signature_exact, s.return_identity, s.owner_postgres, s.security_definer,
    s.volatile, s.parallel_unsafe, s.non_leakproof, s.search_path_exact, s.lock_timeout_exact, s.statement_timeout_exact,
    s.public_execute, s.anon_execute, s.authenticated_execute, s.service_role_execute, s.index_ip_exact, s.index_user_exact,
    s.index_no_equivalent_conflict, s.resend_identity_exact, s.resend_acl_exact, s.target_resend_identity_separate
  FROM summary s
), packet_complete AS (
  SELECT p.*, md5(regexp_replace(row_to_json(p)::text, '[[:space:]]+', '', 'g')) AS evidence_fingerprint
  FROM packet p
), payload AS (
  SELECT row_to_json(packet_complete)::text AS payload_text FROM packet_complete
), sealed AS (
  SELECT payload_text,
    octet_length(convert_to(payload_text, 'UTF8')) AS payload_byte_length,
    encode(sha256(convert_to(payload_text, 'UTF8')), 'hex') AS payload_sha256_hex,
    translate(encode(convert_to(payload_text, 'UTF8'), 'base64'), E'+/\n=', '-_') AS payload_base64url
  FROM payload
)
SELECT 'R6SEALED1.' || payload_byte_length::text || '.' || payload_sha256_hex || '.' || payload_base64url AS sealed_token
FROM sealed;
