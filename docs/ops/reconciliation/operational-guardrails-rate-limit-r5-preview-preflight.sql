-- UNEXECUTED PREVIEW-ONLY CATALOG PREFLIGHT. DO NOT RUN WITHOUT R5 APPROVAL.
-- READ ONLY. ONE RESULT SET. NO BUSINESS ROWS OR SECRETS.
WITH target AS (
  SELECT 'public.consume_forum_rate_limit(uuid,text,text,bigint)'::text AS identity
), functions AS (
  SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS arguments,
         pg_get_function_result(p.oid) AS result_type, pg_get_userbyid(p.proowner) AS owner,
         p.prosecdef, p.proconfig, p.proacl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'consume_forum_rate_limit'
), target_table AS (
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'forum_upload_attempts'
)
SELECT jsonb_build_object(
  'packet_version', 'operational-guardrails-rate-limit-r5-preview-preflight-v1',
  'target', (SELECT identity FROM target),
  'function_overload_count', (SELECT count(*) FROM functions),
  'functions', (SELECT coalesce(jsonb_agg(to_jsonb(functions)), '[]'::jsonb) FROM functions),
  'attempt_table', (SELECT coalesce(jsonb_agg(to_jsonb(target_table)), '[]'::jsonb) FROM target_table),
  'policy_count', (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.forum_upload_attempts'::regclass),
  'target_indexes', (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE i.indrelid = 'public.forum_upload_attempts'::regclass AND c.relname IN ('forum_upload_attempts_purpose_ip_created_idx','forum_upload_attempts_purpose_user_created_idx'))
) AS packet;
