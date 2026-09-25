-- The compatibility arguments are intentionally ignored: only the server-owned
-- hash selects a bucket, and the effective policy is always five per 24 hours.
create or replace function public.consume_verification_email_resend_limit(
  input_ip_hash text, max_attempts integer default 5, window_hours integer default 24
)
returns table(allowed boolean, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_count integer;
begin
  if input_ip_hash is null or input_ip_hash !~ '^[0-9a-f]{64}$' then
    return query select false, 0;
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(input_ip_hash, 729403));
  select count(*)::integer into v_count
  from public.forum_upload_attempts
  where purpose = 'verification_email_resend'
    and ip_hash = input_ip_hash
    and created_at >= v_now - interval '24 hours';
  if v_count >= 5 then
    return query select false, v_count;
    return;
  end if;
  insert into public.forum_upload_attempts (user_id, ip_hash, bytes, purpose, created_at)
    values (null, input_ip_hash, 0, 'verification_email_resend', v_now);
  return query select true, v_count + 1;
end;
$$;

alter function public.consume_verification_email_resend_limit(text, integer, integer) owner to postgres;
revoke all on function public.consume_verification_email_resend_limit(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_verification_email_resend_limit(text, integer, integer)
  to service_role;
