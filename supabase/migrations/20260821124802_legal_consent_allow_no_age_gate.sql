-- `minimum_age = 0` explicitly records that the current legal bundle has no age gate.
alter table public.legal_policy_acceptances
  drop constraint if exists legal_policy_acceptances_minimum_age_positive;

alter table public.legal_policy_acceptances
  add constraint legal_policy_acceptances_minimum_age_nonnegative
  check (minimum_age >= 0);

create or replace function public.record_current_legal_policy_acceptance(
  p_user_id uuid, p_bundle_version text, p_terms_version text, p_privacy_version text,
  p_guidelines_version text, p_minimum_age smallint, p_source text
)
returns public.legal_policy_acceptances
language plpgsql security definer set search_path = public, pg_temp as $$
declare jwt_role text; acceptance public.legal_policy_acceptances;
begin
  jwt_role := current_setting('request.jwt.claim.role', true);
  if current_user <> 'postgres' and jwt_role <> 'service_role' then raise exception 'LEGAL_CONSENT_WRITE_FORBIDDEN' using errcode = '42501'; end if;
  if p_user_id is null or btrim(coalesce(p_bundle_version, '')) = '' or btrim(coalesce(p_terms_version, '')) = ''
    or btrim(coalesce(p_privacy_version, '')) = '' or btrim(coalesce(p_guidelines_version, '')) = ''
    or p_minimum_age is null or p_minimum_age < 0
    or p_source not in ('registration', 'login', 'policy_update', 'legacy_account_gate', 'authenticated_callback') then
    raise exception 'LEGAL_CONSENT_INVALID_INPUT' using errcode = '22023';
  end if;
  insert into public.legal_policy_acceptances (user_id,bundle_version,terms_version,privacy_version,guidelines_version,minimum_age,first_acceptance_source,last_confirmation_source)
  values (p_user_id,p_bundle_version,p_terms_version,p_privacy_version,p_guidelines_version,p_minimum_age,p_source,p_source)
  on conflict (user_id,bundle_version) do update set last_confirmed_at=now(),last_confirmation_source=excluded.last_confirmation_source,confirmation_count=public.legal_policy_acceptances.confirmation_count+1,updated_at=now()
  returning * into acceptance;
  return acceptance;
end;
$$;

revoke all on function public.record_current_legal_policy_acceptance(uuid, text, text, text, text, smallint, text) from public, anon, authenticated;
grant execute on function public.record_current_legal_policy_acceptance(uuid, text, text, text, text, smallint, text) to service_role;
