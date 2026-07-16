-- UNEXECUTED, READ-ONLY R6-2 CATALOG PREFLIGHT. No business rows.
BEGIN TRANSACTION READ ONLY;
SELECT 'r6_packet' AS section, current_database() AS database_name,
       current_setting('server_version_num') AS server_version_num;
SELECT 'relation' AS section, c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_catalog.pg_class c WHERE c.oid = 'public.forum_upload_attempts'::regclass;
SELECT 'columns' AS section, a.attname, pg_catalog.format_type(a.atttypid,a.atttypmod)
FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.forum_upload_attempts'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum;
SELECT 'indexes' AS section, i.relname, x.indisvalid, x.indisready, x.indislive, pg_catalog.pg_get_indexdef(x.indexrelid)
FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid WHERE x.indrelid='public.forum_upload_attempts'::regclass;
SELECT 'policies' AS section, policyname, cmd, roles, qual, with_check FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='forum_upload_attempts';
SELECT 'table_acl' AS section, grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='forum_upload_attempts';
SELECT 'function' AS section, p.oid::regprocedure, pg_get_function_result(p.oid), pg_get_userbyid(p.proowner), p.prosecdef, p.provolatile, p.proparallel, p.proleakproof, p.proconfig, p.proacl
FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='consume_forum_rate_limit';
SELECT 'roles' AS section, rolname FROM pg_catalog.pg_roles WHERE rolname='service_role';
ROLLBACK;
