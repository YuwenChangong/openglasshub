-- Align forum post writes and view-count RPC access with active canonical
-- public-circle visibility. This forward migration depends on the previously
-- authored can_access_public_circle(uuid) predicate.

drop policy if exists "posts_insert_self" on public.posts;
create policy "posts_insert_self"
on public.posts
for insert
to authenticated
with check (
  author_id = auth.uid()
  and status in ('published', 'pending')
  and moderation_status in ('published', 'pending_review')
  and public.can_access_public_circle(circle_id)
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
    and moderation_status in ('published', 'pending_review')
    and public.can_access_public_circle(circle_id)
  )
  or (select public.is_moderator_or_admin())
);

drop policy if exists "posts_delete_self_or_staff" on public.posts;
create policy "posts_delete_self_or_staff"
on public.posts
for delete
to authenticated
using (
  status = 'published'
  and moderation_status = 'published'
  and public.can_access_public_circle(circle_id)
  and (
    author_id = auth.uid()
    or (select public.is_moderator_or_admin())
  )
);

create or replace function public.increment_post_view_count(p_post_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.posts as post_ref
  set view_count = coalesce(post_ref.view_count, 0) + 1
  where post_ref.id = p_post_id
    and post_ref.status = 'published'
    and post_ref.moderation_status = 'published'
    and public.can_access_public_circle(post_ref.circle_id);
$$;

grant execute on function public.increment_post_view_count(uuid) to anon, authenticated;
