alter table public.circles
  add column if not exists status text;

update public.circles
set status = 'active'
where status is null;

alter table public.circles
  alter column status set default 'active';

alter table public.circles
  alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'circles_status_check'
      and conrelid = 'public.circles'::regclass
  ) then
    alter table public.circles
      add constraint circles_status_check
      check (status in ('active', 'deleted'));
  end if;
end
$$;

create index if not exists circles_status_idx
on public.circles (status);

drop policy if exists "circles_delete_owner_or_staff" on public.circles;
