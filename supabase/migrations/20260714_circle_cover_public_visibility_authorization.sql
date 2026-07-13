-- Public circle covers are readable only when the exact database-owned object
-- belongs to an active canonically visible circle. Owner and staff reads stay
-- available for circle management.
create or replace function public.can_access_public_circle_cover_object(target_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_object_name ~ '^circle-covers/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[1-9][0-9]{0,12}-[a-z0-9._-]{1,240}$'
    and exists (
      select 1
      from public.circles as circle_ref
      where circle_ref.image_path = target_object_name
        and public.can_access_public_circle(circle_ref.id)
    );
$$;

revoke all on function public.can_access_public_circle_cover_object(text) from public;
grant execute on function public.can_access_public_circle_cover_object(text) to anon, authenticated;

drop policy if exists "circles_select_public" on public.circles;
create policy "circles_select_public"
on public.circles
for select
to anon, authenticated
using (
  public.can_access_public_circle(id)
  or owner_id = auth.uid()
  or (select public.is_moderator_or_admin())
);

drop policy if exists "circle_cover_objects_select_public" on storage.objects;
create policy "circle_cover_objects_select_public"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'post-media'
  and (
    public.can_access_public_circle_cover_object(name)
    or (
      (storage.foldername(name))[1] = 'circle-covers'
      and (storage.foldername(name))[2] = auth.uid()::text
    )
    or (select public.is_moderator_or_admin())
  )
);
