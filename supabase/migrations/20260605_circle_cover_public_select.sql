drop policy if exists "circle_cover_objects_select_self" on storage.objects;
drop policy if exists "circle_cover_objects_select_public" on storage.objects;

create policy "circle_cover_objects_select_public"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'circle-covers'
);
