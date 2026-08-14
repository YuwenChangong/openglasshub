#!/usr/bin/env bash
set -euo pipefail

migration='supabase/migrations/20260814_admin_circle_lifecycle_and_safe_purge.sql'
expected_sha='161cf82b572bc4c3c8f49c8d20d7d0aae9206cfedb7cb3188ac5fcb42e3ec66d'

[[ "${PGHOST:-}" == '127.0.0.1' || "${PGHOST:-}" == 'localhost' ]] || {
  echo 'FAIL DISPOSABLE_DATABASE_HOST_GUARD'
  exit 1
}
[[ -f "$migration" ]] || { echo 'FAIL MIGRATION_MISSING'; exit 1; }
[[ "$(sha256sum "$migration" | awk '{print $1}')" == "$expected_sha" ]] || {
  echo 'FAIL MIGRATION_SHA256_MISMATCH'
  exit 1
}

psqlq() {
  psql -X -v ON_ERROR_STOP=1 -qAt -c "$1"
}

reset_fixture() {
  psql -X -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
drop schema if exists public cascade;
create schema public;
grant all on schema public to postgres;
create table public.circles (
  id uuid primary key,
  name text not null,
  status text not null default 'active'::text,
  image_path text,
  constraint circles_status_check check (status = any (array['active'::text, 'deleted'::text]))
);
create table public.posts (
  id uuid primary key,
  circle_id uuid not null references public.circles(id) on delete restrict
);
create table public.reports (
  id uuid primary key,
  target_type text not null,
  target_id uuid not null
);
create table public.forum_notifications (
  id uuid primary key,
  circle_id uuid not null references public.circles(id) on delete cascade
);
SQL
}

apply_migration() {
  psql -X -v ON_ERROR_STOP=1 -1 -q -f "$migration" >/dev/null
}

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  [[ "$actual" == "$expected" ]] || { echo "FAIL $label"; exit 1; }
  echo "PASS $label"
}

assert_fails_atomically() {
  local label="$1"
  set +e
  psql -X -v ON_ERROR_STOP=1 -1 -q -f "$migration" >/dev/null 2>&1
  local rc=$?
  set -e
  [[ $rc -ne 0 ]] || { echo "FAIL $label"; exit 1; }
  assert_eq "${label}_NO_FUNCTIONS" '0' "$(psqlq "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('admin_circle_purge_preview_v1', 'admin_purge_circle_v1')")"
  assert_eq "${label}_NO_HIDDEN_STATUS" '0' "$(psqlq "select count(*) from pg_constraint where conrelid = 'public.circles'::regclass and conname = 'circles_status_check' and pg_get_expr(conbin, conrelid) ilike '%hidden%'")"
  echo "PASS $label"
}

reset_fixture
apply_migration
echo 'PASS MIGRATION_APPLY'

psqlq "insert into public.circles(id,name,status) values ('00000000-0000-4000-8000-000000000001','active','active'), ('00000000-0000-4000-8000-000000000002','hidden','hidden'), ('00000000-0000-4000-8000-000000000003','deleted','deleted')" >/dev/null
assert_eq STATUS_ACTIVE PASS "$(psqlq "select case when exists (select 1 from public.circles where status='active') then 'PASS' else 'FAIL' end")"
assert_eq STATUS_HIDDEN PASS "$(psqlq "select case when exists (select 1 from public.circles where status='hidden') then 'PASS' else 'FAIL' end")"
assert_eq STATUS_DELETED PASS "$(psqlq "select case when exists (select 1 from public.circles where status='deleted') then 'PASS' else 'FAIL' end")"
set +e
psqlq "insert into public.circles(id,name,status) values ('00000000-0000-4000-8000-000000000004','bad','archived')" >/dev/null 2>&1
invalid_rc=$?
set -e
[[ $invalid_rc -ne 0 ]] || { echo 'FAIL STATUS_INVALID_REJECTED'; exit 1; }
echo 'PASS STATUS_INVALID_REJECTED'
psqlq "insert into public.circles(id,name) values ('00000000-0000-4000-8000-000000000005','default')" >/dev/null
assert_eq STATUS_DEFAULT_ACTIVE active "$(psqlq "select status from public.circles where id='00000000-0000-4000-8000-000000000005'")"

for fn in admin_circle_purge_preview_v1 admin_purge_circle_v1; do
  assert_eq "${fn}_EXISTS" 1 "$(psqlq "select count(*) from pg_proc where oid = ('public.${fn}(uuid)'::regprocedure)")"
  assert_eq RPC_OWNER_POSTGRES postgres "$(psqlq "select pg_get_userbyid(proowner) from pg_proc where oid='public.${fn}(uuid)'::regprocedure")"
  assert_eq SECURITY_DEFINER_HARDENING true "$(psqlq "select prosecdef from pg_proc where oid='public.${fn}(uuid)'::regprocedure")"
  assert_eq SEARCH_PATH_EMPTY 'search_path=""' "$(psqlq "select array_to_string(proconfig, ',') from pg_proc where oid='public.${fn}(uuid)'::regprocedure")"
  assert_eq PUBLIC_EXECUTE false "$(psqlq "select has_function_privilege('public','public.${fn}(uuid)'::regprocedure,'execute')")"
  assert_eq ANON_EXECUTE false "$(psqlq "select has_function_privilege('anon','public.${fn}(uuid)'::regprocedure,'execute')")"
  assert_eq AUTHENTICATED_EXECUTE false "$(psqlq "select has_function_privilege('authenticated','public.${fn}(uuid)'::regprocedure,'execute')")"
  assert_eq SERVICE_ROLE_EXECUTE true "$(psqlq "select has_function_privilege('service_role','public.${fn}(uuid)'::regprocedure,'execute')")"
done
for table in circles posts reports forum_notifications; do
  for privilege in select insert update delete; do
    assert_eq SERVICE_ROLE_TABLE_GRANTS_BROADENED false "$(psqlq "select has_table_privilege('service_role','public.${table}','${privilege}')")"
  done
done

reset_fixture
psqlq 'alter table public.circles drop constraint circles_status_check' >/dev/null
assert_fails_atomically MISSING_CONSTRAINT
reset_fixture
psqlq "alter table public.circles drop constraint circles_status_check; alter table public.circles add constraint circles_status_check check (status = any (array['active'::text, 'deleted'::text, 'archived'::text]))" >/dev/null
assert_fails_atomically WRONG_CONSTRAINT
reset_fixture
psqlq 'alter table public.circles alter column status type varchar using status::varchar' >/dev/null
assert_fails_atomically WRONG_STATUS_TYPE
reset_fixture
psqlq "alter table public.circles alter column status set default 'deleted'::text" >/dev/null
assert_fails_atomically WRONG_STATUS_DEFAULT
reset_fixture
psqlq "create function public.admin_circle_purge_preview_v1(uuid) returns boolean language sql as 'select true'" >/dev/null
assert_fails_atomically PREEXISTING_PREVIEW_RPC
reset_fixture
psqlq "create function public.admin_purge_circle_v1(uuid) returns boolean language sql as 'select true'" >/dev/null
assert_fails_atomically PREEXISTING_PURGE_RPC
echo 'PASS UNEXPECTED_SCHEMA_FAIL_CLOSED'
echo 'PASS RPC_PREEXISTENCE_FAIL_CLOSED'
echo 'PASS MIGRATION_ATOMICITY'

reset_fixture
apply_migration
psqlq "insert into public.circles(id,name,status) values ('10000000-0000-4000-8000-000000000001','active','active'),('10000000-0000-4000-8000-000000000002','hidden','hidden'),('10000000-0000-4000-8000-000000000003','post','deleted'),('10000000-0000-4000-8000-000000000004','report','deleted'),('10000000-0000-4000-8000-000000000005','free','deleted')" >/dev/null
psqlq "insert into public.posts values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'); insert into public.reports values ('30000000-0000-4000-8000-000000000001','circle','10000000-0000-4000-8000-000000000004'); insert into public.forum_notifications values ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005')" >/dev/null
assert_eq PURGE_PREVIEW_READ_ONLY CIRCLE_NOT_FOUND "$(psqlq "select reason_code from public.admin_circle_purge_preview_v1('10000000-0000-4000-8000-000000000099')")"
assert_eq PURGE_PREVIEW_READ_ONLY CIRCLE_NOT_DELETED "$(psqlq "select reason_code from public.admin_circle_purge_preview_v1('10000000-0000-4000-8000-000000000001')")"
assert_eq PURGE_POST_BLOCK CIRCLE_HAS_POSTS "$(psqlq "select reason_code from public.admin_purge_circle_v1('10000000-0000-4000-8000-000000000003')")"
assert_eq PURGE_REPORT_BLOCK CIRCLE_HAS_REPORTS "$(psqlq "select reason_code from public.admin_purge_circle_v1('10000000-0000-4000-8000-000000000004')")"
assert_eq PURGE_DEPENDENCY_FREE PURGED "$(psqlq "select reason_code from public.admin_purge_circle_v1('10000000-0000-4000-8000-000000000005')")"
assert_eq NOTIFICATION_CASCADE 0 "$(psqlq "select count(*) from public.forum_notifications where circle_id='10000000-0000-4000-8000-000000000005'")"
assert_eq POSTS_NOT_DELETED 1 "$(psqlq 'select count(*) from public.posts')"
assert_eq REPORTS_NOT_DELETED 1 "$(psqlq 'select count(*) from public.reports')"

# A test-only delete trigger holds transaction A after the function obtains the reports SHARE lock.
psqlq "insert into public.circles(id,name,status) values ('50000000-0000-4000-8000-000000000001','race','deleted'); create function public.test_pause_before_circle_delete() returns trigger language plpgsql as \$\$begin perform pg_sleep(3); return old; end\$\$; create trigger test_pause_before_circle_delete before delete on public.circles for each row execute function public.test_pause_before_circle_delete();" >/dev/null
psql -X -v ON_ERROR_STOP=1 -qAt -c "begin; select * from public.admin_purge_circle_v1('50000000-0000-4000-8000-000000000001'); commit;" >/tmp/circle-purge-a.out 2>/tmp/circle-purge-a.err &
a_pid=$!
sleep 0.5
set +e
timeout 1 psql -X -v ON_ERROR_STOP=1 -qAt -c "insert into public.reports values ('60000000-0000-4000-8000-000000000001','circle','50000000-0000-4000-8000-000000000001')" >/tmp/circle-report-b.out 2>/tmp/circle-report-b.err
b_rc=$?
set -e
wait "$a_pid"
[[ $b_rc -eq 124 ]] || { echo 'FAIL REPORT_CONCURRENT_INSERT_GUARD_NOT_BLOCKED'; exit 1; }
echo 'PASS REPORT_CONCURRENT_INSERT_BLOCKED_DURING_PURGE'

# The report table intentionally has no FK. A raw report insert released after the purge lock can become an orphan.
set +e
psqlq "insert into public.reports values ('60000000-0000-4000-8000-000000000002','circle','50000000-0000-4000-8000-000000000001')" >/dev/null 2>&1
post_purge_report_rc=$?
set -e
if [[ $post_purge_report_rc -eq 0 ]]; then
  echo 'FAIL REPORT_CONCURRENT_INSERT_GUARD_ORPHAN_ACCEPTED'
  exit 1
fi
echo 'PASS REPORT_CONCURRENT_INSERT_GUARD'
