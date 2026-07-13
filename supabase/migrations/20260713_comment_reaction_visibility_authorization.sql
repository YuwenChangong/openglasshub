-- Comment reactions follow the public visibility chain used by forum reads:
-- a published comment, a published post, and an active visible circle. The
-- current schema has no private-circle membership relation; adding one must
-- extend this predicate before reactions are supported in private circles.
create or replace function public.can_access_comment_reaction_target(target_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.comments as c
    join public.posts as p on p.id = c.post_id
    join public.circles as circle_ref on circle_ref.id = p.circle_id
    where c.id = target_comment_id
      and c.status = 'published'
      and c.moderation_status = 'published'
      and p.status = 'published'
      and p.moderation_status = 'published'
      and circle_ref.status = 'active'
      and lower(coalesce(circle_ref.slug, '')) not in ('rls-test-circle', 'rls-test', 'test-circle')
      and lower(coalesce(circle_ref.name, '')) not like '%rls test%'
  );
$$;

revoke all on function public.can_access_comment_reaction_target(uuid) from public;
grant execute on function public.can_access_comment_reaction_target(uuid) to anon, authenticated;

drop policy if exists "comment_reactions_select_public" on public.comment_reactions;
drop policy if exists "comment_reactions_select_accessible" on public.comment_reactions;
drop policy if exists "comment_reactions_insert_self" on public.comment_reactions;
drop policy if exists "comment_reactions_update_self" on public.comment_reactions;
drop policy if exists "comment_reactions_delete_self" on public.comment_reactions;

create policy "comment_reactions_select_accessible"
on public.comment_reactions
for select
to anon, authenticated
using (public.can_access_comment_reaction_target(comment_id));

create policy "comment_reactions_insert_self"
on public.comment_reactions
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.can_access_comment_reaction_target(comment_id)
);

create policy "comment_reactions_update_self"
on public.comment_reactions
for update
to authenticated
using (
  user_id = auth.uid()
  and public.can_access_comment_reaction_target(comment_id)
)
with check (
  user_id = auth.uid()
  and public.can_access_comment_reaction_target(comment_id)
);

create policy "comment_reactions_delete_self"
on public.comment_reactions
for delete
to authenticated
using (
  user_id = auth.uid()
  and public.can_access_comment_reaction_target(comment_id)
);
