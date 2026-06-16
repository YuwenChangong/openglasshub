-- Forum Phase 4: allow uploaded video files in the existing post-media bucket.

alter table public.post_media
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists duration_seconds numeric,
  add column if not exists size_bytes bigint,
  add column if not exists mime_type text,
  add column if not exists is_cover boolean not null default false;

alter table public.post_media
  drop constraint if exists post_media_width_check;

alter table public.post_media
  add constraint post_media_width_check
  check (width is null or width > 0);

alter table public.post_media
  drop constraint if exists post_media_height_check;

alter table public.post_media
  add constraint post_media_height_check
  check (height is null or height > 0);

alter table public.post_media
  drop constraint if exists post_media_duration_check;

alter table public.post_media
  add constraint post_media_duration_check
  check (duration_seconds is null or duration_seconds >= 0);

alter table public.post_media
  drop constraint if exists post_media_size_bytes_check;

alter table public.post_media
  add constraint post_media_size_bytes_check
  check (size_bytes is null or size_bytes >= 0);

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
