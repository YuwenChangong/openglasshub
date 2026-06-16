-- Community moderation MVP
-- Minimal schema + RLS delta for pending review flow.

do $$
begin
  if not exists (
    select 1
    from pg_enum
    where enumtypid = 'public.comment_status'::regtype
      and enumlabel = 'pending'
  ) then
    alter type public.comment_status add value 'pending';
  end if;
end $$;

alter table public.posts
  add column if not exists moderation_status text not null default 'published',
  add column if not exists moderation_reason text,
  add column if not exists moderation_score numeric,
  add column if not exists moderated_at timestamptz,
  add column if not exists moderated_by uuid references public.profiles(id) on delete set null,
  add column if not exists moderation_provider text;

alter table public.comments
  add column if not exists moderation_status text not null default 'published',
  add column if not exists moderation_reason text,
  add column if not exists moderation_score numeric,
  add column if not exists moderated_at timestamptz,
  add column if not exists moderated_by uuid references public.profiles(id) on delete set null,
  add column if not exists moderation_provider text;

update public.posts
set moderation_status = case
  when status::text = 'pending' then 'pending_review'
  when status::text = 'hidden' then 'hidden_by_admin'
  else 'published'
end
where moderation_status is distinct from case
  when status::text = 'pending' then 'pending_review'
  when status::text = 'hidden' then 'hidden_by_admin'
  else 'published'
end;

update public.comments
set moderation_status = case
  when status::text = 'pending' then 'pending_review'
  when status::text = 'hidden' then 'hidden_by_admin'
  else 'published'
end
where moderation_status is distinct from case
  when status::text = 'pending' then 'pending_review'
  when status::text = 'hidden' then 'hidden_by_admin'
  else 'published'
end;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'posts_moderation_status_check'
      and conrelid = 'public.posts'::regclass
  ) then
    alter table public.posts
      add constraint posts_moderation_status_check
      check (moderation_status in ('published', 'pending_review', 'rejected', 'hidden_by_admin'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'comments_moderation_status_check'
      and conrelid = 'public.comments'::regclass
  ) then
    alter table public.comments
      add constraint comments_moderation_status_check
      check (moderation_status in ('published', 'pending_review', 'rejected', 'hidden_by_admin'));
  end if;
end $$;

create index if not exists posts_moderation_status_idx on public.posts (moderation_status, created_at desc);
create index if not exists comments_moderation_status_idx on public.comments (moderation_status, created_at desc);

drop policy if exists "comments_insert_self" on public.comments;
create policy "comments_insert_self"
on public.comments
for insert
to authenticated
with check (
  author_id = auth.uid()
  and status::text in ('published', 'pending')
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
    and status::text in ('pending', 'published', 'deleted')
  )
  or (select public.is_moderator_or_admin())
);
