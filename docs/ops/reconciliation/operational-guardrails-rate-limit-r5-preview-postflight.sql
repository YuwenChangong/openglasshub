-- UNEXECUTED PREVIEW-ONLY READ-ONLY POSTFLIGHT. DO NOT RUN WITHOUT R5 APPROVAL.
WITH functions AS (
  SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS arguments,
         pg_get_function_result(p.oid) AS result_type, pg_get_userbyid(p.proowner) AS owner,
         p.prosecdef, p.provolatile, p.proparallel, p.proleakproof, p.proconfig, p.proacl, p.proowner
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'consume_forum_rate_limit'
), acl AS (
  SELECT f.oid, jsonb_agg(jsonb_build_object('grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, 'privilege', a.privilege_type) ORDER BY a.grantee, a.privilege_type) AS matrix
  FROM functions f CROSS JOIN LATERAL aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a GROUP BY f.oid
)
SELECT jsonb_build_object('packet_version','operational-guardrails-rate-limit-r5-preview-postflight-v1','overload_count',(SELECT count(*) FROM functions),'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('arguments',f.arguments,'result_type',f.result_type,'owner',f.owner,'security_definer',f.prosecdef,'volatility',f.provolatile,'parallel',f.proparallel,'leakproof',f.proleakproof,'settings',f.proconfig,'acl',acl.matrix)),'[]'::jsonb) FROM functions f LEFT JOIN acl ON acl.oid=f.oid),'policy_count',(SELECT count(*) FROM pg_policy WHERE polrelid='public.forum_upload_attempts'::regclass),'index_count',(SELECT count(*) FROM pg_index WHERE indrelid='public.forum_upload_attempts'::regclass)) AS packet;
