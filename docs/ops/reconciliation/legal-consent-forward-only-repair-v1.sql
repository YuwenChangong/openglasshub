-- UNEXECUTED FORWARD-ONLY REPAIR PROPOSAL.
-- NOT A CANONICAL MIGRATION. NOT APPROVED FOR PRODUCTION.
-- This packet intentionally fails when any target object already exists.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

DO $preflight$
BEGIN
  IF current_schema() IS DISTINCT FROM 'public' THEN
    RAISE EXCEPTION 'legal-consent repair requires public current schema' USING ERRCODE = '3F000';
  END IF;
  IF to_regclass('auth.users') IS NULL OR to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'legal-consent repair prerequisite relation or UUID function is absent' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'postgres')) <> 4 THEN
    RAISE EXCEPTION 'legal-consent repair required role is absent' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.set_updated_at()')
      AND pg_get_userbyid(p.proowner) = 'postgres'
      AND NOT p.prosecdef
      AND p.provolatile = 'v'
      AND p.proparallel = 'u'
      AND coalesce(cardinality(p.proconfig), 0) = 0
      AND md5(regexp_replace(btrim(p.prosrc), '[[:space:]]+', ' ', 'g')) = '077bb7aa35a4fed76f447b242607c205'
  ) THEN
    RAISE EXCEPTION 'legal-consent repair updated_at helper is missing or divergent' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.legal_policy_acceptances') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='legal_policy_acceptances')
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'record_current_legal_policy_acceptance%')
    OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'legal_policy_acceptances%') THEN
    RAISE EXCEPTION 'legal-consent repair target is not wholly absent' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL
    OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260712') THEN
    RAISE EXCEPTION 'legal-consent repair migration-ledger precondition failed' USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

CREATE TABLE public.legal_policy_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bundle_version text NOT NULL,
  terms_version text NOT NULL,
  privacy_version text NOT NULL,
  guidelines_version text NOT NULL,
  minimum_age smallint NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  first_acceptance_source text NOT NULL,
  last_confirmed_at timestamptz NOT NULL DEFAULT now(),
  last_confirmation_source text NOT NULL,
  confirmation_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_policy_acceptances_user_bundle_key UNIQUE (user_id, bundle_version),
  CONSTRAINT legal_policy_acceptances_bundle_version_nonempty CHECK (btrim(bundle_version) <> ''),
  CONSTRAINT legal_policy_acceptances_terms_version_nonempty CHECK (btrim(terms_version) <> ''),
  CONSTRAINT legal_policy_acceptances_privacy_version_nonempty CHECK (btrim(privacy_version) <> ''),
  CONSTRAINT legal_policy_acceptances_guidelines_version_nonempty CHECK (btrim(guidelines_version) <> ''),
  CONSTRAINT legal_policy_acceptances_minimum_age_positive CHECK (minimum_age > 0),
  CONSTRAINT legal_policy_acceptances_confirmation_count_positive CHECK (confirmation_count > 0),
  CONSTRAINT legal_policy_acceptances_confirmation_after_acceptance CHECK (last_confirmed_at >= accepted_at),
  CONSTRAINT legal_policy_acceptances_first_source_check CHECK (first_acceptance_source IN ('registration', 'login', 'policy_update', 'legacy_account_gate', 'authenticated_callback')),
  CONSTRAINT legal_policy_acceptances_last_source_check CHECK (last_confirmation_source IN ('registration', 'login', 'policy_update', 'legacy_account_gate', 'authenticated_callback'))
);
ALTER TABLE public.legal_policy_acceptances OWNER TO postgres;
CREATE INDEX legal_policy_acceptances_bundle_last_confirmed_idx ON public.legal_policy_acceptances USING btree (bundle_version, last_confirmed_at DESC);
ALTER TABLE public.legal_policy_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.legal_policy_acceptances FROM PUBLIC;
REVOKE ALL ON TABLE public.legal_policy_acceptances FROM anon;
REVOKE ALL ON TABLE public.legal_policy_acceptances FROM authenticated;
GRANT SELECT ON TABLE public.legal_policy_acceptances TO authenticated;
CREATE POLICY legal_policy_acceptances_select_own ON public.legal_policy_acceptances FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER trg_legal_policy_acceptances_set_updated_at BEFORE UPDATE ON public.legal_policy_acceptances FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE FUNCTION public.record_current_legal_policy_acceptance(
  p_user_id uuid,
  p_bundle_version text,
  p_terms_version text,
  p_privacy_version text,
  p_guidelines_version text,
  p_minimum_age smallint,
  p_source text
)
RETURNS public.legal_policy_acceptances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  jwt_role text;
  acceptance public.legal_policy_acceptances;
BEGIN
  jwt_role := current_setting('request.jwt.claim.role', true);
  IF current_user <> 'postgres' AND jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'LEGAL_CONSENT_WRITE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL
    OR btrim(coalesce(p_bundle_version, '')) = ''
    OR btrim(coalesce(p_terms_version, '')) = ''
    OR btrim(coalesce(p_privacy_version, '')) = ''
    OR btrim(coalesce(p_guidelines_version, '')) = ''
    OR p_minimum_age IS NULL
    OR p_minimum_age <= 0
    OR p_source NOT IN ('registration', 'login', 'policy_update', 'legacy_account_gate', 'authenticated_callback') THEN
    RAISE EXCEPTION 'LEGAL_CONSENT_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.legal_policy_acceptances (
    user_id, bundle_version, terms_version, privacy_version, guidelines_version,
    minimum_age, first_acceptance_source, last_confirmation_source
  ) VALUES (
    p_user_id, p_bundle_version, p_terms_version, p_privacy_version, p_guidelines_version,
    p_minimum_age, p_source, p_source
  )
  ON CONFLICT (user_id, bundle_version) DO UPDATE
  SET last_confirmed_at = now(),
      last_confirmation_source = excluded.last_confirmation_source,
      confirmation_count = public.legal_policy_acceptances.confirmation_count + 1,
      updated_at = now()
  RETURNING * INTO acceptance;
  RETURN acceptance;
END;
$function$;
ALTER FUNCTION public.record_current_legal_policy_acceptance(uuid,text,text,text,text,smallint,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_current_legal_policy_acceptance(uuid,text,text,text,text,smallint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_current_legal_policy_acceptance(uuid,text,text,text,text,smallint,text) FROM anon;
REVOKE ALL ON FUNCTION public.record_current_legal_policy_acceptance(uuid,text,text,text,text,smallint,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_current_legal_policy_acceptance(uuid,text,text,text,text,smallint,text) TO service_role;

DO $postflight$
BEGIN
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.legal_policy_acceptances'::regclass AND attnum>0 AND NOT attisdropped) <> 14
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.legal_policy_acceptances'::regclass) <> 12
    OR (SELECT count(*) FROM pg_index WHERE indrelid='public.legal_policy_acceptances'::regclass) <> 3
    OR NOT (SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid='public.legal_policy_acceptances'::regclass)
    OR NOT has_table_privilege('authenticated','public.legal_policy_acceptances','SELECT')
    OR EXISTS (SELECT 1 FROM pg_proc f CROSS JOIN LATERAL aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a WHERE f.oid=to_regprocedure('public.record_current_legal_policy_acceptance(uuid,text,text,text,text,smallint,text)') AND a.grantee=0 AND a.privilege_type='EXECUTE')
    OR has_function_privilege('anon','public.record_current_legal_policy_acceptance(uuid,text,text,text,text,smallint,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.record_current_legal_policy_acceptance(uuid,text,text,text,text,smallint,text)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.record_current_legal_policy_acceptance(uuid,text,text,text,text,smallint,text)','EXECUTE')
    OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.record_current_legal_policy_acceptance(uuid,text,text,text,text,smallint,text)') AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='v' AND p.proparallel='u' AND p.proconfig=ARRAY['search_path=public, pg_temp'])
    OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260712') THEN
    RAISE EXCEPTION 'legal-consent repair postcondition failed' USING ERRCODE='55000';
  END IF;
END;
$postflight$;
COMMIT;
