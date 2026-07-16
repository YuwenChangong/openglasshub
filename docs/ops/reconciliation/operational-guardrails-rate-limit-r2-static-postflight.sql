-- UNEXECUTED CATALOG REVIEW QUERY ONLY
-- NOT APPROVED FOR PRODUCTION. DO NOT RUN.
-- R3 LOCAL SIMULATION APPROVAL REQUIRED BEFORE EXECUTION ANYWHERE.

WITH target AS (
  SELECT 'public.consume_forum_rate_limit(uuid,text,text,bigint)'::text AS identity
), functions AS (
  SELECT p.oid,
         n.nspname AS schema_name,
         p.proname,
         pg_get_function_identity_arguments(p.oid) AS identity_arguments,
         pg_get_function_result(p.oid) AS result_type,
         p.prosecdef,
         p.provolatile,
         p.proparallel,
          p.proleakproof,
          p.proconfig,
          p.proowner,
          pg_get_userbyid(p.proowner) AS owner_name,
         p.proacl
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'consume_forum_rate_limit'
), acl AS (
  SELECT functions.oid,
         jsonb_agg(jsonb_build_object(
           'grantee', CASE WHEN entry.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(entry.grantee) END,
           'privilege', entry.privilege_type,
           'grantable', entry.is_grantable
         ) ORDER BY CASE WHEN entry.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(entry.grantee) END, entry.privilege_type) AS matrix
    FROM functions
    CROSS JOIN LATERAL aclexplode(coalesce(functions.proacl, acldefault('f', functions.proowner))) AS entry
   GROUP BY functions.oid
)
SELECT target.identity,
       count(functions.oid) AS matching_name_overload_count,
       jsonb_agg(jsonb_build_object(
         'identity_arguments', functions.identity_arguments,
         'result_type', functions.result_type,
         'security_definer', functions.prosecdef,
         'volatility', functions.provolatile,
         'parallel', functions.proparallel,
         'leakproof', functions.proleakproof,
         'search_path', functions.proconfig,
         'owner', functions.owner_name,
         'acl', acl.matrix
       ) ORDER BY functions.identity_arguments) AS functions
  FROM target
  LEFT JOIN functions ON true
  LEFT JOIN acl ON acl.oid = functions.oid
 GROUP BY target.identity;
