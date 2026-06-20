-- Controlled QA-only admin role grant path.
-- Purpose: allow service_role-driven QA helpers to grant/revoke admin role
-- without reopening broad table privileges on public.profiles.

create or replace function public.qa_grant_admin_role(target_user_id uuid)
returns public.user_role
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text;
  next_role public.user_role;
begin
  jwt_role := current_setting('request.jwt.claim.role', true);

  if current_user <> 'postgres' and jwt_role <> 'service_role' then
    raise exception 'QA_ADMIN_ROLE_RPC_PERMISSION_DENIED' using errcode = '42501';
  end if;

  if target_user_id is null then
    raise exception 'QA_ADMIN_ROLE_TARGET_REQUIRED' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = target_user_id) then
    raise exception 'QA_ADMIN_ROLE_TARGET_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.profiles
  set role = 'admin'
  where id = target_user_id;

  select role into next_role
  from public.profiles
  where id = target_user_id;

  return next_role;
end;
$$;

create or replace function public.qa_revoke_admin_role(target_user_id uuid)
returns public.user_role
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text;
  next_role public.user_role;
begin
  jwt_role := current_setting('request.jwt.claim.role', true);

  if current_user <> 'postgres' and jwt_role <> 'service_role' then
    raise exception 'QA_ADMIN_ROLE_RPC_PERMISSION_DENIED' using errcode = '42501';
  end if;

  if target_user_id is null then
    raise exception 'QA_ADMIN_ROLE_TARGET_REQUIRED' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = target_user_id) then
    raise exception 'QA_ADMIN_ROLE_TARGET_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.profiles
  set role = 'user'
  where id = target_user_id;

  select role into next_role
  from public.profiles
  where id = target_user_id;

  return next_role;
end;
$$;

revoke all on function public.qa_grant_admin_role(uuid) from public, anon, authenticated;
revoke all on function public.qa_revoke_admin_role(uuid) from public, anon, authenticated;

grant execute on function public.qa_grant_admin_role(uuid) to service_role;
grant execute on function public.qa_revoke_admin_role(uuid) to service_role;
