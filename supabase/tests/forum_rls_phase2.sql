-- Forum Phase 2 RLS test script (SQL Editor friendly).
-- Run in a non-production environment first.
-- Uses fixed UUIDs for repeatable test setup.

begin;

-- ---------------------------------------------------------------------
-- 0) Setup test identities and fixtures
-- ---------------------------------------------------------------------
insert into public.profiles (id, username, display_name, role)
values
  ('00000000-0000-0000-0000-000000000101', 'rls_owner_u', 'RLS Owner', 'user'),
  ('00000000-0000-0000-0000-000000000102', 'rls_other_u', 'RLS Other', 'user'),
  ('00000000-0000-0000-0000-000000000103', 'rls_mod_u', 'RLS Moderator', 'moderator'),
  ('00000000-0000-0000-0000-000000000104', 'rls_admin_u', 'RLS Admin', 'admin')
on conflict (id) do update
set username = excluded.username,
    display_name = excluded.display_name,
    role = excluded.role;

insert into public.circles (slug, name, description, type)
values ('rls-test-circle', 'RLS Test Circle', 'Used for RLS validation', 'topic')
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    type = excluded.type;

with c as (
  select id as circle_id from public.circles where slug = 'rls-test-circle'
)
insert into public.posts (author_id, circle_id, type, title, body, status)
select
  '00000000-0000-0000-0000-000000000101',
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
  '00000000-0000-0000-0000-000000000101',
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
select id, '00000000-0000-0000-0000-000000000101', 'RLS published comment', 'published' from p
on conflict do nothing;

with p as (
  select id from public.posts where title = 'RLS test post published' order by created_at desc limit 1
)
insert into public.comments (post_id, author_id, body, status)
select id, '00000000-0000-0000-0000-000000000101', 'RLS hidden comment', 'hidden' from p
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
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);

update public.posts
set title = 'RLS owner update ok'
where title = 'RLS test post published';

with p as (
  select id from public.posts where title = 'RLS owner update ok' limit 1
)
insert into public.bookmarks (user_id, post_id)
select '00000000-0000-0000-0000-000000000101', id from p
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3) AUTHENTICATED other user tests
-- ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', true);

update public.posts
set title = 'RLS other should fail'
where title = 'RLS owner update ok';

-- ---------------------------------------------------------------------
-- 4) MODERATOR tests
-- ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', true);

update public.posts
set status = 'hidden'
where title = 'RLS owner update ok';

insert into public.moderation_actions (moderator_id, target_type, target_id, action, reason)
select
  '00000000-0000-0000-0000-000000000103',
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
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', true);

insert into public.reports (reporter_id, target_type, target_id, reason, status)
select
  '00000000-0000-0000-0000-000000000101',
  'post',
  p.id,
  'RLS report test',
  'open'
from public.posts p
where p.title = 'RLS test post hidden'
limit 1;

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
