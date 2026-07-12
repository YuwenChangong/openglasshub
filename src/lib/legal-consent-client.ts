import type { LegalConsentSource } from "./server/legal-consent.server";

export type LegalConsentStatus = {
  current: boolean;
  bundleVersion: string;
  minimumAge: number;
  consentUrl: string;
};

export class LegalConsentClientError extends Error {
  constructor(public readonly code: "UNAUTHORIZED" | "RATE_LIMITED" | "UNAVAILABLE" | "INVALID_RESPONSE") {
    super(code);
  }
}

async function parseResponse(response: Response): Promise<LegalConsentStatus> {
  const payload = await response.json().catch(() => null) as LegalConsentStatus | null;
  if (!response.ok) {
    if (response.status === 401) throw new LegalConsentClientError("UNAUTHORIZED");
    if (response.status === 429) throw new LegalConsentClientError("RATE_LIMITED");
    throw new LegalConsentClientError("UNAVAILABLE");
  }
  if (!payload || typeof payload.current !== "boolean" || typeof payload.bundleVersion !== "string" || typeof payload.minimumAge !== "number" || typeof payload.consentUrl !== "string") {
    throw new LegalConsentClientError("INVALID_RESPONSE");
  }
  return payload;
}

function authorizationHeaders(accessToken: string, json = false): HeadersInit {
  return {
    authorization: `Bearer ${accessToken}`,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

export async function getLegalConsentStatus(accessToken: string): Promise<LegalConsentStatus> {
  return parseResponse(await fetch("/api/legal/consent", { headers: authorizationHeaders(accessToken) }));
}

export async function recordLegalConsent(params: { accessToken: string; source: LegalConsentSource }): Promise<LegalConsentStatus> {
  return parseResponse(await fetch("/api/legal/consent", {
    method: "POST",
    headers: authorizationHeaders(params.accessToken, true),
    body: JSON.stringify({ accepted: true, source: params.source }),
  }));
}
