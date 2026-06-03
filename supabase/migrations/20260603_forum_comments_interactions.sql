-- OpenGlass Hub Forum -- Comment interactions MVP
-- Adds parent_id (threaded replies), comment_reactions (likes), and RLS policies.

-- 1. Add parent_id to comments for threaded replies
alter table public.comments
add column if not exists parent_id uuid references public.comments(id) on delete cascade;

create index if not exists comments_parent_id_idx on public.comments(parent_id);

-- 2. Comment reactions (likes)
create table if not exists public.comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction_type text not null default 'like',
  created_at timestamptz not null default now(),
  unique(comment_id, user_id, reaction_type)
);

create index if not exists comment_reactions_comment_id_idx on public.comment_reactions(comment_id);

-- 3. RLS for comment_reactions
alter table public.comment_reactions enable row level security;

drop policy if exists "comment_reactions_select_public" on public.comment_reactions;
create policy "comment_reactions_select_public"
on public.comment_reactions
for select
to anon, authenticated
using (
  exists (
    select 1 from public.comments c
    where c.id = comment_reactions.comment_id
      and c.status = 'published'
  )
);

drop policy if exists "comment_reactions_insert_self" on public.comment_reactions;
create policy "comment_reactions_insert_self"
on public.comment_reactions
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.comments c
    where c.id = comment_reactions.comment_id
      and c.status = 'published'
  )
);

drop policy if exists "comment_reactions_delete_self" on public.comment_reactions;
create policy "comment_reactions_delete_self"
on public.comment_reactions
for delete
to authenticated
using (user_id = auth.uid());

-- 4. Allow authors to soft-delete own comments (status = 'deleted')
drop policy if exists "comments_update_self_or_staff" on public.comments;
create policy "comments_update_self_or_staff"
on public.comments
for update
to authenticated
using (author_id = auth.uid() or (select public.is_moderator_or_admin()))
with check (
  (author_id = auth.uid() and status in ('published', 'deleted'))
  or (select public.is_moderator_or_admin())
);
