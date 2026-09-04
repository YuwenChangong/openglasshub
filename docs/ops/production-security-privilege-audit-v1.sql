BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

WITH expected(object_kind, object_identity, principal, privilege, expected_state) AS (
  VALUES
    ('FUNCTION', 'public.bump_post_last_activity()', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.can_access_comment_reaction_target(uuid)', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.can_access_public_circle(uuid)', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.can_access_public_circle_cover_object(text)', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.can_access_public_comment_read_target(uuid)', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.can_access_public_post_media_object(text)', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.can_access_public_profile_media_object(text)', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.can_bind_post_media_provenance(text, text, text, uuid, uuid)', 'anon', 'EXECUTE', false),
    ('FUNCTION', 'public.can_bind_post_media_provenance(text, text, text, uuid, uuid)', 'authenticated', 'EXECUTE', false),
    ('FUNCTION', 'public.can_bind_post_media_provenance(text, text, text, uuid, uuid)', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.can_create_comment_target(uuid, uuid)', 'public', 'EXECUTE', false),
    ('FUNCTION', 'public.can_create_comment_target(uuid, uuid)', 'anon', 'EXECUTE', false),
    ('FUNCTION', 'public.can_create_comment_target(uuid, uuid)', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.can_create_user_report_target(text, uuid)', 'public', 'EXECUTE', false),
    ('FUNCTION', 'public.can_create_user_report_target(text, uuid)', 'anon', 'EXECUTE', false),
    ('FUNCTION', 'public.can_create_user_report_target(text, uuid)', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.can_manage_circle(uuid)', 'anon', 'EXECUTE', false),
    ('FUNCTION', 'public.can_manage_circle(uuid)', 'authenticated', 'EXECUTE', false),
    ('FUNCTION', 'public.can_manage_circle(uuid)', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.can_manage_post(uuid)', 'anon', 'EXECUTE', false),
    ('FUNCTION', 'public.can_manage_post(uuid)', 'authenticated', 'EXECUTE', false),
    ('FUNCTION', 'public.can_manage_post(uuid)', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.can_manage_report_target(public.report_target_type, uuid)', 'anon', 'EXECUTE', false),
    ('FUNCTION', 'public.can_manage_report_target(public.report_target_type, uuid)', 'authenticated', 'EXECUTE', false),
    ('FUNCTION', 'public.can_manage_report_target(public.report_target_type, uuid)', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.consume_verification_email_resend_limit(text, integer, integer)', 'public', 'EXECUTE', false),
    ('FUNCTION', 'public.consume_verification_email_resend_limit(text, integer, integer)', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.current_user_role()', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.enforce_forum_notification_read_update()', 'anon', 'EXECUTE', false),
    ('FUNCTION', 'public.enforce_forum_notification_read_update()', 'authenticated', 'EXECUTE', false),
    ('FUNCTION', 'public.enforce_forum_notification_read_update()', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.handle_new_user()', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.increment_news_article_view(text)', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.increment_post_view_count(uuid)', 'public', 'EXECUTE', false),
    ('FUNCTION', 'public.increment_post_view_count(uuid)', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.is_canonical_post_media_object_key(text, uuid, uuid, boolean)', 'anon', 'EXECUTE', false),
    ('FUNCTION', 'public.is_canonical_post_media_object_key(text, uuid, uuid, boolean)', 'authenticated', 'EXECUTE', false),
    ('FUNCTION', 'public.is_canonical_post_media_object_key(text, uuid, uuid, boolean)', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.is_moderator_or_admin()', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.notify_comment_created()', 'anon', 'EXECUTE', false),
    ('FUNCTION', 'public.notify_comment_created()', 'authenticated', 'EXECUTE', false),
    ('FUNCTION', 'public.notify_comment_created()', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.notify_comment_like()', 'anon', 'EXECUTE', false),
    ('FUNCTION', 'public.notify_comment_like()', 'authenticated', 'EXECUTE', false),
    ('FUNCTION', 'public.notify_comment_like()', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.notify_post_like()', 'anon', 'EXECUTE', false),
    ('FUNCTION', 'public.notify_post_like()', 'authenticated', 'EXECUTE', false),
    ('FUNCTION', 'public.notify_post_like()', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.prevent_unauthorized_profile_role_change()', 'public', 'EXECUTE', false),
    ('FUNCTION', 'public.prevent_unauthorized_profile_role_change()', 'anon', 'EXECUTE', false),
    ('FUNCTION', 'public.prevent_unauthorized_profile_role_change()', 'authenticated', 'EXECUTE', false),
    ('FUNCTION', 'public.prevent_unauthorized_profile_role_change()', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.set_updated_at()', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.validate_moderation_target()', 'service_role', 'EXECUTE', false),
    ('FUNCTION', 'public.validate_report_target()', 'service_role', 'EXECUTE', false),
    ('TABLE', 'public.bookmarks', 'anon', 'DELETE', false),
    ('TABLE', 'public.bookmarks', 'service_role', 'DELETE', false),
    ('TABLE', 'public.bookmarks', 'anon', 'INSERT', false),
    ('TABLE', 'public.bookmarks', 'service_role', 'INSERT', false),
    ('TABLE', 'public.bookmarks', 'anon', 'SELECT', false),
    ('TABLE', 'public.bookmarks', 'service_role', 'SELECT', false),
    ('TABLE', 'public.bookmarks', 'anon', 'UPDATE', false),
    ('TABLE', 'public.bookmarks', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.circles', 'anon', 'DELETE', false),
    ('TABLE', 'public.circles', 'anon', 'INSERT', false),
    ('TABLE', 'public.circles', 'anon', 'UPDATE', false),
    ('TABLE', 'public.circles', 'service_role', 'DELETE', false),
    ('TABLE', 'public.circles', 'service_role', 'INSERT', false),
    ('TABLE', 'public.circles', 'service_role', 'SELECT', false),
    ('TABLE', 'public.circles', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.comment_reactions', 'anon', 'DELETE', false),
    ('TABLE', 'public.comment_reactions', 'authenticated', 'DELETE', false),
    ('TABLE', 'public.comment_reactions', 'service_role', 'DELETE', false),
    ('TABLE', 'public.comment_reactions', 'anon', 'INSERT', false),
    ('TABLE', 'public.comment_reactions', 'authenticated', 'INSERT', false),
    ('TABLE', 'public.comment_reactions', 'service_role', 'INSERT', false),
    ('TABLE', 'public.comment_reactions', 'anon', 'SELECT', false),
    ('TABLE', 'public.comment_reactions', 'authenticated', 'SELECT', false),
    ('TABLE', 'public.comment_reactions', 'service_role', 'SELECT', false),
    ('TABLE', 'public.comment_reactions', 'anon', 'UPDATE', false),
    ('TABLE', 'public.comment_reactions', 'authenticated', 'UPDATE', false),
    ('TABLE', 'public.comment_reactions', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.comments', 'anon', 'DELETE', false),
    ('TABLE', 'public.comments', 'anon', 'INSERT', false),
    ('TABLE', 'public.comments', 'anon', 'UPDATE', false),
    ('TABLE', 'public.comments', 'service_role', 'DELETE', false),
    ('TABLE', 'public.comments', 'service_role', 'INSERT', false),
    ('TABLE', 'public.comments', 'service_role', 'SELECT', false),
    ('TABLE', 'public.comments', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.forum_notifications', 'anon', 'DELETE', false),
    ('TABLE', 'public.forum_notifications', 'service_role', 'DELETE', false),
    ('TABLE', 'public.forum_notifications', 'anon', 'INSERT', false),
    ('TABLE', 'public.forum_notifications', 'service_role', 'INSERT', false),
    ('TABLE', 'public.forum_notifications', 'anon', 'SELECT', false),
    ('TABLE', 'public.forum_notifications', 'service_role', 'SELECT', false),
    ('TABLE', 'public.forum_notifications', 'anon', 'UPDATE', false),
    ('TABLE', 'public.forum_notifications', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.forum_notifications', 'authenticated', 'INSERT', false),
    ('TABLE', 'public.forum_upload_attempts', 'anon', 'DELETE', false),
    ('TABLE', 'public.forum_upload_attempts', 'authenticated', 'DELETE', false),
    ('TABLE', 'public.forum_upload_attempts', 'service_role', 'DELETE', false),
    ('TABLE', 'public.forum_upload_attempts', 'anon', 'INSERT', false),
    ('TABLE', 'public.forum_upload_attempts', 'authenticated', 'INSERT', false),
    ('TABLE', 'public.forum_upload_attempts', 'service_role', 'INSERT', false),
    ('TABLE', 'public.forum_upload_attempts', 'anon', 'SELECT', false),
    ('TABLE', 'public.forum_upload_attempts', 'authenticated', 'SELECT', false),
    ('TABLE', 'public.forum_upload_attempts', 'service_role', 'SELECT', false),
    ('TABLE', 'public.forum_upload_attempts', 'anon', 'UPDATE', false),
    ('TABLE', 'public.forum_upload_attempts', 'authenticated', 'UPDATE', false),
    ('TABLE', 'public.forum_upload_attempts', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.legal_policy_acceptances', 'service_role', 'DELETE', false),
    ('TABLE', 'public.legal_policy_acceptances', 'service_role', 'INSERT', false),
    ('TABLE', 'public.legal_policy_acceptances', 'service_role', 'SELECT', false),
    ('TABLE', 'public.legal_policy_acceptances', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.moderation_actions', 'anon', 'DELETE', false),
    ('TABLE', 'public.moderation_actions', 'service_role', 'DELETE', false),
    ('TABLE', 'public.moderation_actions', 'anon', 'INSERT', false),
    ('TABLE', 'public.moderation_actions', 'service_role', 'INSERT', false),
    ('TABLE', 'public.moderation_actions', 'anon', 'SELECT', false),
    ('TABLE', 'public.moderation_actions', 'service_role', 'SELECT', false),
    ('TABLE', 'public.moderation_actions', 'anon', 'UPDATE', false),
    ('TABLE', 'public.moderation_actions', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.moderation_actions', 'authenticated', 'DELETE', false),
    ('TABLE', 'public.moderation_actions', 'authenticated', 'UPDATE', false),
    ('TABLE', 'public.news_articles', 'anon', 'DELETE', false),
    ('TABLE', 'public.news_articles', 'anon', 'INSERT', false),
    ('TABLE', 'public.news_articles', 'anon', 'UPDATE', false),
    ('TABLE', 'public.news_articles', 'service_role', 'DELETE', false),
    ('TABLE', 'public.news_articles', 'service_role', 'INSERT', false),
    ('TABLE', 'public.news_articles', 'service_role', 'SELECT', false),
    ('TABLE', 'public.news_articles', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.post_media', 'anon', 'DELETE', false),
    ('TABLE', 'public.post_media', 'anon', 'INSERT', false),
    ('TABLE', 'public.post_media', 'anon', 'UPDATE', false),
    ('TABLE', 'public.post_media', 'service_role', 'DELETE', false),
    ('TABLE', 'public.post_media', 'service_role', 'INSERT', false),
    ('TABLE', 'public.post_media', 'service_role', 'SELECT', false),
    ('TABLE', 'public.post_media', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.post_votes', 'anon', 'DELETE', false),
    ('TABLE', 'public.post_votes', 'anon', 'INSERT', false),
    ('TABLE', 'public.post_votes', 'anon', 'UPDATE', false),
    ('TABLE', 'public.post_votes', 'service_role', 'DELETE', false),
    ('TABLE', 'public.post_votes', 'service_role', 'INSERT', false),
    ('TABLE', 'public.post_votes', 'service_role', 'SELECT', false),
    ('TABLE', 'public.post_votes', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.posts', 'anon', 'DELETE', false),
    ('TABLE', 'public.posts', 'anon', 'INSERT', false),
    ('TABLE', 'public.posts', 'anon', 'UPDATE', false),
    ('TABLE', 'public.posts', 'service_role', 'DELETE', false),
    ('TABLE', 'public.posts', 'service_role', 'INSERT', false),
    ('TABLE', 'public.posts', 'service_role', 'SELECT', false),
    ('TABLE', 'public.posts', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.profiles', 'anon', 'DELETE', false),
    ('TABLE', 'public.profiles', 'anon', 'INSERT', false),
    ('TABLE', 'public.profiles', 'anon', 'UPDATE', false),
    ('TABLE', 'public.profiles', 'service_role', 'DELETE', false),
    ('TABLE', 'public.profiles', 'service_role', 'INSERT', false),
    ('TABLE', 'public.profiles', 'service_role', 'SELECT', false),
    ('TABLE', 'public.profiles', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.report_events', 'anon', 'DELETE', false),
    ('TABLE', 'public.report_events', 'service_role', 'DELETE', false),
    ('TABLE', 'public.report_events', 'anon', 'INSERT', false),
    ('TABLE', 'public.report_events', 'service_role', 'INSERT', false),
    ('TABLE', 'public.report_events', 'anon', 'SELECT', false),
    ('TABLE', 'public.report_events', 'service_role', 'SELECT', false),
    ('TABLE', 'public.report_events', 'anon', 'UPDATE', false),
    ('TABLE', 'public.report_events', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.report_events', 'authenticated', 'DELETE', false),
    ('TABLE', 'public.report_events', 'authenticated', 'UPDATE', false),
    ('TABLE', 'public.reports', 'anon', 'DELETE', false),
    ('TABLE', 'public.reports', 'service_role', 'DELETE', false),
    ('TABLE', 'public.reports', 'anon', 'INSERT', false),
    ('TABLE', 'public.reports', 'service_role', 'INSERT', false),
    ('TABLE', 'public.reports', 'anon', 'SELECT', false),
    ('TABLE', 'public.reports', 'service_role', 'SELECT', false),
    ('TABLE', 'public.reports', 'anon', 'UPDATE', false),
    ('TABLE', 'public.reports', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.user_safety_events', 'anon', 'DELETE', false),
    ('TABLE', 'public.user_safety_events', 'service_role', 'DELETE', false),
    ('TABLE', 'public.user_safety_events', 'anon', 'INSERT', false),
    ('TABLE', 'public.user_safety_events', 'service_role', 'INSERT', false),
    ('TABLE', 'public.user_safety_events', 'anon', 'SELECT', false),
    ('TABLE', 'public.user_safety_events', 'service_role', 'SELECT', false),
    ('TABLE', 'public.user_safety_events', 'anon', 'UPDATE', false),
    ('TABLE', 'public.user_safety_events', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.user_safety_events', 'authenticated', 'DELETE', false),
    ('TABLE', 'public.user_safety_events', 'authenticated', 'UPDATE', false),
    ('TABLE', 'public.user_safety_states', 'anon', 'DELETE', false),
    ('TABLE', 'public.user_safety_states', 'service_role', 'DELETE', false),
    ('TABLE', 'public.user_safety_states', 'anon', 'INSERT', false),
    ('TABLE', 'public.user_safety_states', 'service_role', 'INSERT', false),
    ('TABLE', 'public.user_safety_states', 'anon', 'SELECT', false),
    ('TABLE', 'public.user_safety_states', 'service_role', 'SELECT', false),
    ('TABLE', 'public.user_safety_states', 'anon', 'UPDATE', false),
    ('TABLE', 'public.user_safety_states', 'service_role', 'UPDATE', false),
    ('TABLE', 'public.user_safety_states', 'authenticated', 'DELETE', false),
    ('FUNCTION', 'public.can_create_comment_target(uuid, uuid)', 'authenticated', 'EXECUTE', true),
    ('FUNCTION', 'public.can_create_user_report_target(text, uuid)', 'authenticated', 'EXECUTE', true),
    ('FUNCTION', 'public.consume_verification_email_resend_limit(text, integer, integer)', 'anon', 'EXECUTE', true),
    ('FUNCTION', 'public.consume_verification_email_resend_limit(text, integer, integer)', 'authenticated', 'EXECUTE', true),
    ('FUNCTION', 'public.increment_post_view_count(uuid)', 'anon', 'EXECUTE', true),
    ('FUNCTION', 'public.increment_post_view_count(uuid)', 'authenticated', 'EXECUTE', true)
),
resolved AS (
  SELECT
    expected.*,
    CASE WHEN expected.object_kind = 'FUNCTION' THEN to_regprocedure(expected.object_identity) ELSE to_regclass(expected.object_identity) END AS object_oid,
    roles.oid AS principal_oid
  FROM expected
  LEFT JOIN pg_catalog.pg_roles AS roles ON roles.rolname = expected.principal
),
observed AS (
  SELECT
    resolved.*,
    CASE
      WHEN resolved.object_kind = 'FUNCTION' THEN COALESCE((
        SELECT bool_or(acl.grantee = CASE WHEN resolved.principal = 'public' THEN 0 ELSE resolved.principal_oid END AND acl.privilege_type = resolved.privilege)
        FROM pg_catalog.pg_proc AS procedures
        CROSS JOIN LATERAL aclexplode(COALESCE(procedures.proacl, '{}'::aclitem[])) AS acl
        WHERE procedures.oid = resolved.object_oid
      ), false)
      ELSE COALESCE((
        SELECT bool_or(acl.grantee = CASE WHEN resolved.principal = 'public' THEN 0 ELSE resolved.principal_oid END AND acl.privilege_type = resolved.privilege)
        FROM pg_catalog.pg_class AS relations
        CROSS JOIN LATERAL aclexplode(COALESCE(relations.relacl, '{}'::aclitem[])) AS acl
        WHERE relations.oid = resolved.object_oid
      ), false)
    END AS observed_direct_state,
    CASE
      WHEN resolved.object_kind = 'FUNCTION' AND resolved.principal = 'public' THEN COALESCE((
        SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = resolved.privilege)
        FROM pg_catalog.pg_proc AS procedures
        CROSS JOIN LATERAL aclexplode(COALESCE(procedures.proacl, acldefault('f', procedures.proowner))) AS acl
        WHERE procedures.oid = resolved.object_oid
      ), false)
      WHEN resolved.object_kind = 'FUNCTION' THEN has_function_privilege(resolved.principal, resolved.object_oid, resolved.privilege)
      WHEN resolved.principal = 'public' THEN COALESCE((
        SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = resolved.privilege)
        FROM pg_catalog.pg_class AS relations
        CROSS JOIN LATERAL aclexplode(COALESCE(relations.relacl, acldefault('r', relations.relowner))) AS acl
        WHERE relations.oid = resolved.object_oid
      ), false)
      ELSE has_table_privilege(resolved.principal, resolved.object_oid, resolved.privilege)
    END AS observed_effective_state,
    CASE
      WHEN resolved.object_kind = 'FUNCTION' THEN COALESCE((SELECT procedures.proowner = resolved.principal_oid FROM pg_catalog.pg_proc AS procedures WHERE procedures.oid = resolved.object_oid), false)
      ELSE COALESCE((SELECT relations.relowner = resolved.principal_oid FROM pg_catalog.pg_class AS relations WHERE relations.oid = resolved.object_oid), false)
    END AS owner_implicit
  FROM resolved
),
history AS (
  SELECT count(*)::text AS row_count, min(version)::text AS version, min(name)::text AS name
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260904054013'
),
summary AS (
  SELECT count(*)::text AS total, count(*) FILTER (WHERE object_oid IS NOT NULL AND observed_direct_state = expected_state AND observed_effective_state = expected_state)::text AS passed
  FROM observed
)
SELECT
  'POSTCONDITION'::text AS audit_kind,
  'public'::text AS object_schema,
  object_kind,
  object_identity,
  principal,
  privilege,
  expected_state::text AS expected_state,
  observed_direct_state::text AS observed_direct_state,
  observed_effective_state::text AS observed_effective_state,
  (object_oid IS NOT NULL AND observed_direct_state = expected_state AND observed_effective_state = expected_state)::text AS postcondition_pass,
  CASE
    WHEN object_oid IS NULL THEN 'OBJECT_IDENTITY_UNRESOLVED'
    WHEN owner_implicit THEN 'OWNER_IMPLICIT'
    WHEN principal = 'public' AND observed_effective_state THEN 'PUBLIC_INHERITED'
    WHEN observed_direct_state THEN 'DIRECT_GRANT'
    WHEN observed_effective_state THEN 'ROLE_INHERITED'
    ELSE 'NO_PRIVILEGE'
  END AS diagnostic
FROM observed
UNION ALL
SELECT 'AUDIT_POSTCONDITION_TOTAL', NULL, NULL, NULL, NULL, NULL, total, NULL, NULL, NULL, 'MIGRATION_SHA256=98819214E5BECE6D659E0B0CC2A3B16865F84227E8AB6A1D4DBCAC0B7CDDF3C5' FROM summary
UNION ALL
SELECT 'AUDIT_POSTCONDITION_PASS', NULL, NULL, NULL, NULL, NULL, passed, NULL, NULL, NULL, 'EXPECTED=202' FROM summary
UNION ALL
SELECT 'AUDIT_POSTCONDITION_FAIL', NULL, NULL, NULL, NULL, NULL, (total::integer - passed::integer)::text, NULL, NULL, NULL, 'ALREADY_CONVERGED_ONLY_IF_ZERO' FROM summary
UNION ALL
SELECT 'SECURITY_MIGRATION_HISTORY_ROW_COUNT', NULL, NULL, version, NULL, NULL, row_count, NULL, NULL, NULL, coalesce(name, 'ABSENT') FROM history
UNION ALL
SELECT 'CAN_CREATE_COMMENT_TARGET_PUBLIC_EXECUTE', 'public', 'FUNCTION', 'public.can_create_comment_target(uuid,uuid)', 'public', 'EXECUTE', 'false', observed_direct_state::text, observed_effective_state::text, (observed_direct_state = false AND observed_effective_state = false)::text, 'EXACT_SIGNATURE' FROM observed WHERE object_identity = 'public.can_create_comment_target(uuid,uuid)' AND principal = 'public' AND privilege = 'EXECUTE'
UNION ALL
SELECT 'CAN_CREATE_COMMENT_TARGET_ANON_EXECUTE', 'public', 'FUNCTION', 'public.can_create_comment_target(uuid,uuid)', 'anon', 'EXECUTE', 'false', observed_direct_state::text, observed_effective_state::text, (observed_direct_state = false AND observed_effective_state = false)::text, 'EXACT_SIGNATURE' FROM observed WHERE object_identity = 'public.can_create_comment_target(uuid,uuid)' AND principal = 'anon' AND privilege = 'EXECUTE'
UNION ALL
SELECT 'CAN_CREATE_COMMENT_TARGET_AUTHENTICATED_EXECUTE', 'public', 'FUNCTION', 'public.can_create_comment_target(uuid,uuid)', 'authenticated', 'EXECUTE', 'true', observed_direct_state::text, observed_effective_state::text, (observed_direct_state = true AND observed_effective_state = true)::text, 'EXACT_SIGNATURE' FROM observed WHERE object_identity = 'public.can_create_comment_target(uuid,uuid)' AND principal = 'authenticated' AND privilege = 'EXECUTE'
ORDER BY audit_kind, object_kind, object_identity, principal, privilege;

ROLLBACK;
