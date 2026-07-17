-- Public comment reads share one visibility invariant:
-- comment -> post -> circle ancestry must be published, active, and
-- canonically public. The schema has no private-circle membership relation.
create or replace function public.can_access_public_circle(target_circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.circles as circle_ref
    where circle_ref.id = target_circle_id
      and circle_ref.status = 'active'
      and lower(coalesce(circle_ref.slug, '')) not in ('rls-test-circle', 'rls-test', 'test-circle')
      and lower(coalesce(circle_ref.name, '')) not like '%rls test%'
  );
$$;

create or replace function public.can_access_public_comment_read_target(target_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.comments as comment_ref
    join public.posts as post_ref on post_ref.id = comment_ref.post_id
    join public.circles as circle_ref on circle_ref.id = post_ref.circle_id
    where comment_ref.id = target_comment_id
      and comment_ref.status = 'published'
      and comment_ref.moderation_status = 'published'
      and post_ref.status = 'published'
      and post_ref.moderation_status = 'published'
      and circle_ref.status = 'active'
      and lower(coalesce(circle_ref.slug, '')) not in ('rls-test-circle', 'rls-test', 'test-circle')
      and lower(coalesce(circle_ref.name, '')) not like '%rls test%'
  );
$$;

revoke all on function public.can_access_public_circle(uuid) from public;
revoke all on function public.can_access_public_comment_read_target(uuid) from public;
grant execute on function public.can_access_public_circle(uuid) to anon, authenticated;
grant execute on function public.can_access_public_comment_read_target(uuid) to anon, authenticated;

-- Preserve authenticated authors and staff access while requiring the complete
-- public circle predicate for the anon/authenticated public branch.
drop policy if exists "posts_select_published_public" on public.posts;
create policy "posts_select_published_public"
on public.posts
for select
to anon, authenticated
using (
  (
    status = 'published'
    and moderation_status = 'published'
    and public.can_access_public_circle(circle_id)
  )
  or author_id = auth.uid()
  or (select public.is_moderator_or_admin())
);

drop policy if exists "comments_select_public_or_staff" on public.comments;
create policy "comments_select_public_or_staff"
on public.comments
for select
to anon, authenticated
using (
  public.can_access_public_comment_read_target(id)
  or author_id = auth.uid()
  or exists (
    select 1 from public.posts as post_ref
    where post_ref.id = comments.post_id
      and post_ref.author_id = auth.uid()
  )
  or (select public.is_moderator_or_admin())
);

drop policy if exists "comment_reactions_select_public" on public.comment_reactions;
drop policy if exists "comment_reactions_select_accessible" on public.comment_reactions;
create policy "comment_reactions_select_accessible"
on public.comment_reactions
for select
to anon, authenticated
using (public.can_access_public_comment_read_target(comment_id));
