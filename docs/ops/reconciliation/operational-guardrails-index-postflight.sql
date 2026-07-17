-- READ ONLY W6 INDEX POSTFLIGHT. Run after Stage B only.
-- This verifies both exact index shapes and preserves the policy/privilege hold.
BEGIN TRANSACTION READ ONLY;

WITH expected AS (
  SELECT * FROM (VALUES
    ('forum_upload_attempts_purpose_ip_created_idx', ARRAY['purpose', 'ip_hash', 'created_at DESC']::text[]),
    ('forum_upload_attempts_purpose_user_created_idx', ARRAY['purpose', 'user_id', 'created_at DESC']::text[])
  ) AS value(name, expected_keys)
), indexes AS (
  SELECT ic.relname AS name, am.amname AS method, pi.indisunique AS unique_index,
    pi.indisvalid AS valid_index, pi.indisready AS ready_index, pg_get_indexdef(ic.oid) AS definition,
    ARRAY(SELECT pg_get_indexdef(ic.oid, position, true) FROM generate_series(1, pi.indnkeyatts) AS position) AS key_parts,
    pg_get_expr(pi.indpred, pi.indrelid) AS predicate,
    ARRAY(SELECT pg_get_indexdef(ic.oid, position, true) FROM generate_series(pi.indnkeyatts + 1, pi.indnatts) AS position) AS included_parts
  FROM pg_index pi
  JOIN pg_class ic ON ic.oid = pi.indexrelid
  JOIN pg_am am ON am.oid = ic.relam
  WHERE pi.indrelid = 'public.forum_upload_attempts'::regclass
), policies AS (
  SELECT polname, polcmd::text AS command, polpermissive,
    coalesce(pg_get_expr(polqual, polrelid), '') AS using_expression,
    coalesce(pg_get_expr(polwithcheck, polrelid), '') AS with_check_expression
  FROM pg_policy WHERE polrelid = 'public.forum_upload_attempts'::regclass
)
SELECT
  jsonb_agg(jsonb_build_object('name', expected.name, 'exists', indexes.name IS NOT NULL, 'method', indexes.method, 'unique', indexes.unique_index, 'valid', indexes.valid_index, 'ready', indexes.ready_index, 'definition', indexes.definition, 'keys', indexes.key_parts, 'predicate', indexes.predicate, 'included', indexes.included_parts, 'exact_shape', indexes.method = 'btree' AND indexes.unique_index = false AND indexes.valid_index AND indexes.ready_index AND lower(regexp_replace(indexes.definition, '\\s+', ' ', 'g')) = lower(format('CREATE INDEX %s ON public.forum_upload_attempts USING btree (%s)', expected.name, array_to_string(expected.expected_keys, ', '))) AND indexes.predicate IS NULL AND indexes.included_parts = ARRAY[]::text[]) ORDER BY expected.name) AS target_index_postflight,
  (SELECT jsonb_agg(jsonb_build_object('name', polname, 'command', command, 'permissive', polpermissive, 'using', using_expression, 'with_check', with_check_expression) ORDER BY polname) FROM policies) AS policy_catalog,
  has_table_privilege('authenticated', 'public.forum_upload_attempts', 'SELECT') AS authenticated_select,
  has_table_privilege('authenticated', 'public.forum_upload_attempts', 'INSERT') AS authenticated_insert
FROM expected
LEFT JOIN indexes ON indexes.name = expected.name;

ROLLBACK;
