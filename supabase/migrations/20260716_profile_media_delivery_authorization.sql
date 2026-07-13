-- Public profile-media delivery must resolve an exact, canonical object from
-- the corresponding public profile field rather than a prefix-only object.

create or replace function public.can_access_public_profile_media_object(target_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_object_name ~ '^profile-(avatars|banners)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[1-9][0-9]{0,12}-[a-z0-9._-]{0,240}$'
    and exists (
      select 1
      from public.profiles profile_ref
      where split_part(target_object_name, '/', 2) = profile_ref.id::text
        and (
          (target_object_name like 'profile-avatars/%' and profile_ref.avatar_url = target_object_name)
          or (target_object_name like 'profile-banners/%' and profile_ref.banner_url = target_object_name)
        )
    );
$$;

revoke all on function public.can_access_public_profile_media_object(text) from public;
grant execute on function public.can_access_public_profile_media_object(text) to anon, authenticated;

drop policy if exists "profile_avatar_objects_select_public" on storage.objects;
create policy "profile_avatar_objects_select_public"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'post-media'
  and public.can_access_public_profile_media_object(name)
);

drop policy if exists "profile_banner_objects_select_public" on storage.objects;
create policy "profile_banner_objects_select_public"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'post-media'
  and public.can_access_public_profile_media_object(name)
);
