-- UNEXECUTED, READ-ONLY R7 POSTFLIGHT. Both redundant policies must be absent.
BEGIN TRANSACTION READ ONLY;
SELECT policyname, cmd, roles, permissive, qual, with_check
FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='forum_upload_attempts';
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='forum_upload_attempts';
ROLLBACK;
