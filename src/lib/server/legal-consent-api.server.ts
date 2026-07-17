import {
  buildSafeConsentResponse,
  getCurrentConsentStatus,
  isLegalConsentReconfirmationRateLimited,
  isLegalConsentSource,
  recordCurrentLegalConsent,
  type LegalConsentReadRepository,
  type LegalConsentSource,
  type LegalConsentWriteRepository,
} from "./legal-consent.server.ts";

const MAX_LEGAL_CONSENT_BODY_BYTES = 1024;

type LegalConsentAuthContext = {
  userId: string;
  readRepository: LegalConsentReadRepository;
};

export type LegalConsentApiDependencies = {
  authenticate(request: Request): Promise<LegalConsentAuthContext | null>;
  createWriteRepository(verifiedUserId: string): LegalConsentWriteRepository;
  now?: () => number;
};

export function legalConsentJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function parseLegalConsentPostPayload(request: Request): Promise<
  | { ok: true; source: LegalConsentSource }
  | { ok: false; status: 400 | 413 | 415; error: string }
> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { ok: false, status: 415, error: "LEGAL_CONSENT_JSON_REQUIRED" };
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_LEGAL_CONSENT_BODY_BYTES) {
    return { ok: false, status: 413, error: "LEGAL_CONSENT_BODY_TOO_LARGE" };
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return { ok: false, status: 400, error: "LEGAL_CONSENT_INVALID_JSON" };
  }
  if (new TextEncoder().encode(body).byteLength > MAX_LEGAL_CONSENT_BODY_BYTES) {
    return { ok: false, status: 413, error: "LEGAL_CONSENT_BODY_TOO_LARGE" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { ok: false, status: 400, error: "LEGAL_CONSENT_INVALID_JSON" };
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, status: 400, error: "LEGAL_CONSENT_INVALID_PAYLOAD" };
  }

  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || keys.some((key) => key !== "accepted" && key !== "source")) {
    return { ok: false, status: 400, error: "LEGAL_CONSENT_INVALID_FIELDS" };
  }
  if (record.accepted !== true) {
    return { ok: false, status: 400, error: "LEGAL_CONSENT_ACKNOWLEDGEMENT_REQUIRED" };
  }
  if (!isLegalConsentSource(record.source)) {
    return { ok: false, status: 400, error: "LEGAL_CONSENT_INVALID_SOURCE" };
  }

  return { ok: true, source: record.source };
}

export async function handleLegalConsentGet(request: Request, dependencies: LegalConsentApiDependencies): Promise<Response> {
  const auth = await dependencies.authenticate(request);
  if (!auth) return legalConsentJson({ error: "UNAUTHORIZED" }, 401);

  try {
    const status = await getCurrentConsentStatus(auth.readRepository, auth.userId);
    return legalConsentJson(buildSafeConsentResponse(status));
  } catch {
    return legalConsentJson({ error: "LEGAL_CONSENT_UNAVAILABLE" }, 500);
  }
}

export async function handleLegalConsentPost(request: Request, dependencies: LegalConsentApiDependencies): Promise<Response> {
  const auth = await dependencies.authenticate(request);
  if (!auth) return legalConsentJson({ error: "UNAUTHORIZED" }, 401);

  const payload = await parseLegalConsentPostPayload(request);
  if (!payload.ok) return legalConsentJson({ error: payload.error }, payload.status);

  try {
    const status = await getCurrentConsentStatus(auth.readRepository, auth.userId);
    if (isLegalConsentReconfirmationRateLimited(status, dependencies.now?.())) {
      return legalConsentJson({ error: "LEGAL_CONSENT_RATE_LIMITED" }, 429);
    }

    const writeRepository = dependencies.createWriteRepository(auth.userId);
    const activeBundle = await recordCurrentLegalConsent(writeRepository, payload.source);
    return legalConsentJson(buildSafeConsentResponse({ current: true, activeBundle }));
  } catch {
    return legalConsentJson({ error: "LEGAL_CONSENT_UNAVAILABLE" }, 500);
  }
}
