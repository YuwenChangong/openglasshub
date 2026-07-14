import type { APIRoute } from "astro";
import { jsonResponse, requireModerator, type RuntimeEnv } from "../../../../../lib/server/admin-auth";
import { applyUserSafetyAction, sanitizeSafetyReason } from "../../../../../lib/server/user-safety.server";
import { requireAuthenticatedLegalConsent } from "../../../../../lib/server/legal-consent-mutation.server";
import { createLegalConsentReadRepository } from "../../../../../lib/server/legal-consent-repository.server";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const targetUserId = String(params.id ?? "").trim();
    if (!targetUserId) return jsonResponse({ error: "USER_ID_REQUIRED" }, 400);

    const auth = await requireModerator(request, env);
    const consent = await requireAuthenticatedLegalConsent({
      identity: { userId: auth.user.id },
      repository: createLegalConsentReadRepository(auth.client),
    });
    if (!consent.ok) return consent.response;

    const payload = (await request.json().catch(() => null)) as { reason?: string } | null;
    const reason = sanitizeSafetyReason(payload?.reason);
    if (!reason) return jsonResponse({ error: "REASON_REQUIRED" }, 400);

    const result = await applyUserSafetyAction({
      client: auth.client,
      actorId: auth.user.id,
      targetUserId,
      action: "warn",
      reason,
    });

    if (!result.ok) return jsonResponse({ error: result.error }, result.status);
    return jsonResponse({ state: result.state });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
