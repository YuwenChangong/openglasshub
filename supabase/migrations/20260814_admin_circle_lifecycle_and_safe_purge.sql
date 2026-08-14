do $$
declare
  status_type text;
  status_default text;
  matching_constraint_count integer;
  constraint_expression text;
begin
  if to_regclass('public.circles') is null then
    raise exception 'ADMIN_CIRCLE_LIFECYCLE_SCHEMA_PRECONDITION_FAILED';
  end if;

  select
    pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
    pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
  into status_type, status_default
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  join pg_catalog.pg_attribute attribute on attribute.attrelid = relation.oid
  left join pg_catalog.pg_attrdef default_value
    on default_value.adrelid = relation.oid
    and default_value.adnum = attribute.attnum
  where namespace.nspname = 'public'
    and relation.relname = 'circles'
    and relation.relkind in ('r', 'p')
    and attribute.attname = 'status'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if status_type is distinct from 'text'
     or regexp_replace(lower(coalesce(status_default, '')), '[[:space:]]+', '', 'g') <> '''active''::text' then
    raise exception 'ADMIN_CIRCLE_LIFECYCLE_SCHEMA_PRECONDITION_FAILED';
  end if;

  select count(*)
  into matching_constraint_count
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'circles'
    and constraint_row.conname = 'circles_status_check';

  if matching_constraint_count <> 1 then
    raise exception 'ADMIN_CIRCLE_LIFECYCLE_SCHEMA_PRECONDITION_FAILED';
  end if;

  select pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid)
  into constraint_expression
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'circles'
    and constraint_row.conname = 'circles_status_check'
    and constraint_row.contype = 'c'
    and constraint_row.convalidated;

  if constraint_expression is null
     or regexp_replace(lower(constraint_expression), '[[:space:]]+', '', 'g') <> '(status=any(array[''active''::text,''deleted''::text]))' then
    raise exception 'ADMIN_CIRCLE_LIFECYCLE_SCHEMA_PRECONDITION_FAILED';
  end if;
end
$$;

do $$
begin
  if to_regprocedure('public.admin_circle_purge_preview_v1(uuid)') is not null
     or to_regprocedure('public.admin_purge_circle_v1(uuid)') is not null then
    raise exception 'ADMIN_CIRCLE_LIFECYCLE_RPC_PRECONDITION_FAILED';
  end if;
end
$$;

do $$
declare
  validator_oid oid;
  validator_owner text;
  validator_language text;
  validator_security_definer boolean;
  validator_result text;
  validator_definition text;
  validator_trigger_count integer;
  validator_trigger_relid oid;
  validator_trigger_function oid;
  validator_trigger_type smallint;
  validator_trigger_attributes int2vector;
begin
  validator_oid := to_regprocedure('public.validate_report_target()');

  if validator_oid is null then
    raise exception 'ADMIN_CIRCLE_REPORT_VALIDATOR_PRECONDITION_FAILED';
  end if;

  select
    pg_catalog.pg_get_userbyid(function_row.proowner),
    language_row.lanname,
    function_row.prosecdef,
    pg_catalog.format_type(function_row.prorettype, null),
    pg_catalog.pg_get_functiondef(function_row.oid)
  into
    validator_owner,
    validator_language,
    validator_security_definer,
    validator_result,
    validator_definition
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace on namespace.oid = function_row.pronamespace
  join pg_catalog.pg_language language_row on language_row.oid = function_row.prolang
  where function_row.oid = validator_oid
    and namespace.nspname = 'public';

  if validator_owner is distinct from 'postgres'
     or validator_language is distinct from 'plpgsql'
     or validator_security_definer
     or validator_result is distinct from 'trigger'
     or validator_definition is null
     or regexp_replace(lower(validator_definition), '[[:space:]]+', '', 'g') not like '%createorreplacefunctionpublic.validate_report_target()%returnstriggerlanguageplpgsqlas%'
     or regexp_replace(lower(validator_definition), '[[:space:]]+', '', 'g') not like '%iftg_op=''update''andnew.target_typeisnotdistinctfromold.target_typeandnew.target_idisnotdistinctfromold.target_idthenreturnnew;%'
     or regexp_replace(lower(validator_definition), '[[:space:]]+', '', 'g') not like '%new.target_type=''post''%public.posts%'
     or regexp_replace(lower(validator_definition), '[[:space:]]+', '', 'g') not like '%new.target_type=''comment''%public.comments%'
     or regexp_replace(lower(validator_definition), '[[:space:]]+', '', 'g') not like '%new.target_type=''circle''%public.circles%'
     or regexp_replace(lower(validator_definition), '[[:space:]]+', '', 'g') not like '%new.target_type=''user''%public.profiles%'
     or regexp_replace(lower(validator_definition), '[[:space:]]+', '', 'g') like '%forkeyshare%' then
    raise exception 'ADMIN_CIRCLE_REPORT_VALIDATOR_PRECONDITION_FAILED';
  end if;

  select count(*)
  into validator_trigger_count
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgname = 'trg_reports_validate_target'
    and not trigger_row.tgisinternal;

  if validator_trigger_count = 1 then
    select trigger_row.tgrelid, trigger_row.tgfoid, trigger_row.tgtype, trigger_row.tgattr
    into validator_trigger_relid, validator_trigger_function, validator_trigger_type, validator_trigger_attributes
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgname = 'trg_reports_validate_target'
      and not trigger_row.tgisinternal;
  end if;

  if validator_trigger_count <> 1
     or validator_trigger_relid <> 'public.reports'::regclass
     or validator_trigger_function <> validator_oid
     or validator_trigger_type <> 23
     or validator_trigger_attributes <> ''::int2vector then
    raise exception 'ADMIN_CIRCLE_REPORT_VALIDATOR_PRECONDITION_FAILED';
  end if;
end
$$;

alter table public.circles
  drop constraint circles_status_check;

alter table public.circles
  add constraint circles_status_check
  check (status in ('active', 'hidden', 'deleted'));

create or replace function public.validate_report_target()
returns trigger
language plpgsql
security invoker
as $$
begin
  if tg_op = 'UPDATE'
     and new.target_type is not distinct from old.target_type
     and new.target_id is not distinct from old.target_id then
    return new;
  end if;

  if new.target_type = 'post' and not exists (
    select 1 from public.posts p where p.id = new.target_id
  ) then
    raise exception 'report target post % not found', new.target_id;
  elsif new.target_type = 'comment' and not exists (
    select 1 from public.comments c where c.id = new.target_id
  ) then
    raise exception 'report target comment % not found', new.target_id;
  elsif new.target_type = 'circle' then
    perform 1
    from public.circles circle_row
    where circle_row.id = new.target_id
    for key share;

    if not found then
      raise exception 'report target circle % not found', new.target_id;
    end if;
  elsif new.target_type = 'user' and not exists (
    select 1 from public.profiles profile_row where profile_row.id = new.target_id
  ) then
    raise exception 'report target user % not found', new.target_id;
  end if;
  return new;
end;
$$;

drop trigger trg_reports_validate_target on public.reports;
create trigger trg_reports_validate_target
before insert or update of target_type, target_id on public.reports
for each row execute function public.validate_report_target();

create function public.admin_circle_purge_preview_v1(circle_id uuid)
returns table (
  circle_exists boolean,
  current_status text,
  circle_name text,
  post_count bigint,
  circle_report_count bigint,
  direct_notification_count bigint,
  image_path text,
  allowed boolean,
  reason_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_circle public.circles%rowtype;
begin
  select *
  into target_circle
  from public.circles
  where id = circle_id;

  if not found then
    return query select false, null::text, null::text, 0::bigint, 0::bigint, 0::bigint, null::text, false, 'CIRCLE_NOT_FOUND';
    return;
  end if;

  return query
  select
    true,
    target_circle.status,
    target_circle.name,
    (select count(*) from public.posts where posts.circle_id = target_circle.id),
    (select count(*) from public.reports where reports.target_type = 'circle' and reports.target_id = target_circle.id),
    (select count(*) from public.forum_notifications where forum_notifications.circle_id = target_circle.id),
    target_circle.image_path,
    target_circle.status = 'deleted'
      and not exists (select 1 from public.posts where posts.circle_id = target_circle.id)
      and not exists (select 1 from public.reports where reports.target_type = 'circle' and reports.target_id = target_circle.id),
    case
      when target_circle.status <> 'deleted' then 'CIRCLE_NOT_DELETED'
      when exists (select 1 from public.posts where posts.circle_id = target_circle.id) then 'CIRCLE_HAS_POSTS'
      when exists (select 1 from public.reports where reports.target_type = 'circle' and reports.target_id = target_circle.id) then 'CIRCLE_HAS_REPORTS'
      else 'PURGE_ALLOWED'
    end;
end;
$$;

alter function public.admin_circle_purge_preview_v1(uuid) owner to postgres;

create function public.admin_purge_circle_v1(circle_id uuid)
returns table (
  purged boolean,
  reason_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_circle public.circles%rowtype;
begin
  select *
  into target_circle
  from public.circles
  where id = circle_id
  for update;

  if not found then
    return query select false, 'CIRCLE_NOT_FOUND'::text;
    return;
  end if;

  if target_circle.status <> 'deleted' then
    return query select false, 'CIRCLE_NOT_DELETED'::text;
    return;
  end if;

  if exists (select 1 from public.posts where posts.circle_id = target_circle.id) then
    return query select false, 'CIRCLE_HAS_POSTS'::text;
    return;
  end if;

  if exists (select 1 from public.reports where reports.target_type = 'circle' and reports.target_id = target_circle.id) then
    return query select false, 'CIRCLE_HAS_REPORTS'::text;
    return;
  end if;

  delete from public.circles
  where id = target_circle.id;

  return query select true, 'PURGED'::text;
end;
$$;

alter function public.admin_purge_circle_v1(uuid) owner to postgres;

revoke all on function public.admin_circle_purge_preview_v1(uuid) from public;
revoke all on function public.admin_circle_purge_preview_v1(uuid) from anon;
revoke all on function public.admin_circle_purge_preview_v1(uuid) from authenticated;
grant execute on function public.admin_circle_purge_preview_v1(uuid) to service_role;

revoke all on function public.admin_purge_circle_v1(uuid) from public;
revoke all on function public.admin_purge_circle_v1(uuid) from anon;
revoke all on function public.admin_purge_circle_v1(uuid) from authenticated;
grant execute on function public.admin_purge_circle_v1(uuid) to service_role;
