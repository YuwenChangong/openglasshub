-- OpenGlass Hub Forum Phase 1 schema (Supabase Postgres)
-- Scope: MVP forum data model + baseline RLS policies.

create extension if not exists pgcrypto;

-- Enums
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('user', 'moderator', 'admin');
  end if;
  if not exists (select 1 from pg_type where typname = 'circle_type') then
    create type public.circle_type as enum ('device', 'topic', 'project');
  end if;
  if not exists (select 1 from pg_type where typname = 'post_type') then
    create type public.post_type as enum ('experience', 'question', 'review', 'dev', 'news', 'feedback');
  end if;
  if not exists (select 1 from pg_type where typname = 'post_status') then
    create type public.post_status as enum ('pending', 'published', 'hidden', 'deleted');
  end if;
  if not exists (select 1 from pg_type where typname = 'comment_status') then
    create type public.comment_status as enum ('published', 'hidden', 'deleted');
  end if;
  if not exists (select 1 from pg_type where typname = 'report_status') then
    create type public.report_status as enum ('open', 'reviewed', 'dismissed');
  end if;
  if not exists (select 1 from pg_type where typname = 'report_target_type') then
    create type public.report_target_type as enum ('post', 'comment');
  end if;
  if not exists (select 1 from pg_type where typname = 'moderation_target_type') then
    create type public.moderation_target_type as enum ('post', 'comment', 'profile');
  end if;
end $$;

-- Common trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Core tables
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  role public.user_role not null default 'user',
  trust_level integer not null default 0 check (trust_level >= 0 and trust_level <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (username is null or username ~ '^[a-zA-Z0-9_]{3,30}$')
);

create unique index if not exists profiles_username_unique_ci
  on public.profiles (lower(username))
  where username is not null;

-- Role helper for RLS checks.
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid();
$$;

create or replace function public.is_moderator_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select public.current_user_role() in ('moderator', 'admin')),
    false
  );
$$;

create table if not exists public.circles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  type public.circle_type not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  circle_id uuid not null references public.circles(id) on delete restrict,
  type public.post_type not null,
  title text not null check (char_length(title) between 3 and 180),
  body text not null check (char_length(body) between 10 and 20000),
  status public.post_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  status public.comment_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type public.report_target_type not null,
  target_id uuid not null,
  reason text not null check (char_length(reason) between 5 and 1000),
  status public.report_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid not null references public.profiles(id) on delete restrict,
  target_type public.moderation_target_type not null,
  target_id uuid not null,
  action text not null check (char_length(action) between 3 and 60),
  reason text not null check (char_length(reason) between 5 and 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.post_votes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, post_id)
);

-- Indexes
create index if not exists circles_type_idx on public.circles(type);
create index if not exists posts_circle_status_activity_idx on public.posts(circle_id, status, last_activity_at desc);
create index if not exists posts_author_idx on public.posts(author_id);
create index if not exists posts_status_created_idx on public.posts(status, created_at desc);
create index if not exists comments_post_status_created_idx on public.comments(post_id, status, created_at asc);
create index if not exists comments_author_idx on public.comments(author_id);
create index if not exists reports_status_created_idx on public.reports(status, created_at asc);
create index if not exists reports_target_idx on public.reports(target_type, target_id);
create index if not exists moderation_actions_target_created_idx on public.moderation_actions(target_type, target_id, created_at desc);
create index if not exists moderation_actions_moderator_created_idx on public.moderation_actions(moderator_id, created_at desc);
create index if not exists post_votes_post_idx on public.post_votes(post_id);
create index if not exists post_votes_user_idx on public.post_votes(user_id);
create index if not exists bookmarks_user_created_idx on public.bookmarks(user_id, created_at desc);

-- Sync profile row on auth signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Keep updated_at fresh
drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_circles_set_updated_at on public.circles;
create trigger trg_circles_set_updated_at
before update on public.circles
for each row execute function public.set_updated_at();

drop trigger if exists trg_posts_set_updated_at on public.posts;
create trigger trg_posts_set_updated_at
before update on public.posts
for each row execute function public.set_updated_at();

drop trigger if exists trg_comments_set_updated_at on public.comments;
create trigger trg_comments_set_updated_at
before update on public.comments
for each row execute function public.set_updated_at();

drop trigger if exists trg_reports_set_updated_at on public.reports;
create trigger trg_reports_set_updated_at
before update on public.reports
for each row execute function public.set_updated_at();

drop trigger if exists trg_post_votes_set_updated_at on public.post_votes;
create trigger trg_post_votes_set_updated_at
before update on public.post_votes
for each row execute function public.set_updated_at();

-- Keep post last activity synced to comment activity.
create or replace function public.bump_post_last_activity()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT' and new.status = 'published')
     or (tg_op = 'UPDATE' and new.status = 'published' and old.status is distinct from new.status) then
    update public.posts
      set last_activity_at = now()
    where id = new.post_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_comments_bump_post_last_activity on public.comments;
create trigger trg_comments_bump_post_last_activity
after insert or update on public.comments
for each row execute function public.bump_post_last_activity();

-- Validate polymorphic targets for reports and moderation actions.
create or replace function public.validate_report_target()
returns trigger
language plpgsql
as $$
begin
  if new.target_type = 'post' and not exists (select 1 from public.posts p where p.id = new.target_id) then
    raise exception 'report target post % not found', new.target_id;
  elsif new.target_type = 'comment' and not exists (select 1 from public.comments c where c.id = new.target_id) then
    raise exception 'report target comment % not found', new.target_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reports_validate_target on public.reports;
create trigger trg_reports_validate_target
before insert or update on public.reports
for each row execute function public.validate_report_target();

create or replace function public.validate_moderation_target()
returns trigger
language plpgsql
as $$
begin
  if new.target_type = 'post' and not exists (select 1 from public.posts p where p.id = new.target_id) then
    raise exception 'moderation target post % not found', new.target_id;
  elsif new.target_type = 'comment' and not exists (select 1 from public.comments c where c.id = new.target_id) then
    raise exception 'moderation target comment % not found', new.target_id;
  elsif new.target_type = 'profile' and not exists (select 1 from public.profiles pr where pr.id = new.target_id) then
    raise exception 'moderation target profile % not found', new.target_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_moderation_actions_validate_target on public.moderation_actions;
create trigger trg_moderation_actions_validate_target
before insert or update on public.moderation_actions
for each row execute function public.validate_moderation_target();

-- RLS
alter table public.profiles enable row level security;
alter table public.circles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.post_votes enable row level security;
alter table public.bookmarks enable row level security;

-- profiles
drop policy if exists "profiles_select_public" on public.profiles;
create policy "profiles_select_public"
on public.profiles
for select
to anon, authenticated
using (true);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "profiles_update_self_or_staff" on public.profiles;
create policy "profiles_update_self_or_staff"
on public.profiles
for update
to authenticated
using (id = auth.uid() or (select public.is_moderator_or_admin()))
with check (id = auth.uid() or (select public.is_moderator_or_admin()));

-- circles
drop policy if exists "circles_select_public" on public.circles;
create policy "circles_select_public"
on public.circles
for select
to anon, authenticated
using (true);

drop policy if exists "circles_manage_staff" on public.circles;
create policy "circles_manage_staff"
on public.circles
for all
to authenticated
using ((select public.is_moderator_or_admin()))
with check ((select public.is_moderator_or_admin()));

-- posts
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

drop policy if exists "posts_insert_self" on public.posts;
create policy "posts_insert_self"
on public.posts
for insert
to authenticated
with check (
  author_id = auth.uid()
  and (
    status = 'pending'
    or (select public.is_moderator_or_admin())
  )
);

drop policy if exists "posts_update_self_or_staff" on public.posts;
create policy "posts_update_self_or_staff"
on public.posts
for update
to authenticated
using (author_id = auth.uid() or (select public.is_moderator_or_admin()))
with check (
  (
    author_id = auth.uid()
    and status in ('pending', 'published')
  )
  or (select public.is_moderator_or_admin())
);

drop policy if exists "posts_delete_self_or_staff" on public.posts;
create policy "posts_delete_self_or_staff"
on public.posts
for delete
to authenticated
using (author_id = auth.uid() or (select public.is_moderator_or_admin()));

-- comments
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

drop policy if exists "comments_insert_self" on public.comments;
create policy "comments_insert_self"
on public.comments
for insert
to authenticated
with check (
  author_id = auth.uid()
  and (
    status = 'published'
    or (select public.is_moderator_or_admin())
  )
);

drop policy if exists "comments_update_self_or_staff" on public.comments;
create policy "comments_update_self_or_staff"
on public.comments
for update
to authenticated
using (author_id = auth.uid() or (select public.is_moderator_or_admin()))
with check (
  (
    author_id = auth.uid()
    and status in ('published', 'hidden')
  )
  or (select public.is_moderator_or_admin())
);

drop policy if exists "comments_delete_self_or_staff" on public.comments;
create policy "comments_delete_self_or_staff"
on public.comments
for delete
to authenticated
using (author_id = auth.uid() or (select public.is_moderator_or_admin()));

-- reports
drop policy if exists "reports_insert_self" on public.reports;
create policy "reports_insert_self"
on public.reports
for insert
to authenticated
with check (reporter_id = auth.uid());

drop policy if exists "reports_select_own_or_staff" on public.reports;
create policy "reports_select_own_or_staff"
on public.reports
for select
to authenticated
using (reporter_id = auth.uid() or (select public.is_moderator_or_admin()));

drop policy if exists "reports_update_staff" on public.reports;
create policy "reports_update_staff"
on public.reports
for update
to authenticated
using ((select public.is_moderator_or_admin()))
with check ((select public.is_moderator_or_admin()));

-- moderation_actions
drop policy if exists "moderation_actions_read_staff" on public.moderation_actions;
create policy "moderation_actions_read_staff"
on public.moderation_actions
for select
to authenticated
using ((select public.is_moderator_or_admin()));

drop policy if exists "moderation_actions_write_staff" on public.moderation_actions;
create policy "moderation_actions_write_staff"
on public.moderation_actions
for insert
to authenticated
with check (
  moderator_id = auth.uid()
  and (select public.is_moderator_or_admin())
);

-- post_votes
drop policy if exists "post_votes_select_public" on public.post_votes;
create policy "post_votes_select_public"
on public.post_votes
for select
to anon, authenticated
using (true);

drop policy if exists "post_votes_manage_self" on public.post_votes;
create policy "post_votes_manage_self"
on public.post_votes
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- bookmarks
drop policy if exists "bookmarks_select_self" on public.bookmarks;
create policy "bookmarks_select_self"
on public.bookmarks
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "bookmarks_manage_self" on public.bookmarks;
create policy "bookmarks_manage_self"
on public.bookmarks
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
