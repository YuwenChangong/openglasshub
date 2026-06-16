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
      'circle_create',
      'verification_email_resend'
    )
  );

create or replace function public.consume_verification_email_resend_limit(
  input_ip_hash text,
  max_attempts integer default 5,
  window_hours integer default 24
)
returns table(allowed boolean, attempts integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  safe_max_attempts integer := greatest(1, coalesce(max_attempts, 5));
  safe_window_hours integer := greatest(1, coalesce(window_hours, 24));
  current_count integer := 0;
begin
  if input_ip_hash is null or btrim(input_ip_hash) = '' then
    return query select false, 0;
    return;
  end if;

  select count(*)::integer
    into current_count
  from public.forum_upload_attempts
  where purpose = 'verification_email_resend'
    and ip_hash = input_ip_hash
    and created_at >= now() - make_interval(hours => safe_window_hours);

  if current_count >= safe_max_attempts then
    return query select false, current_count;
    return;
  end if;

  insert into public.forum_upload_attempts (user_id, ip_hash, bytes, purpose)
  values (null, input_ip_hash, 0, 'verification_email_resend');

  return query select true, current_count + 1;
end;
$$;

revoke all on function public.consume_verification_email_resend_limit(text, integer, integer) from public;
grant execute on function public.consume_verification_email_resend_limit(text, integer, integer) to anon;
grant execute on function public.consume_verification_email_resend_limit(text, integer, integer) to authenticated;
