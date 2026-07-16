import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { buildR2PublicUrl, buildTmpVideoKey, signR2PutUrl } from "../../../lib/r2-server";
import { getRequestIp } from "../../../lib/request-ip";
import { enforceUploadRateLimit, hashRateLimitIp } from "../../../lib/server/rate-limit";
import { shouldRequireUploadTurnstile, validateTurnstileToken } from "../../../lib/server/turnstile";
import { assertUserCanWrite, getSafetyWriteBlockResponse } from "../../../lib/server/user-safety.server";
import { requireAuthenticatedLegalConsent } from "../../../lib/server/legal-consent-mutation.server";
import { createLegalConsentReadRepository } from "../../../lib/server/legal-consent-repository.server";
import type { PostgrestError } from "@supabase/supabase-js";

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

function formatDbError(stage: string, error: PostgrestError | null): string {
  if (!error) return `[${stage}] Unknown database error`;
  const parts = [
    error.message?.trim() || "Unknown database error",
    error.code ? `code=${error.code}` : "",
    error.details ? `details=${error.details}` : "",
    error.hint ? `hint=${error.hint}` : "",
  ].filter(Boolean);
  return `[${stage}] ${parts.join(" | ")}`;
}

const ACCEPTED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const MAX_VIDEO_SIZE = 150 * 1024 * 1024;

type ExternalVideoUploadDependencies = {
  createClient: typeof createClient;
  buildR2PublicUrl: typeof buildR2PublicUrl;
  buildTmpVideoKey: typeof buildTmpVideoKey;
  signR2PutUrl: typeof signR2PutUrl;
  getRequestIp: typeof getRequestIp;
  enforceUploadRateLimit: typeof enforceUploadRateLimit;
  hashRateLimitIp: typeof hashRateLimitIp;
  shouldRequireUploadTurnstile: typeof shouldRequireUploadTurnstile;
  validateTurnstileToken: typeof validateTurnstileToken;
  assertUserCanWrite: typeof assertUserCanWrite;
  getSafetyWriteBlockResponse: typeof getSafetyWriteBlockResponse;
  requireAuthenticatedLegalConsent: typeof requireAuthenticatedLegalConsent;
  createLegalConsentReadRepository: typeof createLegalConsentReadRepository;
};

const productionDependencies: ExternalVideoUploadDependencies = {
  createClient,
  buildR2PublicUrl,
  buildTmpVideoKey,
  signR2PutUrl,
  getRequestIp,
  enforceUploadRateLimit,
  hashRateLimitIp,
  shouldRequireUploadTurnstile,
  validateTurnstileToken,
  assertUserCanWrite,
  getSafetyWriteBlockResponse,
  requireAuthenticatedLegalConsent,
  createLegalConsentReadRepository,
};

export function createExternalVideoUploadPost(
  dependencies: Partial<ExternalVideoUploadDependencies> = {},
): APIRoute {
  const resolvedDependencies = { ...productionDependencies, ...dependencies };
  const {
    createClient,
    buildR2PublicUrl,
    buildTmpVideoKey,
    signR2PutUrl,
    getRequestIp,
    enforceUploadRateLimit,
    hashRateLimitIp,
    shouldRequireUploadTurnstile,
    validateTurnstileToken,
    assertUserCanWrite,
    getSafetyWriteBlockResponse,
    requireAuthenticatedLegalConsent,
    createLegalConsentReadRepository,
  } = resolvedDependencies;

  return async ({ request, locals }) => {
  let stage = "init";
  try {
    stage = "env";
    const env = (locals as { runtime?: { env?: Record<string, string | undefined> } }).runtime?.env;
    if (!env) return json({ error: "Runtime environment not available" }, 500);

    stage = "auth";
    const token = getBearerToken(request);
    if (!token) return json({ error: "Missing bearer token" }, 401);

    const supabase = createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    stage = "auth.getUser";
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid auth token" }, 401);
    const consent = await requireAuthenticatedLegalConsent({
      identity: { userId: authData.user.id },
      repository: createLegalConsentReadRepository(supabase),
    });
    if (!consent.ok) return consent.response;
    const safetyDecision = await assertUserCanWrite(supabase, authData.user.id, "external_video_upload");
    if (!safetyDecision.allowed) {
      return getSafetyWriteBlockResponse(safetyDecision);
    }

    stage = "payload";
    const payload = (await request.json().catch(() => null)) as
      | { post_id?: string; file_name?: string; mime_type?: string; size_bytes?: number; turnstile_token?: string }
      | null;
    if (!payload) return json({ error: "Invalid JSON payload" }, 400);

    const postId = String(payload.post_id ?? "").trim().toLowerCase();
    const fileNameRaw = String(payload.file_name ?? "").trim();
    const mimeType = String(payload.mime_type ?? "").trim().toLowerCase();
    const sizeBytes = Number(payload.size_bytes ?? 0);
    const remoteIp = getRequestIp(request);

    if (!postId || !/^[0-9a-f-]{36}$/i.test(postId)) return json({ error: "Invalid post_id format" }, 400);
    if (!fileNameRaw) return json({ error: "file_name is required" }, 400);
    if (!ACCEPTED_VIDEO_TYPES.has(mimeType)) return json({ error: "Unsupported video mime type" }, 400);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_VIDEO_SIZE) {
      return json({ error: "Video size exceeds current upload limit" }, 400);
    }

    stage = "post.lookup";
    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("id, author_id")
      .eq("id", postId)
      .maybeSingle();
    if (postError) return json({ error: formatDbError(stage, postError) }, 500);
    if (!post) return json({ error: "Post not found" }, 404);

    stage = "post.authorize";
    if (post.author_id !== authData.user.id) return json({ error: "Cannot upload media for a post you do not own" }, 403);

    stage = "key.build";
    const objectKey = buildTmpVideoKey(authData.user.id, postId, fileNameRaw);

    stage = "turnstile";
    if (shouldRequireUploadTurnstile({ env, uploadKind: "post_media", sizeBytes })) {
      const turnstile = await validateTurnstileToken({
        env,
        token: String(payload.turnstile_token ?? "").trim(),
        remoteIp,
      });
      if (!turnstile.ok) {
        return json({ error: turnstile.code, code: turnstile.code }, 400);
      }
    }

    stage = "rate.ip";
    const rateSalt = requireEnv(env, "RATE_LIMIT_SALT");
    const ipHash = await hashRateLimitIp(remoteIp, rateSalt);
    stage = "rate.consume";
    const uploadLimit = await enforceUploadRateLimit({
      env,
      userId: authData.user.id,
      ipHash,
      purpose: "external_video_upload",
      bytes: sizeBytes,
    });
    if (!uploadLimit.allowed) {
      if (uploadLimit.reason === "RATE_LIMITED") return json({ error: "Too many upload attempts from this IP", code: "RATE_LIMITED" }, 429);
      return json({ error: "Rate limit service temporarily unavailable", code: uploadLimit.reason }, 503);
    }

    stage = "r2.sign";
    const uploadUrl = await signR2PutUrl({
      env,
      objectKey,
      contentType: mimeType,
    });

    return json({
      upload_url: uploadUrl,
      media_url: buildR2PublicUrl(env, objectKey),
      storage_path: objectKey,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? (error.message?.trim() || error.name || "Unexpected server error")
        : "Unexpected server error";
    return json({ error: `[${stage}] ${message}` }, 500);
  }
};
}

export const POST: APIRoute = createExternalVideoUploadPost();

export const ALL: APIRoute = () => json({ error: "Method not allowed" }, 405);
