-- UNEXECUTED, READ-ONLY R7 PREFLIGHT. Requires R6 canary/residue success.
BEGIN TRANSACTION READ ONLY;
SELECT policyname, cmd, roles, permissive, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname='public' AND tablename='forum_upload_attempts'
  AND policyname IN ('forum_upload_attempts_insert_self','forum_upload_attempts_select_self',
                     'forum_upload_attempts_insert_authenticated','forum_upload_attempts_select_authenticated');
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='forum_upload_attempts';
ROLLBACK;
