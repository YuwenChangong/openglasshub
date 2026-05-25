alter table public.circles
  add column if not exists owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists image_path text;

create index if not exists circles_owner_idx on public.circles(owner_id);

drop policy if exists "circles_manage_staff" on public.circles;

drop policy if exists "circles_insert_owner_or_staff" on public.circles;
create policy "circles_insert_owner_or_staff"
on public.circles
for insert
to authenticated
with check (
  owner_id = auth.uid()
  or (select public.is_moderator_or_admin())
);

drop policy if exists "circles_update_owner_or_staff" on public.circles;
create policy "circles_update_owner_or_staff"
on public.circles
for update
to authenticated
using (
  owner_id = auth.uid()
  or (select public.is_moderator_or_admin())
)
with check (
  owner_id = auth.uid()
  or (select public.is_moderator_or_admin())
);

drop policy if exists "circles_delete_owner_or_staff" on public.circles;
create policy "circles_delete_owner_or_staff"
on public.circles
for delete
to authenticated
using (
  owner_id = auth.uid()
  or (select public.is_moderator_or_admin())
);
