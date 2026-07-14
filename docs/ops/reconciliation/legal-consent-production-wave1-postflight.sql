-- READ ONLY PRODUCTION POSTFLIGHT. Run only after separately approved Wave 1
-- execution and export all result sets for review. This is not a migration.
BEGIN TRANSACTION READ ONLY;

WITH target_functions(schema_name, function_name, argument_types, expected_search_path, expected_public, expected_anon, expected_authenticated, expected_service_role) AS (
  VALUES
    ('public'::name, 'increment_post_view_count'::name, 'uuid'::text, 'search_path=public'::text, false, true, true, false),
    ('public'::name, 'insert_forum_notification'::name, 'uuid, uuid, text, uuid, uuid, uuid'::text, 'search_path=public, pg_temp'::text, false, false, false, true)
), resolved AS (
  SELECT t.*, p.oid, pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    pg_get_function_result(p.oid) AS return_type, pg_get_userbyid(p.proowner) AS owner,
    p.prosecdef AS security_definer, coalesce(array_to_string(p.proconfig, ', '), '') AS proconfig,
    pg_get_functiondef(p.oid) AS function_definition,
    md5(regexp_replace(trim(p.prosrc), E'\\s+', ' ', 'g')) AS normalized_function_body_hash, p.proacl
  FROM target_functions t
  LEFT JOIN pg_namespace n ON n.nspname = t.schema_name
  LEFT JOIN pg_proc p ON p.pronamespace = n.oid AND p.proname = t.function_name
    AND p.oid = to_regprocedure(format('%I.%I(%s)', t.schema_name, t.function_name, t.argument_types))
)
SELECT
  schema_name, function_name, argument_types, identity_arguments, return_type, owner,
  security_definer, proconfig, normalized_function_body_hash, function_definition,
  coalesce((SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') FROM aclexplode(coalesce(proacl, acldefault('f', (SELECT oid FROM pg_roles WHERE rolname = owner)))) acl), false) AS public_execute,
  has_function_privilege('anon', oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', oid, 'EXECUTE') AS service_role_execute,
  (SELECT count(*) FROM pg_proc overload WHERE overload.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = resolved.schema_name) AND overload.proname = resolved.function_name) AS overload_count,
  return_type = 'void' AND owner = 'postgres' AND security_definer AND proconfig = expected_search_path
    AND coalesce((SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') FROM aclexplode(coalesce(proacl, acldefault('f', (SELECT oid FROM pg_roles WHERE rolname = owner)))) acl), false) = expected_public
    AND has_function_privilege('anon', oid, 'EXECUTE') = expected_anon
    AND has_function_privilege('authenticated', oid, 'EXECUTE') = expected_authenticated
    AND has_function_privilege('service_role', oid, 'EXECUTE') = expected_service_role
    AND (SELECT count(*) FROM pg_proc overload WHERE overload.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = resolved.schema_name) AND overload.proname = resolved.function_name) = 1 AS expected_metadata_and_acl
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

-- Manual reviewer check: the packet is limited to these two function catalog
-- objects. Compare fresh preflight/postflight inventories for any policy, table,
-- schema, or unrelated-function drift before closing the incident.
ROLLBACK;
