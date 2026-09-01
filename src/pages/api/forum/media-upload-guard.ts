import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { getRequestIp } from "../../../lib/request-ip";
import { enforceUploadRateLimit, hashRateLimitIp } from "../../../lib/server/rate-limit";
import { shouldRequireUploadTurnstile, validateTurnstileToken } from "../../../lib/server/turnstile";
import { assertUserCanWrite, getSafetyWriteBlockResponse } from "../../../lib/server/user-safety.server";

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
    const env = runtimeEnv;
    if (!env) return json({ error: "Runtime environment not available" }, 500);

    const token = getBearerToken(request);
    if (!token) return json({ error: "Missing bearer token" }, 401);

    const supabase = createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid auth token" }, 401);

    const payload = (await request.json().catch(() => null)) as
      | { upload_kind?: string; size_bytes?: number; turnstile_token?: string }
      | null;
    if (!payload) return json({ error: "Invalid JSON payload" }, 400);

    const uploadKind = String(payload.upload_kind ?? "").trim();
    if (!["post_media", "circle_cover", "profile_avatar", "profile_banner"].includes(uploadKind)) {
      return json({ error: "Invalid upload_kind" }, 400);
    }
    const sizeBytes = Number(payload.size_bytes ?? 0);
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
      client: supabase,
      userId: authData.user.id,
      ipHash,
      purpose: "post_media_upload",
      maxAttempts: 10,
      windowMs: 60 * 60 * 1000,
      bytes: sizeBytes,
    });

    if (!limit.allowed) {
      if (limit.reason === "RATE_LIMITED") {
        return json({ error: "Too many upload requests", code: "RATE_LIMITED" }, 429);
      }
    }

    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => json({ error: "Method not allowed" }, 405);
