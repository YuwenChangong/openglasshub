-- READ ONLY. This is a non-production preflight packet for one exact function.
-- Attach the output to the human review; do not use it to authorize production work.
BEGIN TRANSACTION READ ONLY;

WITH target AS (
  SELECT to_regprocedure('public.increment_post_view_count(uuid)') AS function_oid
)
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_function_result(p.oid) AS return_type,
  pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef AS security_definer,
  coalesce(array_to_string(p.proconfig, ', '), '') AS proconfig,
  pg_get_functiondef(p.oid) AS function_definition,
  coalesce((
    SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE')
    FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
  ), false) AS public_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  (
    SELECT count(*)
    FROM pg_proc AS overload
    WHERE overload.pronamespace = p.pronamespace
      AND overload.proname = p.proname
  ) AS overload_count
FROM target
JOIN pg_proc AS p ON p.oid = target.function_oid
JOIN pg_namespace AS n ON n.oid = p.pronamespace;

ROLLBACK;
