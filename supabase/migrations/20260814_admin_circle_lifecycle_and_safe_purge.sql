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

alter table public.circles
  drop constraint circles_status_check;

alter table public.circles
  add constraint circles_status_check
  check (status in ('active', 'hidden', 'deleted'));

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

  lock table public.reports in share mode;

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
