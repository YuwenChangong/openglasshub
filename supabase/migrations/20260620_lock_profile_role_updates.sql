-- Lock down profile role updates so ordinary authenticated users cannot self-escalate.

do $$
declare
  allowed_columns text[];
  quoted_allowed_columns text;
begin
  select array_agg(format('%I', column_name) order by ordinal_position)
  into allowed_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name in ('username', 'display_name', 'bio', 'avatar_url', 'banner_url');

  revoke update on table public.profiles from authenticated;

  if allowed_columns is not null and array_length(allowed_columns, 1) > 0 then
    quoted_allowed_columns := array_to_string(allowed_columns, ', ');
    execute format('grant update (%s) on table public.profiles to authenticated', quoted_allowed_columns);
  end if;
end $$;

create or replace function public.prevent_unauthorized_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  actor_role public.user_role;
  jwt_role text;
begin
  if old.role is not distinct from new.role then
    return new;
  end if;

  jwt_role := current_setting('request.jwt.claim.role', true);
  if current_user = 'postgres' or jwt_role = 'service_role' then
    return new;
  end if;

  actor_id := auth.uid();
  actor_role := public.current_user_role();

  if actor_id is null then
    raise exception 'PROFILE_ROLE_UPDATE_FORBIDDEN' using errcode = '42501';
  end if;

  if actor_id = new.id then
    raise exception 'PROFILE_ROLE_UPDATE_FORBIDDEN' using errcode = '42501';
  end if;

  if actor_role <> 'admin' then
    raise exception 'PROFILE_ROLE_UPDATE_FORBIDDEN' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_unauthorized_profile_role_change() from public, anon, authenticated;

drop trigger if exists trg_profiles_prevent_role_change on public.profiles;
create trigger trg_profiles_prevent_role_change
before update of role on public.profiles
for each row
execute function public.prevent_unauthorized_profile_role_change();
