create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  locale_preference text not null default 'auto'
    check (locale_preference in ('auto', 'zh-CN', 'en')),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

revoke all on table public.user_preferences from public, anon, authenticated;
grant select on table public.user_preferences to authenticated;
grant insert (user_id, locale_preference) on table public.user_preferences to authenticated;
grant update (locale_preference) on table public.user_preferences to authenticated;

create policy user_preferences_owner_select
on public.user_preferences for select to authenticated
using ((select auth.uid()) = user_id);

create policy user_preferences_owner_insert
on public.user_preferences for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy user_preferences_owner_update
on public.user_preferences for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create function public.set_user_preference_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    NEW.revision := 1;
    NEW.updated_at := pg_catalog.clock_timestamp();
  else
    NEW.revision := OLD.revision + 1;
    NEW.updated_at := pg_catalog.clock_timestamp();
  end if;
  return NEW;
end;
$$;

revoke all on function public.set_user_preference_metadata() from public, anon, authenticated;

create trigger user_preferences_metadata
before insert or update on public.user_preferences
for each row execute function public.set_user_preference_metadata();
