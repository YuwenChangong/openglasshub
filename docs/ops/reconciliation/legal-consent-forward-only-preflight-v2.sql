-- UNEXECUTED, READ-ONLY V2 PREFLIGHT. The shared set_updated_at helper is irrelevant.
WITH names AS (
  SELECT
    to_regclass('public.legal_policy_acceptances') IS NOT NULL AS table_present,
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname='set_legal_policy_acceptance_updated_at') AS dedicated_helper_present,
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'record_current_legal_policy_acceptance%') AS rpc_present,
    EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname='trg_legal_policy_acceptances_set_updated_at') AS trigger_present
), deps AS (
  SELECT count(*)=4 AS roles_exact, to_regclass('auth.users') IS NOT NULL AS auth_users_exact, to_regprocedure('gen_random_uuid()') IS NOT NULL AS uuid_exact,
    to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260712') AS ledger_exact
  FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','postgres')
)
SELECT jsonb_build_object('packet_version','legal-consent-forward-only-preflight-v2','classification',CASE WHEN (SELECT table_present OR dedicated_helper_present OR rpc_present OR trigger_present FROM names) THEN 'BLOCKED_PARTIAL_STATE' WHEN NOT (SELECT roles_exact AND auth_users_exact AND uuid_exact AND ledger_exact FROM deps) THEN 'BLOCKED_DEPENDENCY' ELSE 'SAFE_TO_CREATE_DEDICATED_HELPER_V2' END,'expected_object_count',53,'shared_helper_dependency',false,'names',(SELECT to_jsonb(names) FROM names),'dependencies',(SELECT to_jsonb(deps) FROM deps)) AS packet;
