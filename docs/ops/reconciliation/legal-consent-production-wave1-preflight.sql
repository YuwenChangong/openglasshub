-- READ ONLY PRODUCTION PREFLIGHT. Export every result set for human review.
-- Scope is exactly the two Wave 1 signatures. This is not a migration.
BEGIN TRANSACTION READ ONLY;

WITH target_functions(schema_name, function_name, argument_types) AS (
  VALUES
    ('public'::name, 'increment_post_view_count'::name, 'uuid'::text),
    ('public'::name, 'insert_forum_notification'::name, 'uuid, uuid, text, uuid, uuid, uuid'::text)
), resolved AS (
  SELECT t.*, p.oid, pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    pg_get_function_result(p.oid) AS return_type, pg_get_userbyid(p.proowner) AS owner,
    l.lanname AS language, p.prosecdef AS security_definer,
    coalesce(array_to_string(p.proconfig, ', '), '') AS proconfig,
    pg_get_functiondef(p.oid) AS function_definition,
    md5(regexp_replace(trim(p.prosrc), E'\\s+', ' ', 'g')) AS normalized_function_body_hash,
    md5(regexp_replace(pg_get_functiondef(p.oid), E'\\s+', ' ', 'g')) AS normalized_function_definition_hash,
    p.proacl
  FROM target_functions t
  LEFT JOIN pg_namespace n ON n.nspname = t.schema_name
  LEFT JOIN pg_proc p ON p.pronamespace = n.oid AND p.proname = t.function_name
    AND p.oid = to_regprocedure(format('%I.%I(%s)', t.schema_name, t.function_name, t.argument_types))
  LEFT JOIN pg_language l ON l.oid = p.prolang
)
SELECT
  schema_name, function_name, argument_types AS requested_identity_arguments,
  identity_arguments, return_type, owner, language, security_definer, proconfig,
  normalized_function_body_hash, normalized_function_definition_hash, function_definition,
  coalesce((SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') FROM aclexplode(coalesce(proacl, acldefault('f', (SELECT oid FROM pg_roles WHERE rolname = owner)))) acl), false) AS public_execute,
  has_function_privilege('anon', oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', oid, 'EXECUTE') AS service_role_execute,
  (SELECT count(*) FROM pg_proc overload WHERE overload.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = resolved.schema_name) AND overload.proname = resolved.function_name) AS overload_count
FROM resolved
ORDER BY function_name;

WITH target_functions(schema_name, function_name, argument_types) AS (
  VALUES ('public'::name, 'increment_post_view_count'::name, 'uuid'::text), ('public'::name, 'insert_forum_notification'::name, 'uuid, uuid, text, uuid, uuid, uuid'::text)
), resolved AS (
  SELECT t.function_name, p.oid, pg_get_userbyid(p.proowner) AS owner, p.proacl
  FROM target_functions t JOIN pg_namespace n ON n.nspname = t.schema_name
  JOIN pg_proc p ON p.pronamespace = n.oid AND p.proname = t.function_name AND p.oid = to_regprocedure(format('%I.%I(%s)', t.schema_name, t.function_name, t.argument_types))
)
SELECT r.function_name, coalesce(grantee.rolname, 'PUBLIC') AS grantee, acl.privilege_type, acl.is_grantable, grantor.rolname AS grantor
FROM resolved r
CROSS JOIN LATERAL aclexplode(coalesce(r.proacl, acldefault('f', (SELECT oid FROM pg_roles WHERE rolname = r.owner)))) acl
LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
LEFT JOIN pg_roles grantor ON grantor.oid = acl.grantor
ORDER BY r.function_name, grantee, acl.privilege_type;

WITH target_oids AS (
  SELECT to_regprocedure('public.increment_post_view_count(uuid)') AS oid
  UNION ALL SELECT to_regprocedure('public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)')
)
SELECT dep.refobjid::regprocedure AS target_function, dep.classid::regclass AS dependent_catalog, dep.objid::regclass AS dependent_object, dep.deptype
FROM pg_depend dep JOIN target_oids t ON t.oid = dep.refobjid
WHERE dep.classid IN ('pg_class'::regclass, 'pg_proc'::regclass)
ORDER BY 1, 2, 3;

SELECT n.nspname AS schema_name, c.relname AS table_name, pol.polname, pol.polcmd::text AS command,
  coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') AS using_expression,
  coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') AS with_check_expression
FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'storage')
  AND (pg_get_expr(pol.polqual, pol.polrelid) ILIKE '%increment_post_view_count%'
    OR pg_get_expr(pol.polqual, pol.polrelid) ILIKE '%insert_forum_notification%'
    OR pg_get_expr(pol.polwithcheck, pol.polrelid) ILIKE '%increment_post_view_count%'
    OR pg_get_expr(pol.polwithcheck, pol.polrelid) ILIKE '%insert_forum_notification%')
ORDER BY 1, 2, 3;

ROLLBACK;
