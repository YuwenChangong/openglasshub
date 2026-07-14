-- READ ONLY PRODUCTION PREREQUISITE PREFLIGHT.
-- Scope: public.can_access_public_circle(uuid) and its direct catalog
-- dependencies only. Export every result set for security review.
BEGIN TRANSACTION READ ONLY;

SELECT
  p.oid::regprocedure AS exact_function,
  pg_get_function_result(p.oid) AS return_type,
  language.lanname AS language,
  pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef AS security_definer,
  p.provolatile::text AS volatility,
  p.proisstrict AS strict,
  p.proleakproof AS leakproof,
  p.proparallel::text AS parallel_safety,
  coalesce(array_to_string(p.proconfig, ', '), '') AS configuration,
  pg_get_functiondef(p.oid) AS function_definition,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'grantee', coalesce(grantee.rolname, 'PUBLIC'),
        'privilege', acl.privilege_type,
        'grantable', acl.is_grantable
      )
      ORDER BY coalesce(grantee.rolname, 'PUBLIC'), acl.privilege_type
    ) FILTER (WHERE acl.privilege_type IS NOT NULL),
    '[]'::jsonb
  ) AS execute_acl
FROM pg_proc p
JOIN pg_language language ON language.oid = p.prolang
LEFT JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl ON true
LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
WHERE p.oid = to_regprocedure('public.can_access_public_circle(uuid)')
GROUP BY p.oid, language.lanname
ORDER BY p.oid;

SELECT
  to_regprocedure('public.can_access_public_circle(uuid)') AS exact_function,
  (
    SELECT count(*)
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'can_access_public_circle'
  ) AS overload_count;

SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relkind,
  pg_get_userbyid(c.relowner) AS owner,
  coalesce(c.relacl::text, '') AS relation_acl,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.oid = to_regclass('public.circles');

SELECT
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null,
  pg_get_expr(d.adbin, d.adrelid) AS default_expression
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = to_regclass('public.circles')
  AND a.attname IN ('id', 'status', 'slug', 'name')
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY a.attname;

SELECT
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  pg_get_constraintdef(con.oid, true) AS constraint_definition
FROM pg_constraint con
WHERE con.conrelid = to_regclass('public.circles')
ORDER BY con.conname;

SELECT
  rolname,
  rolcanlogin,
  rolinherit,
  rolbypassrls
FROM pg_roles
WHERE rolname IN ('anon', 'authenticated', 'postgres')
ORDER BY rolname;

SELECT
  pol.polname AS policy_name,
  pol.polcmd::text AS command,
  pg_get_expr(pol.polqual, pol.polrelid) AS using_expression,
  pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expression
FROM pg_policy pol
WHERE pol.polrelid = to_regclass('public.circles')
ORDER BY pol.polname;

-- The expected function calls only PostgreSQL built-ins (exists/lower/coalesce)
-- and references no other public helper. This output proves no conflicting
-- overload already exists; it does not invoke any function or read business rows.
ROLLBACK;
