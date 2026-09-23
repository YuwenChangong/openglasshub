import { requireCurrentLegalConsent, type LegalConsentReadRepository } from "./legal-consent.server.ts";
import { requireVerifiedSession } from "./verified-session.server.ts";
import type { RuntimeEnv } from "./admin-auth.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LEGAL_POLICY } from "../legal-policy.ts";

export type AuthenticatedMutationIdentity = { userId: string };
export type LegalConsentMutationContext = { identity: AuthenticatedMutationIdentity; repository: LegalConsentReadRepository };

export function legalConsentMutationResponse(error: "UNAUTHORIZED" | "LEGAL_CONSENT_REQUIRED" | "LEGAL_CONSENT_UNAVAILABLE" | "INVALID_AUTH" | "VERIFICATION_REQUIRED" | "VERIFICATION_SERVICE_UNAVAILABLE", status: 401 | 403 | 503) {
  return new Response(JSON.stringify(error === "LEGAL_CONSENT_REQUIRED" ? { error, consentUrl: "/legal-consent/" } : { error }), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

export async function requireAuthenticatedLegalConsent(context: LegalConsentMutationContext | null): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  if (!context?.identity.userId) return { ok: false, response: legalConsentMutationResponse("UNAUTHORIZED", 401) };
  try {
    const consent = await requireCurrentLegalConsent(context.repository, context.identity.userId);
    return consent.ok ? { ok: true, userId: context.identity.userId } : { ok: false, response: legalConsentMutationResponse("LEGAL_CONSENT_REQUIRED", 403) };
  } catch {
    return { ok: false, response: legalConsentMutationResponse("LEGAL_CONSENT_UNAVAILABLE", 503) };
  }
}

export async function requireCurrentPolicyConsent(client: Pick<SupabaseClient, "rpc">): Promise<boolean> {
  const { data, error } = await client.rpc("ogh_has_current_policy_acceptance", {
    p_bundle: LEGAL_POLICY.bundleVersion,
    p_terms: LEGAL_POLICY.termsVersion,
    p_privacy: LEGAL_POLICY.privacyVersion,
    p_guidelines: LEGAL_POLICY.guidelinesVersion,
  });
  if (error || typeof data !== "boolean") throw new Error("POLICY_CONSENT_UNAVAILABLE");
  return data;
}

export async function requireVerifiedLegalConsentMutation(
  request: Request,
  env: RuntimeEnv,
): ReturnType<typeof requireAuthenticatedLegalConsent> {
  let session;
  try {
    session = await requireVerifiedSession(request, env);
  } catch (error) {
    if (error instanceof Response) {
      const code = error.status === 401 ? "INVALID_AUTH" : error.status === 403 ? "VERIFICATION_REQUIRED" : "VERIFICATION_SERVICE_UNAVAILABLE";
      return { ok: false, response: legalConsentMutationResponse(code, error.status as 401 | 403 | 503) };
    }
    return { ok: false, response: legalConsentMutationResponse("VERIFICATION_SERVICE_UNAVAILABLE", 503) };
  }
  try {
    return await requireCurrentPolicyConsent(session.client)
      ? { ok: true, userId: session.claims.userId }
      : { ok: false, response: legalConsentMutationResponse("LEGAL_CONSENT_REQUIRED", 403) };
  } catch {
    return { ok: false, response: legalConsentMutationResponse("LEGAL_CONSENT_UNAVAILABLE", 503) };
  }
}
