alter table public.circles
  drop constraint if exists circles_status_check;

alter table public.circles
  add constraint circles_status_check
  check (status in ('active', 'hidden', 'deleted'));

create or replace function public.admin_circle_purge_preview_v1(circle_id uuid)
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

create or replace function public.admin_purge_circle_v1(circle_id uuid)
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

revoke all on function public.admin_circle_purge_preview_v1(uuid) from public;
revoke all on function public.admin_circle_purge_preview_v1(uuid) from anon;
revoke all on function public.admin_circle_purge_preview_v1(uuid) from authenticated;
grant execute on function public.admin_circle_purge_preview_v1(uuid) to service_role;

revoke all on function public.admin_purge_circle_v1(uuid) from public;
revoke all on function public.admin_purge_circle_v1(uuid) from anon;
revoke all on function public.admin_purge_circle_v1(uuid) from authenticated;
grant execute on function public.admin_purge_circle_v1(uuid) to service_role;
