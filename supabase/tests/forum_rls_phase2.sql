-- Forum Phase 2 RLS test script (SQL Editor friendly).
-- Run in a non-production environment first.
-- This version derives test identities from existing auth.users rows.

begin;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from auth.users;
  if v_count < 4 then
    raise exception 'RLS test requires at least 4 users in auth.users; found %', v_count;
  end if;
end $$;

select set_config(
  'app.rls_owner_id',
  (
    select id::text
    from auth.users
    order by created_at, id
    offset 0 limit 1
  ),
  true
);
select set_config(
  'app.rls_other_id',
  (
    select id::text
    from auth.users
    order by created_at, id
    offset 1 limit 1
  ),
  true
);
select set_config(
  'app.rls_mod_id',
  (
    select id::text
    from auth.users
    order by created_at, id
    offset 2 limit 1
  ),
  true
);
select set_config(
  'app.rls_admin_id',
  (
    select id::text
    from auth.users
    order by created_at, id
    offset 3 limit 1
  ),
  true
);

-- ---------------------------------------------------------------------
-- 0) Setup test identities and fixtures
-- ---------------------------------------------------------------------
insert into public.profiles (id, username, display_name, role)
select
  u.id,
  m.username,
  m.display_name,
  m.role
from auth.users u
join (
  values
    (1, 'rls_owner_u', 'RLS Owner', 'user'::public.user_role),
    (2, 'rls_other_u', 'RLS Other', 'user'::public.user_role),
    (3, 'rls_mod_u', 'RLS Moderator', 'moderator'::public.user_role),
    (4, 'rls_admin_u', 'RLS Admin', 'admin'::public.user_role)
) as m(rn, username, display_name, role)
  on true
where u.id in (
  current_setting('app.rls_owner_id')::uuid,
  current_setting('app.rls_other_id')::uuid,
  current_setting('app.rls_mod_id')::uuid,
  current_setting('app.rls_admin_id')::uuid
)
and (
  (m.rn = 1 and u.id = current_setting('app.rls_owner_id')::uuid)
  or (m.rn = 2 and u.id = current_setting('app.rls_other_id')::uuid)
  or (m.rn = 3 and u.id = current_setting('app.rls_mod_id')::uuid)
  or (m.rn = 4 and u.id = current_setting('app.rls_admin_id')::uuid)
)
on conflict (id) do update
set username = excluded.username,
    display_name = excluded.display_name,
    role = excluded.role;

update public.circles
set
  name = 'RLS Test Circle',
  description = 'Used for RLS validation',
  type = 'topic'
where slug = 'rls-test-circle';

insert into public.circles (slug, name, description, type)
select
  'rls-test-circle',
  'RLS Test Circle',
  'Used for RLS validation',
  'topic'
where not exists (
  select 1 from public.circles where slug = 'rls-test-circle'
);

with c as (
  select id as circle_id from public.circles where slug = 'rls-test-circle'
)
insert into public.posts (author_id, circle_id, type, title, body, status)
select
  current_setting('app.rls_owner_id')::uuid,
  c.circle_id,
  'question',
  'RLS test post published',
  'Post body for published visibility test.',
  'published'
from c
on conflict do nothing;

with c as (
  select id as circle_id from public.circles where slug = 'rls-test-circle'
)
insert into public.posts (author_id, circle_id, type, title, body, status)
select
  current_setting('app.rls_owner_id')::uuid,
  c.circle_id,
  'question',
  'RLS test post hidden',
  'Post body for hidden visibility test.',
  'hidden'
from c
on conflict do nothing;

with p as (
  select id from public.posts where title = 'RLS test post published' order by created_at desc limit 1
)
insert into public.comments (post_id, author_id, body, status)
select id, current_setting('app.rls_owner_id')::uuid, 'RLS published comment', 'published' from p
on conflict do nothing;

with p as (
  select id from public.posts where title = 'RLS test post published' order by created_at desc limit 1
)
insert into public.comments (post_id, author_id, body, status)
select id, current_setting('app.rls_owner_id')::uuid, 'RLS hidden comment', 'hidden' from p
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 1) ANON tests (published-only visibility)
-- ---------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);

select id, status
from public.posts
where title in ('RLS test post published', 'RLS test post hidden')
order by title;

-- ---------------------------------------------------------------------
-- 2) AUTHENTICATED owner tests
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', current_setting('app.rls_owner_id'), true);

update public.posts
set title = 'RLS owner update ok'
where title = 'RLS test post published';

with p as (
  select id from public.posts where title = 'RLS owner update ok' limit 1
)
insert into public.bookmarks (user_id, post_id)
select current_setting('app.rls_owner_id')::uuid, id from p
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3) AUTHENTICATED other user tests
-- ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('app.rls_other_id'), true);

update public.posts
set title = 'RLS other should fail'
where title = 'RLS owner update ok';

-- ---------------------------------------------------------------------
-- 4) MODERATOR tests
-- ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('app.rls_mod_id'), true);

update public.posts
set status = 'hidden'
where title = 'RLS owner update ok';

insert into public.moderation_actions (moderator_id, target_type, target_id, action, reason)
select
  current_setting('app.rls_mod_id')::uuid,
  'post',
  p.id,
  'hide',
  'RLS moderation test'
from public.posts p
where p.title = 'RLS owner update ok'
limit 1;

-- ---------------------------------------------------------------------
-- 5) ADMIN tests
-- ---------------------------------------------------------------------
-- report insert must be done by reporter (policy: reporter_id = auth.uid()).
select set_config('request.jwt.claim.sub', current_setting('app.rls_owner_id'), true);

insert into public.reports (reporter_id, target_type, target_id, reason, status)
select
  current_setting('app.rls_owner_id')::uuid,
  'post',
  p.id,
  'RLS report test',
  'open'
from public.posts p
where p.title = 'RLS test post hidden'
limit 1;

-- admin reviews report.
select set_config('request.jwt.claim.sub', current_setting('app.rls_admin_id'), true);

update public.reports
set status = 'reviewed'
where reason = 'RLS report test';

-- ---------------------------------------------------------------------
-- 6) Summary (for manual inspection)
-- ---------------------------------------------------------------------
reset role;
select
  (select count(*) from public.posts where title like 'RLS%') as test_posts,
  (select count(*) from public.comments where body like 'RLS%comment%') as test_comments,
  (select count(*) from public.moderation_actions where reason = 'RLS moderation test') as test_mod_actions,
  (select count(*) from public.reports where reason = 'RLS report test') as test_reports;

rollback;
