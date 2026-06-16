-- Profile system smoke validation (SQL Editor friendly).
-- Run in a non-production environment first.
-- Purpose:
-- 1) verify required profile columns exist
-- 2) verify required storage policies exist
-- 3) verify a real auth user can own/update a profile row
-- 4) verify anon can read public profile data

begin;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from auth.users;
  if v_count < 1 then
    raise exception 'Profile smoke test requires at least 1 user in auth.users; found %', v_count;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 0) Schema checks
-- ---------------------------------------------------------------------
do $$
declare
  missing_columns text[];
begin
  select array_agg(required_col)
  into missing_columns
  from (
    values
      ('username'),
      ('display_name'),
      ('bio'),
      ('avatar_url'),
      ('banner_url')
  ) required(required_col)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'profiles'
      and c.column_name = required.required_col
  );

  if missing_columns is not null then
    raise exception 'Missing required profile columns: %', array_to_string(missing_columns, ', ');
  end if;
end $$;

do $$
declare
  missing_policies text[];
begin
  select array_agg(required_policy)
  into missing_policies
  from (
    values
      ('profile_avatar_objects_insert_self'),
      ('profile_avatar_objects_select_public'),
      ('profile_avatar_objects_update_self'),
      ('profile_avatar_objects_delete_self'),
      ('profile_banner_objects_insert_self'),
      ('profile_banner_objects_select_public'),
      ('profile_banner_objects_update_self'),
      ('profile_banner_objects_delete_self')
  ) required(required_policy)
  where not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = required.required_policy
  );

  if missing_policies is not null then
    raise exception 'Missing required profile storage policies: %', array_to_string(missing_policies, ', ');
  end if;
end $$;

select set_config(
  'app.profile_smoke_user_id',
  (
    select id::text
    from auth.users
    order by created_at, id
    limit 1
  ),
  true
);

-- ---------------------------------------------------------------------
-- 1) Prepare a rollback-safe profile fixture
-- ---------------------------------------------------------------------
insert into public.profiles (id, username, display_name, bio)
select
  current_setting('app.profile_smoke_user_id')::uuid,
  'profile_smoke_user',
  'Profile Smoke User',
  'Temporary profile smoke validation row.'
where not exists (
  select 1
  from public.profiles
  where id = current_setting('app.profile_smoke_user_id')::uuid
);

update public.profiles
set
  username = coalesce(username, 'profile_smoke_user'),
  display_name = coalesce(display_name, 'Profile Smoke User'),
  bio = coalesce(bio, 'Temporary profile smoke validation row.')
where id = current_setting('app.profile_smoke_user_id')::uuid;

-- ---------------------------------------------------------------------
-- 2) ANON can read public profile data
-- ---------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);

select id, username, display_name, avatar_url, banner_url, bio
from public.profiles
where id = current_setting('app.profile_smoke_user_id')::uuid;

-- ---------------------------------------------------------------------
-- 3) AUTHENTICATED self-update works for profile fields
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', current_setting('app.profile_smoke_user_id'), true);

update public.profiles
set
  display_name = 'Profile Smoke User Updated',
  bio = 'Updated during profile smoke validation.',
  username = 'profile_smoke_user'
where id = current_setting('app.profile_smoke_user_id')::uuid;

select id, username, display_name, bio
from public.profiles
where id = current_setting('app.profile_smoke_user_id')::uuid;

-- ---------------------------------------------------------------------
-- 4) Summary
-- ---------------------------------------------------------------------
reset role;
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'banner_url') as has_banner_url,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'profile_%') as profile_storage_policy_count,
  (select username from public.profiles where id = current_setting('app.profile_smoke_user_id')::uuid) as smoke_username;

rollback;
