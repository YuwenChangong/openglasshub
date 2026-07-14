-- Remove default PUBLIC execution from privileged helpers while preserving
-- the exact source-proven callers. Function bodies, ownership, and policies stay unchanged.

revoke execute on function public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)
  to service_role;

revoke execute on function public.increment_post_view_count(uuid)
  from public;
grant execute on function public.increment_post_view_count(uuid)
  to anon, authenticated;

revoke execute on function public.can_create_user_report_target(text, uuid)
  from public, anon;
grant execute on function public.can_create_user_report_target(text, uuid)
  to authenticated;
