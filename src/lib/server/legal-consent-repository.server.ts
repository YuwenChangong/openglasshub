import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  LegalConsentReadRepository,
  LegalConsentRecord,
  LegalConsentWriteRepository,
} from "./legal-consent.server.ts";
import { requireEnv, type RuntimeEnv } from "./admin-auth.ts";

type LegalConsentRow = {
  user_id: string;
  bundle_version: string;
  terms_version: string;
  privacy_version: string;
  guidelines_version: string;
  minimum_age: number;
  last_confirmed_at: string;
};

function toRecord(row: LegalConsentRow): LegalConsentRecord {
  return {
    userId: row.user_id,
    bundleVersion: row.bundle_version,
    termsVersion: row.terms_version,
    privacyVersion: row.privacy_version,
    guidelinesVersion: row.guidelines_version,
    minimumAge: row.minimum_age,
    lastConfirmedAt: row.last_confirmed_at,
  };
}

export function createLegalConsentReadRepository(client: SupabaseClient): LegalConsentReadRepository {
  return {
    async findByUserAndBundle(userId, bundleVersion) {
      const { data, error } = await client
        .from("legal_policy_acceptances")
        .select("user_id,bundle_version,terms_version,privacy_version,guidelines_version,minimum_age,last_confirmed_at")
        .eq("user_id", userId)
        .eq("bundle_version", bundleVersion)
        .maybeSingle();
      if (error) throw new Error("LEGAL_CONSENT_READ_FAILED");
      return data ? toRecord(data as LegalConsentRow) : null;
    },
  };
}

function createLegalConsentWriteClient(env: RuntimeEnv): Pick<SupabaseClient, "rpc"> {
  return createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createLegalConsentWriteRepository(
  env: RuntimeEnv,
  verifiedUserId: string,
): LegalConsentWriteRepository {
  const client = createLegalConsentWriteClient(env);
  return {
    async recordCurrentAcceptance(params) {
      const { error } = await client.rpc("record_current_legal_policy_acceptance", {
        p_user_id: verifiedUserId,
        p_bundle_version: params.bundleVersion,
        p_terms_version: params.termsVersion,
        p_privacy_version: params.privacyVersion,
        p_guidelines_version: params.guidelinesVersion,
        p_minimum_age: params.minimumAge,
        p_source: params.source,
      });
      if (error) throw new Error("LEGAL_CONSENT_WRITE_FAILED");
    },
  };
}
