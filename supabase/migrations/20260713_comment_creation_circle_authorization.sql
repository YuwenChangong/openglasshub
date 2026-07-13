-- New comments must follow the same public post-to-circle visibility chain as
-- forum reads. The current schema has no private-circle or membership table;
-- if private circles are introduced, extend this predicate before allowing
-- comments in them.
create or replace function public.can_create_comment_target(
  target_post_id uuid,
  target_parent_comment_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.posts as p
    join public.circles as circle_ref on circle_ref.id = p.circle_id
    where p.id = target_post_id
      and p.status = 'published'
      and p.moderation_status = 'published'
      and circle_ref.status = 'active'
      and lower(coalesce(circle_ref.slug, '')) not in ('rls-test-circle', 'rls-test', 'test-circle')
      and lower(coalesce(circle_ref.name, '')) not like '%rls test%'
      and (
        target_parent_comment_id is null
        or exists (
          select 1
          from public.comments as parent_comment
          where parent_comment.id = target_parent_comment_id
            and parent_comment.post_id = p.id
            and parent_comment.status = 'published'
            and parent_comment.moderation_status = 'published'
        )
      )
  );
$$;

revoke all on function public.can_create_comment_target(uuid, uuid) from public;
grant execute on function public.can_create_comment_target(uuid, uuid) to authenticated;

drop policy if exists "comments_insert_self" on public.comments;
create policy "comments_insert_self"
on public.comments
for insert
to authenticated
with check (
  author_id = auth.uid()
  and (
    (status::text = 'published' and moderation_status = 'published')
    or (status::text = 'pending' and moderation_status = 'pending_review')
  )
  and public.can_create_comment_target(post_id, parent_id)
);

-- SELECT, UPDATE, and DELETE policies were reviewed but remain outside this
-- creation-only remediation. Their visibility and lifecycle semantics require
-- separate audit before they are changed.
