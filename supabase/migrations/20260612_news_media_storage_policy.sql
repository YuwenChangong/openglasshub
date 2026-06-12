drop policy if exists "news_cover_objects_insert_staff" on storage.objects;
create policy "news_cover_objects_insert_staff"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'news-covers'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (select public.is_moderator_or_admin())
);

drop policy if exists "news_cover_objects_select_public" on storage.objects;
create policy "news_cover_objects_select_public"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'news-covers'
);

drop policy if exists "news_cover_objects_update_staff" on storage.objects;
create policy "news_cover_objects_update_staff"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'news-covers'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (select public.is_moderator_or_admin())
)
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'news-covers'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (select public.is_moderator_or_admin())
);

drop policy if exists "news_cover_objects_delete_staff" on storage.objects;
create policy "news_cover_objects_delete_staff"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'news-covers'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (select public.is_moderator_or_admin())
);

drop policy if exists "news_content_objects_insert_staff" on storage.objects;
create policy "news_content_objects_insert_staff"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'news-content'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (select public.is_moderator_or_admin())
);

drop policy if exists "news_content_objects_select_public" on storage.objects;
create policy "news_content_objects_select_public"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'news-content'
);

drop policy if exists "news_content_objects_update_staff" on storage.objects;
create policy "news_content_objects_update_staff"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'news-content'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (select public.is_moderator_or_admin())
)
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'news-content'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (select public.is_moderator_or_admin())
);

drop policy if exists "news_content_objects_delete_staff" on storage.objects;
create policy "news_content_objects_delete_staff"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = 'news-content'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (select public.is_moderator_or_admin())
);
