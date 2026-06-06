alter table public.profiles
  add column if not exists banner_url text;

drop policy if exists "profile_avatar_objects_insert_self" on storage.objects;
create policy "profile_avatar_objects_insert_self"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'profile-avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "profile_avatar_objects_select_public" on storage.objects;
create policy "profile_avatar_objects_select_public"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'profile-avatars'
);

drop policy if exists "profile_avatar_objects_update_self" on storage.objects;
create policy "profile_avatar_objects_update_self"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'profile-avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
)
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'profile-avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "profile_avatar_objects_delete_self" on storage.objects;
create policy "profile_avatar_objects_delete_self"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'profile-avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "profile_banner_objects_insert_self" on storage.objects;
create policy "profile_banner_objects_insert_self"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'profile-banners'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "profile_banner_objects_select_public" on storage.objects;
create policy "profile_banner_objects_select_public"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'profile-banners'
);

drop policy if exists "profile_banner_objects_update_self" on storage.objects;
create policy "profile_banner_objects_update_self"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'profile-banners'
  and (storage.foldername(name))[2] = auth.uid()::text
)
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'profile-banners'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "profile_banner_objects_delete_self" on storage.objects;
create policy "profile_banner_objects_delete_self"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'profile-banners'
  and (storage.foldername(name))[2] = auth.uid()::text
);
