create unique index if not exists circles_name_lower_unique
on public.circles (lower(name));

create or replace function public.can_manage_circle(target_circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.circles c
      where c.id = target_circle_id
        and c.owner_id = auth.uid()
    )
    or (select public.is_moderator_or_admin()),
    false
  );
$$;

create or replace function public.can_manage_post(target_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.posts p
      join public.circles c on c.id = p.circle_id
      where p.id = target_post_id
        and c.owner_id = auth.uid()
    )
    or (select public.is_moderator_or_admin()),
    false
  );
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
  select case
    when p_target_type = 'post' then public.can_manage_post(p_target_id)
    when p_target_type = 'comment' then coalesce(
      exists (
        select 1
        from public.comments c
        join public.posts p on p.id = c.post_id
        join public.circles circle_ref on circle_ref.id = p.circle_id
        where c.id = p_target_id
          and circle_ref.owner_id = auth.uid()
      )
      or (select public.is_moderator_or_admin()),
      false
    )
    else (select public.is_moderator_or_admin())
  end;
$$;

drop policy if exists "posts_select_published_public" on public.posts;
create policy "posts_select_published_public"
on public.posts
for select
to anon, authenticated
using (
  status = 'published'
  or author_id = auth.uid()
  or (select public.can_manage_circle(circle_id))
  or (select public.is_moderator_or_admin())
);

drop policy if exists "posts_update_self_or_staff" on public.posts;
create policy "posts_update_self_or_staff"
on public.posts
for update
to authenticated
using (
  author_id = auth.uid()
  or (select public.can_manage_circle(circle_id))
  or (select public.is_moderator_or_admin())
)
with check (
  (
    author_id = auth.uid()
    and status in ('pending', 'published', 'deleted')
  )
  or (select public.can_manage_circle(circle_id))
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
  or (select public.can_manage_post(post_id))
  or (select public.is_moderator_or_admin())
);

drop policy if exists "comments_update_self_or_staff" on public.comments;
create policy "comments_update_self_or_staff"
on public.comments
for update
to authenticated
using (
  author_id = auth.uid()
  or (select public.can_manage_post(post_id))
  or (select public.is_moderator_or_admin())
)
with check (
  (
    author_id = auth.uid()
    and status in ('published', 'deleted')
  )
  or (select public.can_manage_post(post_id))
  or (select public.is_moderator_or_admin())
);

drop policy if exists "reports_select_own_or_staff" on public.reports;
create policy "reports_select_own_or_staff"
on public.reports
for select
to authenticated
using (
  reporter_id = auth.uid()
  or (select public.can_manage_report_target(target_type, target_id))
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
        or (select public.can_manage_circle(p.circle_id))
        or (select public.is_moderator_or_admin())
      )
  )
);
