import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { getRequestIp } from "../../../lib/request-ip";
import { enforceUploadRateLimit, hashRateLimitIp } from "../../../lib/server/rate-limit";
import { shouldRequireUploadTurnstile, validateTurnstileToken } from "../../../lib/server/turnstile";
import { assertUserCanWrite, getSafetyWriteBlockResponse } from "../../../lib/server/user-safety.server";
import { requireAuthenticatedLegalConsent } from "../../../lib/server/legal-consent-mutation.server";
import { createLegalConsentReadRepository } from "../../../lib/server/legal-consent-repository.server";
import { requireVerifiedApplicationSession } from "../../../lib/server/application-session.ts";

export const prerender = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as { runtime?: { env?: Record<string, string | undefined> } }).runtime?.env;
    if (!env) return json({ error: "Runtime environment not available" }, 500);

    const token = getBearerToken(request);
    if (!token) return json({ error: "Missing bearer token" }, 401);

    let verified;
    try {
      verified = await requireVerifiedApplicationSession(request, env);
    } catch (error) {
      return error instanceof Response ? error : json({ error: "Invalid auth token" }, 401);
    }
    const supabase = verified.client;
    const authData = { user: verified.user };

    const consent = await requireAuthenticatedLegalConsent({
      identity: { userId: authData.user.id },
      repository: createLegalConsentReadRepository(supabase),
    });
    if (!consent.ok) return consent.response;

    const payload = (await request.json().catch(() => null)) as
      | { upload_kind?: string; size_bytes?: number; turnstile_token?: string }
      | null;
    if (!payload) return json({ error: "Invalid JSON payload" }, 400);

    const uploadKind = String(payload.upload_kind ?? "").trim();
    if (!["post_media", "circle_cover", "profile_avatar", "profile_banner"].includes(uploadKind)) {
      return json({ error: "Invalid upload_kind" }, 400);
    }
    const sizeBytes = Number(payload.size_bytes ?? 0);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 157286400) {
      return json({ error: "Invalid upload size" }, 400);
    }
    const safetyDecision = await assertUserCanWrite(supabase, authData.user.id, "media_upload");
    if (!safetyDecision.allowed) {
      return getSafetyWriteBlockResponse(safetyDecision);
    }

    if (shouldRequireUploadTurnstile({ env, uploadKind, sizeBytes })) {
      const turnstile = await validateTurnstileToken({
        env,
        token: String(payload.turnstile_token ?? "").trim(),
        remoteIp: getRequestIp(request),
      });
      if (!turnstile.ok) {
        return json({ error: turnstile.code, code: turnstile.code }, 400);
      }
    }

    const salt = requireEnv(env, "RATE_LIMIT_SALT");
    const ipHash = await hashRateLimitIp(getRequestIp(request), salt);
    const limit = await enforceUploadRateLimit({
      env,
      userId: authData.user.id,
      ipHash,
      purpose: "post_media_upload",
      bytes: sizeBytes,
    });

    if (!limit.allowed) {
      if (limit.reason === "RATE_LIMITED") return json({ error: "Too many upload requests", code: "RATE_LIMITED" }, 429);
      return json({ error: "Rate limit service temporarily unavailable", code: limit.reason }, 503);
    }

    return json({ ok: true });
  } catch {
    return json({ error: "UPLOAD_GUARD_FAILED" }, 500);
  }
};

export const ALL: APIRoute = () => json({ error: "Method not allowed" }, 405);
