create schema if not exists private;
alter schema private owner to postgres;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

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
  from public, anon, authenticated;
grant select, insert, update, delete on table private.ogh_verified_sessions,
  private.ogh_login_challenges, private.ogh_email_send_budget,
  private.ogh_policy_acceptances to service_role;

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
