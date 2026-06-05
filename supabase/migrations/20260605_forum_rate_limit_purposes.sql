alter table public.forum_upload_attempts
  drop constraint if exists forum_upload_attempts_purpose_check;

alter table public.forum_upload_attempts
  add constraint forum_upload_attempts_purpose_check
  check (
    purpose in (
      'post_media_upload',
      'external_video_upload',
      'post_create',
      'comment_create',
      'circle_create'
    )
  );

create index if not exists forum_upload_attempts_purpose_user_created_idx
  on public.forum_upload_attempts (purpose, user_id, created_at desc);

create index if not exists forum_upload_attempts_purpose_ip_created_idx
  on public.forum_upload_attempts (purpose, ip_hash, created_at desc);
