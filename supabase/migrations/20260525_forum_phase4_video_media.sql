-- Forum Phase 4: allow uploaded video files in the existing post-media bucket.

alter table public.post_media
  drop constraint if exists post_media_kind_check;

alter table public.post_media
  drop constraint if exists post_media_check;

alter table public.post_media
  add constraint post_media_kind_check
  check (kind in ('image', 'video', 'video_link'));

alter table public.post_media
  add constraint post_media_payload_check
  check (
    (kind = 'image' and storage_path is not null and url is null)
    or (kind = 'video' and storage_path is not null and url is null)
    or (kind = 'video_link' and url is not null)
  );

update storage.buckets
set
  file_size_limit = 104857600,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
where id = 'post-media';
