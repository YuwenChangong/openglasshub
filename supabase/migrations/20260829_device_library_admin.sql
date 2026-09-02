-- OpenGlass Hub Device Library persistence foundation.
-- The static catalog remains the public read source until a later, separately reviewed cutover.

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  brand_key text not null,
  brand_name text not null,
  name text not null,
  short_description text not null,
  long_description text not null,
  positioning text,
  release_year text,
  availability text,
  type_label text,
  status_label text,
  media jsonb,
  product_image_url text,
  official_image_url text,
  image_alt text not null,
  product_url text,
  official_product_url text,
  buy_url text,
  category text not null,
  route_label text not null,
  route_description text not null,
  best_for jsonb not null default '[]'::jsonb,
  not_ideal_for jsonb not null default '[]'::jsonb,
  key_limitations jsonb,
  key_specs jsonb,
  full_specs jsonb,
  publication_status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  check (length(trim(slug)) > 0),
  check (length(trim(brand_key)) > 0),
  check (length(trim(brand_name)) > 0),
  check (length(trim(name)) > 0),
  check (publication_status in ('draft', 'published', 'hidden', 'archived')),
  check (jsonb_typeof(media) is null or jsonb_typeof(media) = 'object'),
  check (jsonb_typeof(best_for) = 'array'),
  check (jsonb_typeof(not_ideal_for) = 'array'),
  check (jsonb_typeof(key_limitations) is null or jsonb_typeof(key_limitations) = 'array'),
  check (jsonb_typeof(key_specs) is null or jsonb_typeof(key_specs) = 'array'),
  check (jsonb_typeof(full_specs) is null or jsonb_typeof(full_specs) = 'object')
);

create index if not exists devices_publication_status_idx on public.devices (publication_status);
create index if not exists devices_brand_key_idx on public.devices (brand_key);
create index if not exists devices_category_idx on public.devices (category);

drop trigger if exists trg_devices_set_updated_at on public.devices;
create trigger trg_devices_set_updated_at
before update on public.devices
for each row execute function public.set_updated_at();

grant select on table public.devices to anon, authenticated;
grant insert, update, delete on table public.devices to authenticated;

alter table public.devices enable row level security;

drop policy if exists "devices_select_published_public" on public.devices;
create policy "devices_select_published_public"
on public.devices for select to anon, authenticated
using (publication_status = 'published');

drop policy if exists "devices_select_staff_all" on public.devices;
create policy "devices_select_staff_all"
on public.devices for select to authenticated
using ((select public.is_moderator_or_admin()));

drop policy if exists "devices_insert_staff" on public.devices;
create policy "devices_insert_staff"
on public.devices for insert to authenticated
with check ((select public.is_moderator_or_admin()));

drop policy if exists "devices_update_staff" on public.devices;
create policy "devices_update_staff"
on public.devices for update to authenticated
using ((select public.is_moderator_or_admin()))
with check ((select public.is_moderator_or_admin()));

drop policy if exists "devices_delete_staff" on public.devices;
create policy "devices_delete_staff"
on public.devices for delete to authenticated
using ((select public.is_moderator_or_admin()));
