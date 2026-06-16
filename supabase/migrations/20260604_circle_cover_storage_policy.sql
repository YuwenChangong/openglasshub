drop policy if exists "circle_cover_objects_insert_self" on storage.objects;
create policy "circle_cover_objects_insert_self"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'circle-covers'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "circle_cover_objects_select_self" on storage.objects;
create policy "circle_cover_objects_select_self"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'circle-covers'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "circle_cover_objects_update_self" on storage.objects;
create policy "circle_cover_objects_update_self"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'circle-covers'
  and (storage.foldername(name))[2] = auth.uid()::text
)
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'circle-covers'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "circle_cover_objects_delete_self" on storage.objects;
create policy "circle_cover_objects_delete_self"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'circle-covers'
  and (storage.foldername(name))[2] = auth.uid()::text
);
