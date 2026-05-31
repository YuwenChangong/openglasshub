-- Phase 6: upload guardrails for forum media

create table if not exists public.forum_upload_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  ip_hash text not null,
  bytes bigint not null default 0 check (bytes >= 0),
  purpose text not null check (purpose in ('post_media_upload', 'external_video_upload')),
  created_at timestamptz not null default now()
);

create index if not exists forum_upload_attempts_created_at_idx
  on public.forum_upload_attempts (created_at desc);

create index if not exists forum_upload_attempts_ip_hash_idx
  on public.forum_upload_attempts (ip_hash, created_at desc);

create index if not exists forum_upload_attempts_user_id_idx
  on public.forum_upload_attempts (user_id, created_at desc);

alter table public.forum_upload_attempts enable row level security;

drop policy if exists "forum_upload_attempts_insert_authenticated" on public.forum_upload_attempts;
create policy "forum_upload_attempts_insert_authenticated"
  on public.forum_upload_attempts
  for insert
  to authenticated
  with check (user_id = auth.uid() or user_id is null);

drop policy if exists "forum_upload_attempts_select_authenticated" on public.forum_upload_attempts;
create policy "forum_upload_attempts_select_authenticated"
  on public.forum_upload_attempts
  for select
  to authenticated
  using (true);

-- Enforce one video max per post at DB level.
create unique index if not exists post_media_one_video_per_post_idx
  on public.post_media (post_id)
  where kind = 'video';

