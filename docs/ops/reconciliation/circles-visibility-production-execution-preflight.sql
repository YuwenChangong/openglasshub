-- READ ONLY PRODUCTION EXECUTION PREFLIGHT.
-- Scope: public.circles.circles_status_check, circles_select_public, and
-- circles_delete_owner_or_staff only. Export the one aggregate/catalog result
-- set and compare it with the reviewed evidence before any future execution.
-- This is not a canonical migration and performs no data or schema mutation.
BEGIN TRANSACTION READ ONLY;

WITH relation_snapshot AS (
  SELECT c.oid, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
    pg_get_userbyid(c.relowner) AS owner, c.relacl
  FROM pg_class c
  WHERE c.oid = 'public.circles'::regclass
), policy_snapshot AS (
  SELECT p.polname, p.polcmd::text AS command, p.polpermissive,
    array_to_string(p.polroles::regrole[], ',') AS roles,
    coalesce(pg_get_expr(p.polqual, p.polrelid), '') AS using_expression,
    coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS with_check_expression
  FROM pg_policy p
  WHERE p.polrelid = 'public.circles'::regclass
), helper_snapshot AS (
  SELECT p.oid::regprocedure::text AS identity,
    md5(regexp_replace(trim(p.prosrc), E'\\s+', ' ', 'g')) AS body_md5,
    pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
    coalesce(array_to_string(p.proconfig, ', '), '') AS search_path, p.proacl, p.oid AS function_oid
  FROM pg_proc p
  WHERE p.oid IN ('public.can_access_public_circle(uuid)'::regprocedure, 'public.is_moderator_or_admin()'::regprocedure)
), aggregates AS (
  SELECT count(*) AS total_count,
    count(*) FILTER (WHERE status = 'active') AS active_count,
    count(*) FILTER (WHERE status = 'hidden') AS hidden_count,
    count(*) FILTER (WHERE status = 'deleted') AS deleted_count,
    count(*) FILTER (WHERE status IS NULL) AS null_count,
    count(*) FILTER (WHERE status IS NOT NULL AND status NOT IN ('active', 'hidden', 'deleted')) AS unknown_count,
    count(*) FILTER (WHERE status IS NULL OR status NOT IN ('active', 'deleted')) AS expected_constraint_violation_count,
    count(*) AS current_anonymous_visible_count,
    count(*) FILTER (WHERE public.can_access_public_circle(id)) AS expected_anonymous_visible_count
  FROM public.circles
)
SELECT
  (SELECT count(*) = 1 FROM relation_snapshot) AS circles_relation_exists,
  (SELECT rls_enabled FROM relation_snapshot) AS rls_enabled,
  (SELECT rls_forced FROM relation_snapshot) AS rls_forced,
  (SELECT owner FROM relation_snapshot) AS table_owner,
  (SELECT coalesce(array_to_string(relacl, ','), '') FROM relation_snapshot) AS table_acl,
  (SELECT pg_get_constraintdef(con.oid, true) FROM pg_constraint con WHERE con.conrelid = 'public.circles'::regclass AND con.conname = 'circles_status_check') AS circles_status_constraint,
  (SELECT count(*) FROM pg_constraint con WHERE con.conrelid = 'public.circles'::regclass AND con.conname = 'circles_status_check') AS circles_status_constraint_count,
  (SELECT jsonb_agg(jsonb_build_object('name', polname, 'command', command, 'permissive', polpermissive, 'roles', roles, 'using', using_expression, 'with_check', with_check_expression) ORDER BY polname)
    FROM policy_snapshot WHERE command IN ('r', 'd')) AS select_delete_policy_inventory,
  (SELECT jsonb_build_object('permissive', polpermissive, 'roles', roles, 'using', using_expression, 'with_check', with_check_expression)
    FROM policy_snapshot WHERE polname = 'circles_select_public') AS circles_select_public,
  (SELECT jsonb_build_object('permissive', polpermissive, 'roles', roles, 'using', using_expression, 'with_check', with_check_expression)
    FROM policy_snapshot WHERE polname = 'circles_delete_owner_or_staff') AS circles_delete_owner_or_staff,
  (SELECT jsonb_agg(jsonb_build_object('identity', identity, 'body_md5', body_md5, 'owner', owner, 'security_definer', security_definer, 'search_path', search_path,
      'public_execute', coalesce((SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') FROM aclexplode(coalesce(proacl, acldefault('f', (SELECT oid FROM pg_roles WHERE rolname = helper_snapshot.owner)))) acl), false),
      'anon_execute', has_function_privilege('anon', function_oid, 'EXECUTE'), 'authenticated_execute', has_function_privilege('authenticated', function_oid, 'EXECUTE'), 'service_role_execute', has_function_privilege('service_role', function_oid, 'EXECUTE')) ORDER BY identity)
    FROM helper_snapshot) AS visibility_helper_contracts,
  aggregates.total_count, aggregates.active_count, aggregates.hidden_count, aggregates.deleted_count, aggregates.null_count, aggregates.unknown_count,
  aggregates.expected_constraint_violation_count, aggregates.current_anonymous_visible_count, aggregates.expected_anonymous_visible_count,
  aggregates.current_anonymous_visible_count - aggregates.expected_anonymous_visible_count AS anonymous_visibility_delta
FROM aggregates;

ROLLBACK;
