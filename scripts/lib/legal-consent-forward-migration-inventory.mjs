export const REQUIRED_FORWARD_MIGRATIONS = Object.freeze([
  ["20260703_moderation_action_notifications.sql", [], ["forum_notifications_type_check", "public.insert_forum_notification", "set search_path = public, pg_temp"]],
  ["20260712_legal_policy_acceptances.sql", [], ["public.legal_policy_acceptances", "legal_policy_acceptances_user_bundle_key", "legal_policy_acceptances_bundle_last_confirmed_idx", "public.record_current_legal_policy_acceptance", "revoke all on function"]],
  ["20260713_comment_creation_circle_authorization.sql", [], ["public.can_create_comment_target", "comments_insert_self", "revoke all on function"]],
  ["20260713_comment_reaction_visibility_authorization.sql", [], ["public.can_access_comment_reaction_target", "comment_reactions_insert_self", "comment_reactions_update_self", "comment_reactions_delete_self"]],
  ["20260713_comment_read_circle_visibility_authorization.sql", [], ["public.can_access_public_circle", "public.can_access_public_comment_read_target", "posts_select_published_public", "comments_select_public_or_staff"]],
  ["20260713_forum_posts_circle_authorization.sql", ["20260713_comment_read_circle_visibility_authorization.sql"], ["posts_insert_self", "posts_update_self_or_staff", "posts_delete_self_or_staff", "public.increment_post_view_count"]],
  ["20260713_forum_report_target_authorization.sql", ["20260713_comment_read_circle_visibility_authorization.sql"], ["public.can_create_user_report_target", "reports_insert_self", "public.can_access_public_circle"]],
  ["20260713_post_bound_media_provenance.sql", [], ["public.is_canonical_post_media_object_key", "public.can_bind_post_media_provenance", "post_media_insert_self", "post_media_update_self_or_staff"]],
  ["20260714_circle_cover_public_visibility_authorization.sql", ["20260713_comment_read_circle_visibility_authorization.sql"], ["public.can_access_public_circle_cover_object", "circles_select_public", "circle_cover_objects_select_public"]],
  ["20260715_post_media_delivery_visibility_authorization.sql", ["20260713_comment_read_circle_visibility_authorization.sql", "20260713_post_bound_media_provenance.sql"], ["public.can_access_public_post_media_object", "post_media_select_public_or_owner", "post_media_objects_select_public_or_owner"]],
  ["20260716_profile_media_delivery_authorization.sql", [], ["public.can_access_public_profile_media_object", "profile_avatar_objects_select_public", "profile_banner_objects_select_public"]],
  ["20260717_security_definer_execute_hardening.sql", ["20260716_profile_media_delivery_authorization.sql"], ["public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)", "public.increment_post_view_count(uuid)", "public.can_create_user_report_target(text, uuid)"]],
].map(([file, dependencies, fragments]) => Object.freeze({ file, dependencies: Object.freeze(dependencies), fragments: Object.freeze(fragments) })));

export const REQUIRED_FORWARD_MIGRATION_FILES = Object.freeze(REQUIRED_FORWARD_MIGRATIONS.map(({ file }) => file));
