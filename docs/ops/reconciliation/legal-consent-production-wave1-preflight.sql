-- READ ONLY. Export this result before considering the separate review proposal.
-- This packet is not a migration and must not be run against an unverified target.
BEGIN TRANSACTION READ ONLY;

WITH target_functions(schema_name, function_name, argument_types) AS (
  VALUES
    ('public'::name, 'increment_post_view_count'::name, 'uuid'::text),
    ('public'::name, 'insert_forum_notification'::name, 'uuid, uuid, text, uuid, uuid, uuid'::text)
), resolved AS (
  SELECT n.nspname, p.proname, p.oid, pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    pg_get_function_result(p.oid) AS return_type, pg_get_userbyid(p.proowner) AS owner,
    p.prosecdef AS security_definer, coalesce(array_to_string(p.proconfig, ', '), '') AS proconfig,
    pg_get_functiondef(p.oid) AS function_definition, p.proacl
  FROM target_functions t
  LEFT JOIN pg_namespace n ON n.nspname = t.schema_name
  LEFT JOIN pg_proc p ON p.pronamespace = n.oid AND p.proname = t.function_name
    AND p.oid = to_regprocedure(format('%I.%I(%s)', t.schema_name, t.function_name, t.argument_types))
)
SELECT 'function' AS section, nspname AS schema_name, proname AS function_name, identity_arguments,
  return_type, owner, security_definer, proconfig, function_definition,
  coalesce((
    select bool_or(acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
    from aclexplode(coalesce(proacl, acldefault('f', (select oid from pg_roles where rolname = owner)))) acl
  ), false) AS public_execute,
  has_function_privilege('anon', oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', oid, 'EXECUTE') AS service_role_execute,
  (SELECT count(*) FROM pg_proc p2 WHERE p2.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = resolved.nspname) AND p2.proname = resolved.proname) AS overload_count
FROM resolved
UNION ALL
SELECT 'acl' AS section, r.nspname, r.proname, r.identity_arguments, NULL, grantor.rolname, NULL, NULL,
  grantee.rolname || ':' || privilege_type || ':grantable=' || is_grantable, NULL, NULL, NULL, NULL, NULL
FROM resolved r
LEFT JOIN LATERAL aclexplode(coalesce(r.proacl, acldefault('f', (SELECT oid FROM pg_roles WHERE rolname = r.owner)))) acl ON true
LEFT JOIN pg_roles grantor ON grantor.oid = acl.grantor
LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
UNION ALL
SELECT 'dependent_policy' AS section, n.nspname, c.relname, pol.polname, pol.polcmd::text, NULL, NULL, NULL,
  coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' | ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''), NULL, NULL, NULL, NULL, NULL
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'storage')
  AND (pg_get_expr(pol.polqual, pol.polrelid) ILIKE '%increment_post_view_count%' OR pg_get_expr(pol.polqual, pol.polrelid) ILIKE '%insert_forum_notification%' OR pg_get_expr(pol.polwithcheck, pol.polrelid) ILIKE '%increment_post_view_count%' OR pg_get_expr(pol.polwithcheck, pol.polrelid) ILIKE '%insert_forum_notification%');

ROLLBACK;
