-- Account security V1. Enforcement starts disabled so deploying this migration is backward-safe.
create table if not exists public.auth_security_config (
  id boolean primary key default true check (id),
  enforcement_mode text not null default 'off' check (enforcement_mode in ('off', 'qa_only', 'all')),
  qa_user_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.auth_security_config enable row level security;
revoke all on public.auth_security_config from anon, authenticated;
insert into public.auth_security_config (id, enforcement_mode) values (true, 'off') on conflict (id) do nothing;

create table if not exists public.login_email_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  password_session_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts = 5),
  resend_count integer not null default 0 check (resend_count >= 0),
  last_sent_at timestamptz not null default now(),
  consumed_at timestamptz,
  invalidated_at timestamptz,
  request_ip_hash text
);
create index if not exists login_email_challenges_user_created_idx on public.login_email_challenges (user_id, created_at desc);
create index if not exists login_email_challenges_ip_created_idx on public.login_email_challenges (request_ip_hash, created_at desc) where request_ip_hash is not null;
alter table public.login_email_challenges enable row level security;
revoke all on public.login_email_challenges from anon, authenticated;

create table if not exists public.verified_application_sessions (
  session_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  challenge_id uuid not null references public.login_email_challenges(id) on delete restrict,
  activated_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists verified_application_sessions_user_idx on public.verified_application_sessions (user_id, expires_at);
alter table public.verified_application_sessions enable row level security;
revoke all on public.verified_application_sessions from anon, authenticated;

create or replace function public.current_application_session_id_v1()
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare claim text;
begin
  claim := auth.jwt() ->> 'session_id';
  if claim is null or claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return null; end if;
  return claim::uuid;
exception when invalid_text_representation then return null;
end;
$$;

create or replace function public.is_application_session_verified_v1()
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cfg public.auth_security_config%rowtype; sid uuid;
begin
  select * into cfg from public.auth_security_config where id = true;
  -- A missing/invalid rollout record means OFF only. An explicit ALL record fails closed below.
  if not found or cfg.enforcement_mode not in ('qa_only', 'all') then return true; end if;
  if cfg.enforcement_mode = 'qa_only' and (cfg.qa_user_id is null or cfg.qa_user_id <> auth.uid()) then return true; end if;
  if auth.uid() is null then return false; end if;
  sid := public.current_application_session_id_v1();
  if sid is null then return false; end if;
  return exists (
    select 1 from public.verified_application_sessions s
    where s.session_id = sid and s.user_id = auth.uid() and s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now())
  );
end;
$$;

create or replace function public.create_login_email_challenge_v1(p_user_id uuid, p_password_session_id uuid, p_email text, p_request_ip_hash text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare challenge_id uuid; account_short_sends integer; account_daily_sends integer; ip_daily_sends integer;
begin
  if p_user_id is null or p_password_session_id is null or p_email is null or p_request_ip_hash is null then
    raise exception 'invalid password proof' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_request_ip_hash, 0));
  select coalesce(sum(1 + resend_count), 0) into account_short_sends from public.login_email_challenges
    where user_id = p_user_id and created_at > now() - interval '10 minutes';
  select coalesce(sum(1 + resend_count), 0) into account_daily_sends from public.login_email_challenges
    where user_id = p_user_id and created_at > now() - interval '1 day';
  select coalesce(sum(1 + resend_count), 0) into ip_daily_sends from public.login_email_challenges
    where request_ip_hash = p_request_ip_hash and created_at > now() - interval '1 day';
  if account_short_sends >= 3 or account_daily_sends >= 8 or ip_daily_sends >= 20 then
    raise exception 'email verification send limit reached' using errcode = '42501';
  end if;
  update public.login_email_challenges set invalidated_at = now()
    where user_id = p_user_id and password_session_id = p_password_session_id and consumed_at is null and invalidated_at is null;
  insert into public.login_email_challenges (user_id, email, password_session_id, request_ip_hash)
    values (p_user_id, lower(p_email), p_password_session_id, p_request_ip_hash) returning id into challenge_id;
  return challenge_id;
end;
$$;

create or replace function public.begin_login_email_verification_v1(p_challenge_id uuid)
returns table (email text, user_id uuid) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.login_email_challenges c set attempt_count = attempt_count + 1
   where c.id = p_challenge_id and c.user_id = auth.uid()
     and c.password_session_id = public.current_application_session_id_v1()
     and c.consumed_at is null and c.invalidated_at is null and c.expires_at > now()
     and c.attempt_count < c.max_attempts
   returning c.email, c.user_id into email, user_id;
  if not found then raise exception 'challenge unavailable' using errcode = '42501'; end if;
  return next;
end;
$$;

create or replace function public.reserve_login_email_challenge_resend_v1(p_challenge_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare result_email text; challenge public.login_email_challenges%rowtype; account_short_sends integer; account_daily_sends integer; ip_daily_sends integer;
begin
  select * into challenge from public.login_email_challenges c where c.id = p_challenge_id and c.user_id = auth.uid()
    and c.password_session_id = public.current_application_session_id_v1() for update;
  if not found or challenge.consumed_at is not null or challenge.invalidated_at is not null or challenge.expires_at <= now()
    or challenge.last_sent_at > now() - interval '60 seconds' or challenge.resend_count >= 3 then
    raise exception 'resend unavailable' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(challenge.user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(coalesce(challenge.request_ip_hash, ''), 0));
  select coalesce(sum(1 + resend_count), 0) into account_short_sends from public.login_email_challenges
    where user_id = challenge.user_id and created_at > now() - interval '10 minutes';
  select coalesce(sum(1 + resend_count), 0) into account_daily_sends from public.login_email_challenges
    where user_id = challenge.user_id and created_at > now() - interval '1 day';
  select coalesce(sum(1 + resend_count), 0) into ip_daily_sends from public.login_email_challenges
    where request_ip_hash = challenge.request_ip_hash and created_at > now() - interval '1 day';
  if account_short_sends >= 3 or account_daily_sends >= 8 or ip_daily_sends >= 20 then
    raise exception 'resend unavailable' using errcode = '42501';
  end if;
  update public.login_email_challenges set resend_count = resend_count + 1, last_sent_at = now() where id = challenge.id
    returning email into result_email;
  return result_email;
end;
$$;

create or replace function public.activate_login_email_session_v1(p_challenge_id uuid, p_session_id uuid, p_user_id uuid, p_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare challenge public.login_email_challenges%rowtype;
begin
  if p_session_id is null or p_user_id is null then raise exception 'invalid session' using errcode = '42501'; end if;
  select * into challenge from public.login_email_challenges where id = p_challenge_id for update;
  if not found or challenge.user_id <> p_user_id or challenge.consumed_at is not null or challenge.invalidated_at is not null or challenge.expires_at <= now() then
    raise exception 'challenge unavailable' using errcode = '42501';
  end if;
  insert into public.verified_application_sessions (session_id, user_id, challenge_id, expires_at)
    values (p_session_id, p_user_id, challenge.id, p_expires_at) on conflict (session_id) do nothing;
  update public.login_email_challenges set consumed_at = now() where id = challenge.id;
  return true;
end;
$$;

revoke all on function public.current_application_session_id_v1() from public;
revoke all on function public.is_application_session_verified_v1() from public;
revoke all on function public.create_login_email_challenge_v1(uuid, uuid, text, text) from public;
revoke all on function public.begin_login_email_verification_v1(uuid) from public;
revoke all on function public.reserve_login_email_challenge_resend_v1(uuid) from public;
revoke all on function public.activate_login_email_session_v1(uuid, uuid, uuid, timestamptz) from public;
grant execute on function public.is_application_session_verified_v1() to authenticated;
grant execute on function public.create_login_email_challenge_v1(uuid, uuid, text, text) to service_role;
grant execute on function public.begin_login_email_verification_v1(uuid) to authenticated;
grant execute on function public.reserve_login_email_challenge_resend_v1(uuid) to authenticated;
grant execute on function public.activate_login_email_session_v1(uuid, uuid, uuid, timestamptz) to service_role;

-- Restrictive policies preserve anonymous public reads while blocking every authenticated mutation until activation.
do $$ declare tbl text; begin
  foreach tbl in array array['profiles','circles','posts','comments','reports','moderation_actions','post_votes','bookmarks','post_media','comment_reactions','forum_notifications','user_safety_states','user_safety_events','report_events','legal_policy_acceptances','news_articles','forum_upload_attempts'] loop
    execute format('drop policy if exists application_session_gate_mutation_v1 on public.%I', tbl);
    execute format('drop policy if exists application_session_gate_select_v1 on public.%I', tbl);
    execute format('drop policy if exists application_session_gate_insert_v1 on public.%I', tbl);
    execute format('drop policy if exists application_session_gate_update_v1 on public.%I', tbl);
    execute format('drop policy if exists application_session_gate_delete_v1 on public.%I', tbl);
    execute format('create policy application_session_gate_select_v1 on public.%I as restrictive for select to authenticated using ((select public.is_application_session_verified_v1()))', tbl);
    execute format('create policy application_session_gate_insert_v1 on public.%I as restrictive for insert to authenticated with check ((select public.is_application_session_verified_v1()))', tbl);
    execute format('create policy application_session_gate_update_v1 on public.%I as restrictive for update to authenticated using ((select public.is_application_session_verified_v1())) with check ((select public.is_application_session_verified_v1()))', tbl);
    execute format('create policy application_session_gate_delete_v1 on public.%I as restrictive for delete to authenticated using ((select public.is_application_session_verified_v1()))', tbl);
  end loop;
end $$;
drop policy if exists application_session_gate_storage_mutation_v1 on storage.objects;
drop policy if exists application_session_gate_storage_insert_v1 on storage.objects;
drop policy if exists application_session_gate_storage_update_v1 on storage.objects;
drop policy if exists application_session_gate_storage_delete_v1 on storage.objects;
create policy application_session_gate_storage_insert_v1 on storage.objects as restrictive for insert to authenticated with check ((select public.is_application_session_verified_v1()));
create policy application_session_gate_storage_update_v1 on storage.objects as restrictive for update to authenticated using ((select public.is_application_session_verified_v1())) with check ((select public.is_application_session_verified_v1()));
create policy application_session_gate_storage_delete_v1 on storage.objects as restrictive for delete to authenticated using ((select public.is_application_session_verified_v1()));
