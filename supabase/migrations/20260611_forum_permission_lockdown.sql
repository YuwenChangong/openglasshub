-- P0 forum permission lockdown:
-- circle owners may manage the circle entity itself, but not other users' posts/comments/reports.

create or replace function public.can_manage_post(target_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select public.is_moderator_or_admin()), false);
$$;

create or replace function public.can_manage_report_target(
  p_target_type public.report_target_type,
  p_target_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select public.is_moderator_or_admin()), false);
$$;

drop policy if exists "posts_select_published_public" on public.posts;
create policy "posts_select_published_public"
on public.posts
for select
to anon, authenticated
using (
  status = 'published'
  or author_id = auth.uid()
  or (select public.is_moderator_or_admin())
);

drop policy if exists "posts_update_self_or_staff" on public.posts;
create policy "posts_update_self_or_staff"
on public.posts
for update
to authenticated
using (
  author_id = auth.uid()
  or (select public.is_moderator_or_admin())
)
with check (
  (
    author_id = auth.uid()
    and status in ('pending', 'published', 'deleted')
  )
  or (select public.is_moderator_or_admin())
);

drop policy if exists "comments_select_public_or_staff" on public.comments;
create policy "comments_select_public_or_staff"
on public.comments
for select
to anon, authenticated
using (
  status = 'published'
  or author_id = auth.uid()
  or exists (
    select 1 from public.posts p
    where p.id = comments.post_id and p.author_id = auth.uid()
  )
  or (select public.is_moderator_or_admin())
);

drop policy if exists "comments_update_self_or_staff" on public.comments;
create policy "comments_update_self_or_staff"
on public.comments
for update
to authenticated
using (
  author_id = auth.uid()
  or (select public.is_moderator_or_admin())
)
with check (
  (
    author_id = auth.uid()
    and status in ('published', 'deleted')
  )
  or (select public.is_moderator_or_admin())
);

drop policy if exists "reports_select_own_or_staff" on public.reports;
create policy "reports_select_own_or_staff"
on public.reports
for select
to authenticated
using (
  reporter_id = auth.uid()
  or (select public.is_moderator_or_admin())
);

drop policy if exists "post_media_select_public_or_owner" on public.post_media;
create policy "post_media_select_public_or_owner"
on public.post_media
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.posts p
    where p.id = post_media.post_id
      and (
        p.status = 'published'
        or p.author_id = auth.uid()
        or (select public.is_moderator_or_admin())
      )
  )
);
