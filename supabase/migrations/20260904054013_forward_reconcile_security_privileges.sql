-- Forward-only privilege convergence for the application-owned public schema.
-- Revoke only the direct grants that the canonical 48-migration local replay
-- proved are injected by runtime defaults beyond the existing application ACL
-- contract. Historical migrations, data, and Supabase system schemas are not
-- touched.

revoke execute on function public.bump_post_last_activity() from service_role;
revoke execute on function public.can_access_comment_reaction_target(uuid) from service_role;
revoke execute on function public.can_access_public_circle(uuid) from service_role;
revoke execute on function public.can_access_public_circle_cover_object(text) from service_role;
revoke execute on function public.can_access_public_comment_read_target(uuid) from service_role;
revoke execute on function public.can_access_public_post_media_object(text) from service_role;
revoke execute on function public.can_access_public_profile_media_object(text) from service_role;
revoke execute on function public.can_bind_post_media_provenance(text, text, text, uuid, uuid) from anon, authenticated, service_role;
revoke execute on function public.can_create_comment_target(uuid, uuid) from public, anon, service_role;
grant execute on function public.can_create_comment_target(uuid, uuid) to authenticated;
revoke execute on function public.can_create_user_report_target(text, uuid) from public, anon, service_role;
grant execute on function public.can_create_user_report_target(text, uuid) to authenticated;
revoke execute on function public.can_manage_circle(uuid) from anon, authenticated, service_role;
revoke execute on function public.can_manage_post(uuid) from anon, authenticated, service_role;
revoke execute on function public.can_manage_report_target(public.report_target_type, uuid) from anon, authenticated, service_role;
revoke execute on function public.consume_verification_email_resend_limit(text, integer, integer) from public, service_role;
grant execute on function public.consume_verification_email_resend_limit(text, integer, integer) to anon, authenticated;
revoke execute on function public.current_user_role() from service_role;
revoke execute on function public.enforce_forum_notification_read_update() from anon, authenticated, service_role;
revoke execute on function public.handle_new_user() from service_role;
revoke execute on function public.increment_news_article_view(text) from service_role;
revoke execute on function public.increment_post_view_count(uuid) from public, service_role;
grant execute on function public.increment_post_view_count(uuid) to anon, authenticated;
revoke execute on function public.is_canonical_post_media_object_key(text, uuid, uuid, boolean) from anon, authenticated, service_role;
revoke execute on function public.is_moderator_or_admin() from service_role;
revoke execute on function public.notify_comment_created() from anon, authenticated, service_role;
revoke execute on function public.notify_comment_like() from anon, authenticated, service_role;
revoke execute on function public.notify_post_like() from anon, authenticated, service_role;
revoke execute on function public.prevent_unauthorized_profile_role_change() from public, anon, authenticated, service_role;
revoke execute on function public.set_updated_at() from service_role;
revoke execute on function public.validate_moderation_target() from service_role;
revoke execute on function public.validate_report_target() from service_role;

revoke delete, insert, select, update on table public.bookmarks from anon, service_role;
revoke delete, insert, update on table public.circles from anon;
revoke delete, insert, select, update on table public.circles from service_role;
revoke delete, insert, select, update on table public.comment_reactions from anon, authenticated, service_role;
revoke delete, insert, update on table public.comments from anon;
revoke delete, insert, select, update on table public.comments from service_role;
revoke delete, insert, select, update on table public.forum_notifications from anon, service_role;
revoke insert on table public.forum_notifications from authenticated;
revoke delete, insert, select, update on table public.forum_upload_attempts from anon, authenticated, service_role;
revoke delete, insert, select, update on table public.legal_policy_acceptances from service_role;
revoke delete, insert, select, update on table public.moderation_actions from anon, service_role;
revoke delete, update on table public.moderation_actions from authenticated;
revoke delete, insert, update on table public.news_articles from anon;
revoke delete, insert, select, update on table public.news_articles from service_role;
revoke delete, insert, update on table public.post_media from anon;
revoke delete, insert, select, update on table public.post_media from service_role;
revoke delete, insert, update on table public.post_votes from anon;
revoke delete, insert, select, update on table public.post_votes from service_role;
revoke delete, insert, update on table public.posts from anon;
revoke delete, insert, select, update on table public.posts from service_role;
revoke delete, insert, update on table public.profiles from anon;
revoke delete, insert, select, update on table public.profiles from service_role;
revoke delete, insert, select, update on table public.report_events from anon, service_role;
revoke delete, update on table public.report_events from authenticated;
revoke delete, insert, select, update on table public.reports from anon, service_role;
revoke delete, insert, select, update on table public.user_safety_events from anon, service_role;
revoke delete, update on table public.user_safety_events from authenticated;
revoke delete, insert, select, update on table public.user_safety_states from anon, service_role;
revoke delete on table public.user_safety_states from authenticated;
