import { requireCurrentLegalConsent, type LegalConsentReadRepository } from "./legal-consent.server.ts";

export type AuthenticatedMutationIdentity = { userId: string };
export type LegalConsentMutationContext = { identity: AuthenticatedMutationIdentity; repository: LegalConsentReadRepository };

export function legalConsentMutationResponse(error: "UNAUTHORIZED" | "LEGAL_CONSENT_REQUIRED" | "LEGAL_CONSENT_UNAVAILABLE", status: 401 | 403 | 503) {
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
