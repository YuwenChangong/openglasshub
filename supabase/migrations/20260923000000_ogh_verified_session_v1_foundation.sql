create schema if not exists private;

create table private.ogh_verified_sessions (
  session_id uuid primary key not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  verified_at timestamptz not null default now(),
  verification_kind text not null check (verification_kind in ('signup', 'login_challenge')),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= verified_at)
);
create index ogh_verified_sessions_user_verified_idx
  on private.ogh_verified_sessions (user_id, verified_at desc);

create table private.ogh_login_challenges (
  id uuid primary key not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  code_digest bytea not null check (octet_length(code_digest) = 32),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  send_count smallint not null default 0 check (send_count between 0 and 3),
  next_send_at timestamptz not null,
  delivery_state text not null check (delivery_state in ('reserved', 'accepted', 'unusable')),
  consumed_at timestamptz,
  superseded_at timestamptz
);
create unique index ogh_login_challenges_current_session_idx
  on private.ogh_login_challenges (session_id)
  where consumed_at is null and superseded_at is null;
create index ogh_login_challenges_user_created_idx
  on private.ogh_login_challenges (user_id, created_at desc);
create index ogh_login_challenges_expires_idx
  on private.ogh_login_challenges (expires_at);

create table private.ogh_email_send_budget (
  utc_day date not null,
  scope text not null check (scope in ('global', 'user', 'session', 'ip_hash')),
  scope_key text not null check (length(scope_key) between 1 and 128),
  send_count integer not null default 0 check (send_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (utc_day, scope, scope_key)
);

create table private.ogh_policy_acceptances (
  user_id uuid not null references auth.users(id) on delete cascade,
  bundle_version text not null check (length(btrim(bundle_version)) > 0),
  terms_version text not null check (length(btrim(terms_version)) > 0),
  privacy_version text not null check (length(btrim(privacy_version)) > 0),
  guidelines_version text not null check (length(btrim(guidelines_version)) > 0),
  acceptance_source text not null check (acceptance_source in (
    'registration', 'login', 'policy_update', 'legacy_account_gate', 'authenticated_callback'
  )),
  accepted_at timestamptz not null default now(),
  primary key (user_id, bundle_version)
);
create index ogh_policy_acceptances_user_accepted_idx
  on private.ogh_policy_acceptances (user_id, accepted_at desc);

alter table private.ogh_verified_sessions owner to postgres;
alter table private.ogh_login_challenges owner to postgres;
alter table private.ogh_email_send_budget owner to postgres;
alter table private.ogh_policy_acceptances owner to postgres;

revoke all on table private.ogh_verified_sessions, private.ogh_login_challenges,
  private.ogh_email_send_budget, private.ogh_policy_acceptances
  from public, anon, authenticated, service_role;

create function public.ogh_is_verified_session()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_session_text text;
  v_session_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null
     or auth.jwt()->>'role' is distinct from 'authenticated'
     or auth.jwt()->>'is_anonymous' is distinct from 'false' then
    return false;
  end if;

  v_session_text := auth.jwt()->>'session_id';
  if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_session_id := v_session_text::uuid;

  return exists (
    select 1
    from private.ogh_verified_sessions as verified
    join auth.sessions as live
      on live.id = verified.session_id and live.user_id = verified.user_id
    where verified.session_id = v_session_id
      and verified.user_id = v_user_id
      and verified.revoked_at is null
  );
exception when others then
  return false;
end;
$$;
alter function public.ogh_is_verified_session() owner to postgres;
revoke all on function public.ogh_is_verified_session() from public, anon, authenticated;
grant execute on function public.ogh_is_verified_session() to authenticated;

create function public.ogh_reserve_login_challenge(
  p_user_id uuid, p_session_id uuid, p_challenge_id uuid, p_digest bytea,
  p_ip_hash text, p_resend boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_day date := (v_now at time zone 'UTC')::date;
  v_previous private.ogh_login_challenges%rowtype;
  v_scope text;
  v_key text;
  v_limit integer;
  v_count integer;
begin
  if p_user_id is null or p_session_id is null or p_challenge_id is null
     or p_digest is null or pg_catalog.octet_length(p_digest) <> 32
     or p_ip_hash is null or pg_catalog.length(p_ip_hash) not between 1 and 128
     or p_resend is null then
    raise exception 'INVALID_CHALLENGE_RESERVATION' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_session_id::text, 729401));
  if not exists (select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user_id for share) then
    return 'SESSION_GONE';
  end if;
  if exists (select 1 from private.ogh_verified_sessions v where v.session_id = p_session_id) then
    return 'PENDING';
  end if;

  select * into v_previous from private.ogh_login_challenges c
    where c.session_id = p_session_id and c.consumed_at is null and c.superseded_at is null
    for update;
  if found then
    if not p_resend then return 'PENDING'; end if;
    if v_previous.attempts >= 5 then return 'EMAIL_BUDGET_EXHAUSTED'; end if;
    if v_previous.send_count >= 3 then return 'EMAIL_BUDGET_EXHAUSTED'; end if;
    if v_now < v_previous.next_send_at then return 'RESEND_COOLDOWN'; end if;
  elsif p_resend then
    return 'PENDING';
  end if;

  -- The daily advisory lock serializes all scope checks and counter writes.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_day::text, 729402));
  for v_scope, v_key, v_limit in
    values ('global', 'all', 100), ('user', p_user_id::text, 5),
           ('session', p_session_id::text, 3), ('ip_hash', p_ip_hash, 10)
  loop
    select b.send_count into v_count from private.ogh_email_send_budget b
      where b.utc_day = v_day and b.scope = v_scope and b.scope_key = v_key;
    if coalesce(v_count, 0) >= v_limit then
      return 'EMAIL_BUDGET_EXHAUSTED';
    end if;
    v_count := null;
  end loop;

  if v_previous.id is not null then
    update private.ogh_login_challenges set superseded_at = v_now where id = v_previous.id;
  end if;
  insert into private.ogh_login_challenges (
    id, user_id, session_id, code_digest, created_at, expires_at,
    attempts, send_count, next_send_at, delivery_state
  ) values (
    p_challenge_id, p_user_id, p_session_id, p_digest, v_now, v_now + interval '10 minutes',
    coalesce(v_previous.attempts, 0), coalesce(v_previous.send_count, 0) + 1,
    v_now + interval '60 seconds', 'reserved'
  );
  for v_scope, v_key in
    values ('global', 'all'), ('user', p_user_id::text),
           ('session', p_session_id::text), ('ip_hash', p_ip_hash)
  loop
    insert into private.ogh_email_send_budget (utc_day, scope, scope_key, send_count, updated_at)
      values (v_day, v_scope, v_key, 1, v_now)
      on conflict (utc_day, scope, scope_key) do update
      set send_count = private.ogh_email_send_budget.send_count + 1, updated_at = v_now;
  end loop;
  return 'RESERVED';
end;
$$;
alter function public.ogh_reserve_login_challenge(uuid, uuid, uuid, bytea, text, boolean) owner to postgres;
revoke all on function public.ogh_reserve_login_challenge(uuid, uuid, uuid, bytea, text, boolean) from public, anon, authenticated;
grant execute on function public.ogh_reserve_login_challenge(uuid, uuid, uuid, bytea, text, boolean) to service_role;

create function public.ogh_finalize_login_delivery(
  p_user_id uuid, p_session_id uuid, p_challenge_id uuid, p_accepted boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_state text;
  v_expires_at timestamptz;
begin
  if p_user_id is null or p_session_id is null or p_challenge_id is null or p_accepted is null then
    return false;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_session_id::text, 729401));
  select c.delivery_state, c.expires_at into v_state, v_expires_at from private.ogh_login_challenges c
    where c.id = p_challenge_id and c.user_id = p_user_id and c.session_id = p_session_id
      and c.consumed_at is null and c.superseded_at is null for update;
  if not found or v_state <> 'reserved' then return false; end if;
  update private.ogh_login_challenges set delivery_state = case when p_accepted and v_now < v_expires_at then 'accepted' else 'unusable' end
    where id = p_challenge_id;
  return true;
end;
$$;
alter function public.ogh_finalize_login_delivery(uuid, uuid, uuid, boolean) owner to postgres;
revoke all on function public.ogh_finalize_login_delivery(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.ogh_finalize_login_delivery(uuid, uuid, uuid, boolean) to service_role;

create function public.ogh_consume_login_challenge(
  p_user_id uuid, p_session_id uuid, p_challenge_id uuid, p_digest bytea
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_challenge private.ogh_login_challenges%rowtype;
begin
  if p_user_id is null or p_session_id is null or p_challenge_id is null or p_digest is null then
    return 'CHALLENGE_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_session_id::text, 729401));
  if not exists (select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user_id for share) then
    return 'SESSION_GONE';
  end if;
  select * into v_challenge from private.ogh_login_challenges c
    where c.id = p_challenge_id and c.user_id = p_user_id and c.session_id = p_session_id for update;
  if not found then return 'CHALLENGE_INVALID'; end if;
  if v_challenge.superseded_at is not null then return 'CHALLENGE_SUPERSEDED'; end if;
  if v_challenge.consumed_at is not null then return 'CHALLENGE_INVALID'; end if;
  if v_challenge.expires_at <= v_now then return 'CHALLENGE_EXPIRED'; end if;
  if v_challenge.attempts >= 5 then return 'CHALLENGE_EXHAUSTED'; end if;
  if v_challenge.delivery_state <> 'accepted' then return 'CHALLENGE_INVALID'; end if;
  if exists (select 1 from private.ogh_verified_sessions v where v.session_id = p_session_id) then
    return 'CHALLENGE_INVALID';
  end if;
  if v_challenge.code_digest <> p_digest then
    update private.ogh_login_challenges set attempts = attempts + 1 where id = p_challenge_id;
    if v_challenge.attempts + 1 >= 5 then return 'CHALLENGE_EXHAUSTED'; end if;
    return 'CHALLENGE_INVALID';
  end if;
  update private.ogh_login_challenges set consumed_at = v_now where id = p_challenge_id;
  insert into private.ogh_verified_sessions (session_id, user_id, verified_at, verification_kind)
    values (p_session_id, p_user_id, v_now, 'login_challenge');
  return 'VERIFIED';
end;
$$;
alter function public.ogh_consume_login_challenge(uuid, uuid, uuid, bytea) owner to postgres;
revoke all on function public.ogh_consume_login_challenge(uuid, uuid, uuid, bytea) from public, anon, authenticated;
grant execute on function public.ogh_consume_login_challenge(uuid, uuid, uuid, bytea) to service_role;

create function public.ogh_activate_signup_session(p_user_id uuid, p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_existing private.ogh_verified_sessions%rowtype;
begin
  if p_user_id is null or p_session_id is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_session_id::text, 729401));
  if not exists (select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user_id for share) then
    return false;
  end if;
  select * into v_existing from private.ogh_verified_sessions v where v.session_id = p_session_id for update;
  if found then
    return v_existing.user_id = p_user_id and v_existing.verification_kind = 'signup' and v_existing.revoked_at is null;
  end if;
  insert into private.ogh_verified_sessions(session_id,user_id,verified_at,verification_kind)
    values (p_session_id,p_user_id,v_now,'signup');
  return true;
end;
$$;
alter function public.ogh_activate_signup_session(uuid, uuid) owner to postgres;
revoke all on function public.ogh_activate_signup_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ogh_activate_signup_session(uuid, uuid) to service_role;

create function public.ogh_revoke_verified_session(p_user_id uuid, p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_existing private.ogh_verified_sessions%rowtype;
begin
  if p_user_id is null or p_session_id is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_session_id::text, 729401));
  if not exists (select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user_id for share) then
    return false;
  end if;
  select * into v_existing from private.ogh_verified_sessions v
    where v.session_id = p_session_id for update;
  if found then
    if v_existing.user_id <> p_user_id then return false; end if;
    update private.ogh_verified_sessions set revoked_at = greatest(v_now, v_existing.verified_at)
      where session_id = p_session_id and revoked_at is null;
  else
    -- A revoked row also closes the gap before provider signout of a pending session.
    insert into private.ogh_verified_sessions (session_id,user_id,verified_at,verification_kind,revoked_at)
      values (p_session_id,p_user_id,v_now,'login_challenge',v_now);
  end if;
  update private.ogh_login_challenges
    set superseded_at = v_now
    where session_id = p_session_id and user_id = p_user_id
      and consumed_at is null and superseded_at is null;
  return true;
end;
$$;
alter function public.ogh_revoke_verified_session(uuid, uuid) owner to postgres;
revoke all on function public.ogh_revoke_verified_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ogh_revoke_verified_session(uuid, uuid) to service_role;

create function public.ogh_record_policy_acceptance(
  p_user_id uuid, p_bundle text, p_terms text, p_privacy text, p_guidelines text, p_source text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_user_id is null or pg_catalog.btrim(coalesce(p_bundle,'')) = ''
     or pg_catalog.btrim(coalesce(p_terms,'')) = ''
     or pg_catalog.btrim(coalesce(p_privacy,'')) = ''
     or pg_catalog.btrim(coalesce(p_guidelines,'')) = ''
     or p_source is null or p_source not in
       ('registration','login','policy_update','legacy_account_gate','authenticated_callback') then
    raise exception 'INVALID_POLICY_ACCEPTANCE' using errcode = '22023';
  end if;
  insert into private.ogh_policy_acceptances (
    user_id,bundle_version,terms_version,privacy_version,guidelines_version,acceptance_source,accepted_at
  ) values (p_user_id,p_bundle,p_terms,p_privacy,p_guidelines,p_source,v_now)
  on conflict (user_id,bundle_version) do update set
    terms_version = excluded.terms_version,
    privacy_version = excluded.privacy_version,
    guidelines_version = excluded.guidelines_version,
    acceptance_source = excluded.acceptance_source,
    accepted_at = excluded.accepted_at;
end;
$$;
alter function public.ogh_record_policy_acceptance(uuid, text, text, text, text, text) owner to postgres;
revoke all on function public.ogh_record_policy_acceptance(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.ogh_record_policy_acceptance(uuid, text, text, text, text, text) to service_role;

create function public.ogh_has_current_policy_acceptance(
  p_bundle text, p_terms text, p_privacy text, p_guidelines text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null or auth.jwt()->>'role' is distinct from 'authenticated'
     or auth.jwt()->>'is_anonymous' is distinct from 'false'
     or p_bundle is null or p_terms is null or p_privacy is null or p_guidelines is null then
    return false;
  end if;
  return exists (
    select 1 from private.ogh_policy_acceptances p
    where p.user_id = v_user_id and p.bundle_version = p_bundle
      and p.terms_version = p_terms and p.privacy_version = p_privacy and p.guidelines_version = p_guidelines
  ) or exists (
    select 1 from public.legal_policy_acceptances p
    where p.user_id = v_user_id and p.bundle_version = p_bundle
      and p.terms_version = p_terms and p.privacy_version = p_privacy and p.guidelines_version = p_guidelines
  );
exception when others then
  return false;
end;
$$;
alter function public.ogh_has_current_policy_acceptance(text, text, text, text) owner to postgres;
revoke all on function public.ogh_has_current_policy_acceptance(text, text, text, text) from public, anon, authenticated;
grant execute on function public.ogh_has_current_policy_acceptance(text, text, text, text) to authenticated;

-- Old and new Workers share this fixed-policy RPC until Enforcement closes the
-- legacy browser-role EXECUTE grants.
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
  to anon, authenticated, service_role;
