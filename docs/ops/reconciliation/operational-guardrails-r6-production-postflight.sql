-- UNEXECUTED, READ-ONLY R6-6 POSTFLIGHT. Run only after approved R6-5.
-- Expected ACL: PUBLIC/anon/authenticated execute=false; service_role=true.
BEGIN TRANSACTION READ ONLY;
SELECT p.oid::regprocedure AS signature, pg_get_function_result(p.oid) AS return_type,
 pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.provolatile, p.proparallel,
 p.proleakproof, p.proconfig, p.proacl
FROM pg_catalog.pg_proc p WHERE p.oid='public.consume_forum_rate_limit(uuid,text,text,bigint)'::regprocedure;
SELECT indexrelid::regclass, indisvalid, indisready, indislive FROM pg_catalog.pg_index WHERE indrelid='public.forum_upload_attempts'::regclass;
SELECT policyname, cmd, roles, qual, with_check FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='forum_upload_attempts';
SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='forum_upload_attempts';
ROLLBACK;
