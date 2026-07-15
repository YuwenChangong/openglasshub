-- READ ONLY PRODUCTION POSTFLIGHT for the three-object circles visibility wave.
-- Run only after separately approved proposal execution. Export catalog and
-- aggregate evidence only; this packet returns no individual circle rows.
BEGIN TRANSACTION READ ONLY;

WITH relation_snapshot AS (
  SELECT c.oid, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
    pg_get_userbyid(c.relowner) AS owner, c.relacl
  FROM pg_class c WHERE c.oid = 'public.circles'::regclass
), policies AS (
  SELECT p.polname, p.polcmd::text AS command, p.polpermissive,
    array_to_string(p.polroles::regrole[], ',') AS roles,
    coalesce(pg_get_expr(p.polqual, p.polrelid), '') AS using_expression,
    coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS with_check_expression
  FROM pg_policy p WHERE p.polrelid = 'public.circles'::regclass
), helpers AS (
  SELECT p.oid::regprocedure::text AS identity, md5(regexp_replace(trim(p.prosrc), E'\\s+', ' ', 'g')) AS body_md5,
    pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
    coalesce(array_to_string(p.proconfig, ', '), '') AS search_path, p.proacl, p.oid AS function_oid
  FROM pg_proc p WHERE p.oid IN ('public.can_access_public_circle(uuid)'::regprocedure, 'public.is_moderator_or_admin()'::regprocedure)
), wave_one AS (
  SELECT p.oid::regprocedure::text AS identity, md5(regexp_replace(trim(p.prosrc), E'\\s+', ' ', 'g')) AS body_md5,
    pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
    coalesce(array_to_string(p.proconfig, ', '), '') AS search_path, p.proacl, p.oid AS function_oid
  FROM pg_proc p WHERE p.oid IN ('public.increment_post_view_count(uuid)'::regprocedure, 'public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)'::regprocedure)
), aggregates AS (
  SELECT count(*) FILTER (WHERE status = 'hidden') AS hidden_count,
    count(*) FILTER (WHERE status IS NULL) AS null_count,
    count(*) FILTER (WHERE status IS NOT NULL AND status NOT IN ('active', 'deleted')) AS unknown_count,
    count(*) FILTER (WHERE public.can_access_public_circle(id)) AS expected_anonymous_visible_count
  FROM public.circles
)
SELECT
  (SELECT rls_enabled FROM relation_snapshot) AS rls_enabled,
  (SELECT rls_forced FROM relation_snapshot) AS rls_forced,
  (SELECT owner FROM relation_snapshot) AS table_owner,
  (SELECT coalesce(array_to_string(relacl, ','), '') FROM relation_snapshot) AS table_acl,
  (SELECT pg_get_constraintdef(oid, true) FROM pg_constraint WHERE conrelid = 'public.circles'::regclass AND conname = 'circles_status_check') AS circles_status_constraint,
  (SELECT jsonb_agg(jsonb_build_object('name', polname, 'command', command, 'permissive', polpermissive, 'roles', roles, 'using', using_expression, 'with_check', with_check_expression) ORDER BY polname) FROM policies) AS circles_policy_inventory,
  (SELECT jsonb_build_object('permissive', polpermissive, 'roles', roles, 'using', using_expression, 'with_check', with_check_expression) FROM policies WHERE polname = 'circles_select_public') AS circles_select_public,
  NOT EXISTS (SELECT 1 FROM policies WHERE polname = 'circles_delete_owner_or_staff') AS direct_delete_policy_absent,
  (SELECT jsonb_agg(jsonb_build_object('identity', identity, 'body_md5', body_md5, 'owner', owner, 'security_definer', security_definer, 'search_path', search_path,
    'public_execute', coalesce((SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') FROM aclexplode(coalesce(proacl, acldefault('f', (SELECT oid FROM pg_roles WHERE rolname = helpers.owner)))) acl), false),
    'anon_execute', has_function_privilege('anon', function_oid, 'EXECUTE'), 'authenticated_execute', has_function_privilege('authenticated', function_oid, 'EXECUTE'), 'service_role_execute', has_function_privilege('service_role', function_oid, 'EXECUTE')) ORDER BY identity) FROM helpers) AS visibility_helper_contracts,
  (SELECT jsonb_agg(jsonb_build_object('identity', identity, 'body_md5', body_md5, 'owner', owner, 'security_definer', security_definer, 'search_path', search_path,
    'public_execute', coalesce((SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') FROM aclexplode(coalesce(proacl, acldefault('f', (SELECT oid FROM pg_roles WHERE rolname = wave_one.owner)))) acl), false),
    'anon_execute', has_function_privilege('anon', function_oid, 'EXECUTE'), 'authenticated_execute', has_function_privilege('authenticated', function_oid, 'EXECUTE'), 'service_role_execute', has_function_privilege('service_role', function_oid, 'EXECUTE')) ORDER BY identity) FROM wave_one) AS wave_one_function_contracts,
  aggregates.hidden_count, aggregates.null_count, aggregates.unknown_count, aggregates.expected_anonymous_visible_count
FROM aggregates;

ROLLBACK;
