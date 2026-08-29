-- Durable first-publication slug provenance for public device URLs.
alter table public.devices add column if not exists slug_locked boolean not null default false;

update public.devices
set slug_locked = true
where publication_status = 'published' and slug_locked = false;

create or replace function public.enforce_device_slug_lock()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.slug_locked and new.slug is distinct from old.slug then
    raise exception 'device_slug_locked' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.slug_locked and not new.slug_locked then
    raise exception 'device_slug_locked' using errcode = '23514';
  end if;
  if new.publication_status = 'published' then new.slug_locked = true; end if;
  return new;
end;
$$;

drop trigger if exists trg_devices_enforce_slug_lock on public.devices;
create trigger trg_devices_enforce_slug_lock
before insert or update on public.devices
for each row execute function public.enforce_device_slug_lock();
