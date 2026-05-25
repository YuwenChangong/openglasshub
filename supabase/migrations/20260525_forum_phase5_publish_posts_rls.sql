-- Forum Phase 5: align posts insert RLS with MVP published-by-default strategy.
-- Allows authenticated users to insert only their own posts with published or pending status.

drop policy if exists "posts_insert_self" on public.posts;

create policy "posts_insert_self"
on public.posts
for insert
to authenticated
with check (
  author_id = auth.uid()
  and status in ('published', 'pending')
);
