import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  LegalConsentReadRepository,
  LegalConsentRecord,
  LegalConsentWriteRepository,
} from "./legal-consent.server.ts";
import { requireEnv, type RuntimeEnv } from "./admin-auth.ts";

import { LEGAL_POLICY } from "../legal-policy.ts";

export function createLegalConsentReadRepository(client: SupabaseClient): LegalConsentReadRepository {
  return {
    async findByUserAndBundle(userId, bundleVersion) {
      if (bundleVersion !== LEGAL_POLICY.bundleVersion) return null;
      const { data, error } = await client.rpc("ogh_has_current_policy_acceptance", {
        p_bundle: bundleVersion,
        p_terms: LEGAL_POLICY.termsVersion,
        p_privacy: LEGAL_POLICY.privacyVersion,
        p_guidelines: LEGAL_POLICY.guidelinesVersion,
      });
      if (error || typeof data !== "boolean") throw new Error("LEGAL_CONSENT_READ_FAILED");
      return data ? {
        userId,
        bundleVersion,
        termsVersion: LEGAL_POLICY.termsVersion,
        privacyVersion: LEGAL_POLICY.privacyVersion,
        guidelinesVersion: LEGAL_POLICY.guidelinesVersion,
      } satisfies LegalConsentRecord : null;
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
      const { error } = await client.rpc("ogh_record_policy_acceptance", {
        p_user_id: verifiedUserId,
        p_bundle: params.bundleVersion,
        p_terms: params.termsVersion,
        p_privacy: params.privacyVersion,
        p_guidelines: params.guidelinesVersion,
        p_source: params.source,
      });
      if (error) throw new Error("LEGAL_CONSENT_WRITE_FAILED");
    },
  };
}
