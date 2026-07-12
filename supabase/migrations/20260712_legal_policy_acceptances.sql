-- Versioned legal acknowledgement history. Browser clients may read only their own
-- rows; all writes are intentionally restricted to the authenticated server API.

create table if not exists public.legal_policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bundle_version text not null,
  terms_version text not null,
  privacy_version text not null,
  guidelines_version text not null,
  minimum_age smallint not null,
  accepted_at timestamptz not null default now(),
  first_acceptance_source text not null,
  last_confirmed_at timestamptz not null default now(),
  last_confirmation_source text not null,
  confirmation_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_policy_acceptances_user_bundle_key unique (user_id, bundle_version),
  constraint legal_policy_acceptances_bundle_version_nonempty check (btrim(bundle_version) <> ''),
  constraint legal_policy_acceptances_terms_version_nonempty check (btrim(terms_version) <> ''),
  constraint legal_policy_acceptances_privacy_version_nonempty check (btrim(privacy_version) <> ''),
  constraint legal_policy_acceptances_guidelines_version_nonempty check (btrim(guidelines_version) <> ''),
  constraint legal_policy_acceptances_minimum_age_positive check (minimum_age > 0),
  constraint legal_policy_acceptances_confirmation_count_positive check (confirmation_count > 0),
  constraint legal_policy_acceptances_confirmation_after_acceptance check (last_confirmed_at >= accepted_at),
  constraint legal_policy_acceptances_first_source_check check (
    first_acceptance_source in ('registration', 'login', 'policy_update', 'legacy_account_gate', 'authenticated_callback')
  ),
  constraint legal_policy_acceptances_last_source_check check (
    last_confirmation_source in ('registration', 'login', 'policy_update', 'legacy_account_gate', 'authenticated_callback')
  )
);

create index if not exists legal_policy_acceptances_bundle_last_confirmed_idx
  on public.legal_policy_acceptances (bundle_version, last_confirmed_at desc);

drop trigger if exists trg_legal_policy_acceptances_set_updated_at on public.legal_policy_acceptances;
create trigger trg_legal_policy_acceptances_set_updated_at
before update on public.legal_policy_acceptances
for each row execute function public.set_updated_at();

alter table public.legal_policy_acceptances enable row level security;

-- Direct insert/update/delete is deliberately prohibited. The browser must never be
-- able to supply user IDs, policy versions, timestamps, sources, or counters.
revoke all on table public.legal_policy_acceptances from anon, authenticated;
grant select on table public.legal_policy_acceptances to authenticated;

drop policy if exists "legal_policy_acceptances_select_own" on public.legal_policy_acceptances;
create policy "legal_policy_acceptances_select_own"
on public.legal_policy_acceptances
for select
to authenticated
using (user_id = auth.uid());

create or replace function public.record_current_legal_policy_acceptance(
  p_user_id uuid,
  p_bundle_version text,
  p_terms_version text,
  p_privacy_version text,
  p_guidelines_version text,
  p_minimum_age smallint,
  p_source text
)
returns public.legal_policy_acceptances
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  jwt_role text;
  acceptance public.legal_policy_acceptances;
begin
  jwt_role := current_setting('request.jwt.claim.role', true);
  if current_user <> 'postgres' and jwt_role <> 'service_role' then
    raise exception 'LEGAL_CONSENT_WRITE_FORBIDDEN' using errcode = '42501';
  end if;

  if p_user_id is null
    or btrim(coalesce(p_bundle_version, '')) = ''
    or btrim(coalesce(p_terms_version, '')) = ''
    or btrim(coalesce(p_privacy_version, '')) = ''
    or btrim(coalesce(p_guidelines_version, '')) = ''
    or p_minimum_age is null
    or p_minimum_age <= 0
    or p_source not in ('registration', 'login', 'policy_update', 'legacy_account_gate', 'authenticated_callback') then
    raise exception 'LEGAL_CONSENT_INVALID_INPUT' using errcode = '22023';
  end if;

  insert into public.legal_policy_acceptances (
    user_id,
    bundle_version,
    terms_version,
    privacy_version,
    guidelines_version,
    minimum_age,
    first_acceptance_source,
    last_confirmation_source
  ) values (
    p_user_id,
    p_bundle_version,
    p_terms_version,
    p_privacy_version,
    p_guidelines_version,
    p_minimum_age,
    p_source,
    p_source
  )
  on conflict (user_id, bundle_version) do update
  set last_confirmed_at = now(),
      last_confirmation_source = excluded.last_confirmation_source,
      confirmation_count = public.legal_policy_acceptances.confirmation_count + 1,
      updated_at = now()
  returning * into acceptance;

  return acceptance;
end;
$$;

revoke all on function public.record_current_legal_policy_acceptance(uuid, text, text, text, text, smallint, text)
  from public, anon, authenticated;
grant execute on function public.record_current_legal_policy_acceptance(uuid, text, text, text, text, smallint, text)
  to service_role;
