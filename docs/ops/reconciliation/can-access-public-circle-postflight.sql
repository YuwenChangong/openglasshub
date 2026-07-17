-- READ ONLY POSTFLIGHT for the one-function Wave 1 prerequisite.
-- Run only after separately approved prerequisite execution.
BEGIN TRANSACTION READ ONLY;

WITH function_snapshot AS (
  SELECT
    p.oid,
    pg_get_function_result(p.oid) AS return_type,
    pg_get_userbyid(p.proowner) AS owner,
    p.prosecdef AS security_definer,
    coalesce(array_to_string(p.proconfig, ', '), '') AS search_path,
    p.provolatile::text AS volatility,
    p.proisstrict AS strict,
    p.proleakproof AS leakproof,
    p.proparallel::text AS parallel_safety,
    pg_get_functiondef(p.oid) AS function_definition,
    md5(regexp_replace(trim(p.prosrc), E'\\s+', ' ', 'g')) AS normalized_function_body_hash,
    p.proacl
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.can_access_public_circle(uuid)')
),
surrounding_snapshot AS (
  SELECT
    (SELECT pg_get_constraintdef(con.oid, true)
      FROM pg_constraint con
      WHERE con.conrelid = 'public.circles'::regclass
        AND con.conname = 'circles_status_check') AS circles_status_constraint,
    (SELECT pg_get_expr(policy.polqual, policy.polrelid)
      FROM pg_policy policy
      WHERE policy.polrelid = 'public.circles'::regclass
        AND policy.polname = 'circles_select_public') AS circles_select_policy,
    (SELECT pg_get_expr(policy.polqual, policy.polrelid)
      FROM pg_policy policy
      WHERE policy.polrelid = 'public.circles'::regclass
        AND policy.polname = 'circles_delete_owner_or_staff') AS circles_delete_policy
)
SELECT
  function_ref.oid::regprocedure AS exact_signature,
  (SELECT count(*) FROM pg_proc overload WHERE overload.pronamespace = 'public'::regnamespace AND overload.proname = 'can_access_public_circle') AS overload_count,
  function_ref.return_type,
  function_ref.owner,
  function_ref.security_definer,
  function_ref.search_path,
  function_ref.volatility,
  function_ref.strict,
  function_ref.leakproof,
  function_ref.parallel_safety,
  function_ref.normalized_function_body_hash,
  function_ref.function_definition,
  coalesce((SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') FROM aclexplode(coalesce(function_ref.proacl, acldefault('f', (SELECT oid FROM pg_roles WHERE rolname = function_ref.owner)))) acl), false) AS public_execute,
  has_function_privilege('anon', function_ref.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', function_ref.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', function_ref.oid, 'EXECUTE') AS service_role_execute,
  surrounding.circles_status_constraint,
  surrounding.circles_select_policy,
  surrounding.circles_delete_policy
FROM function_snapshot function_ref
CROSS JOIN surrounding_snapshot surrounding;

ROLLBACK;
