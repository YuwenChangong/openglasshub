-- READ ONLY W6 INDEX EXECUTION PREFLIGHT.
-- Run before Stage A and again before Stage B. This has no policy-removal
-- authority: authenticated SELECT/INSERT privileges must be reconciled first.
BEGIN TRANSACTION READ ONLY;

WITH relation_ref AS (
  SELECT c.oid, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c
  WHERE c.oid = 'public.forum_upload_attempts'::regclass
), indexes AS (
  SELECT ic.relname AS name, am.amname AS method, pi.indisunique AS unique_index,
    pi.indisvalid AS valid_index, pi.indisready AS ready_index, pg_get_indexdef(ic.oid) AS definition,
    ARRAY(SELECT pg_get_indexdef(ic.oid, position, true) FROM generate_series(1, pi.indnkeyatts) AS position) AS key_parts,
    pg_get_expr(pi.indpred, pi.indrelid) AS predicate,
    ARRAY(SELECT pg_get_indexdef(ic.oid, position, true) FROM generate_series(pi.indnkeyatts + 1, pi.indnatts) AS position) AS included_parts
  FROM relation_ref relation_ref
  JOIN pg_index pi ON pi.indrelid = relation_ref.oid
  JOIN pg_class ic ON ic.oid = pi.indexrelid
  JOIN pg_am am ON am.oid = ic.relam
), policies AS (
  SELECT p.polname AS name, p.polcmd::text AS command, p.polpermissive AS permissive,
    array_to_string(ARRAY(SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_oid) END FROM unnest(p.polroles) AS role_oid ORDER BY 1), ',') AS roles,
    coalesce(pg_get_expr(p.polqual, p.polrelid), '') AS using_expression,
    coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS with_check_expression
  FROM pg_policy p WHERE p.polrelid = 'public.forum_upload_attempts'::regclass
), roles AS (
  SELECT role_name, exists(SELECT 1 FROM pg_roles WHERE rolname = role_name) AS role_exists
  FROM (VALUES ('authenticated'::text), ('service_role'::text)) AS wanted(role_name)
)
SELECT
  (SELECT count(*) = 1 FROM relation_ref) AS relation_exists,
  (SELECT relrowsecurity FROM relation_ref) AS rls_enabled,
  (SELECT relforcerowsecurity FROM relation_ref) AS rls_forced,
  (SELECT owner FROM relation_ref) AS table_owner,
  (SELECT jsonb_agg(jsonb_build_object('name', name, 'method', method, 'unique', unique_index, 'valid', valid_index, 'ready', ready_index, 'definition', definition, 'keys', key_parts, 'predicate', predicate, 'included', included_parts) ORDER BY name) FROM indexes) AS index_catalog,
  (SELECT jsonb_agg(jsonb_build_object('name', name, 'command', command, 'permissive', permissive, 'roles', roles, 'using', using_expression, 'with_check', with_check_expression) ORDER BY name) FROM policies) AS policy_catalog,
  (SELECT jsonb_object_agg(role_name, jsonb_build_object('exists', role_exists, 'select', CASE WHEN role_exists THEN has_table_privilege(role_name, 'public.forum_upload_attempts', 'SELECT') END, 'insert', CASE WHEN role_exists THEN has_table_privilege(role_name, 'public.forum_upload_attempts', 'INSERT') END)) FROM roles) AS effective_role_privileges;

ROLLBACK;
