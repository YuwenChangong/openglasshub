-- Require ordinary user report writes to use a verified reporter, a neutral
-- initial state, and the same public target ancestry enforced by the route.
-- This forward migration depends on can_access_public_circle from the earlier
-- authored comment-read visibility migration.

create or replace function public.can_create_user_report_target(
  target_type_input text,
  target_id_input uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case target_type_input
    when 'post' then exists (
      select 1
      from public.posts as post_ref
      join public.circles as circle_ref on circle_ref.id = post_ref.circle_id
      where post_ref.id = target_id_input
        and post_ref.status = 'published'
        and post_ref.moderation_status = 'published'
        and circle_ref.status = 'active'
        and public.can_access_public_circle(circle_ref.id)
    )
    when 'comment' then exists (
      select 1
      from public.comments as comment_ref
      join public.posts as post_ref on post_ref.id = comment_ref.post_id
      join public.circles as circle_ref on circle_ref.id = post_ref.circle_id
      where comment_ref.id = target_id_input
        and comment_ref.status = 'published'
        and comment_ref.moderation_status = 'published'
        and post_ref.status = 'published'
        and post_ref.moderation_status = 'published'
        and circle_ref.status = 'active'
        and public.can_access_public_circle(circle_ref.id)
    )
    when 'circle' then exists (
      select 1
      from public.circles as circle_ref
      where circle_ref.id = target_id_input
        and circle_ref.status = 'active'
        and public.can_access_public_circle(circle_ref.id)
    )
    when 'user' then exists (
      select 1
      from public.profiles as profile_ref
      where profile_ref.id = target_id_input
    )
    else false
  end;
$$;

drop policy if exists "reports_insert_self" on public.reports;
create policy "reports_insert_self"
on public.reports
for insert
to authenticated
with check (
  reporter_id = auth.uid()
  and status = 'open'
  and priority = 'normal'
  and assigned_to is null
  and resolved_by is null
  and resolved_at is null
  and resolution_note is null
  and public.can_create_user_report_target(target_type::text, target_id)
);
