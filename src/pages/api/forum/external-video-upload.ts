import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { buildR2PublicUrl, buildTmpVideoKey, signR2PutUrl } from "../../../lib/r2-server";
import { getRequestIp } from "../../../lib/request-ip";
import { enforceUploadRateLimit, hashRateLimitIp } from "../../../lib/server/rate-limit";
import { validateTurnstileToken } from "../../../lib/server/turnstile";
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

export const POST: APIRoute = async ({ request, locals }) => {
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

    stage = "payload";
    const payload = (await request.json().catch(() => null)) as
      | { post_id?: string; file_name?: string; mime_type?: string; size_bytes?: number; turnstile_token?: string }
      | null;
    if (!payload) return json({ error: "Invalid JSON payload" }, 400);

    const postId = String(payload.post_id ?? "").trim();
    const fileNameRaw = String(payload.file_name ?? "").trim();
    const mimeType = String(payload.mime_type ?? "").trim().toLowerCase();
    const sizeBytes = Number(payload.size_bytes ?? 0);
    const turnstileToken = String(payload.turnstile_token ?? "").trim();
    const remoteIp = getRequestIp(request);

    stage = "turnstile";
    const turnstile = await validateTurnstileToken({
      env,
      token: turnstileToken,
      remoteIp,
    });
    if (!turnstile.ok) {
      return json({ error: turnstile.message ?? "Turnstile verification failed", code: turnstile.code }, 403);
    }

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
    if (post.author_id !== authData.user.id) return json({ error: "Cannot upload media for a post you do not own" }, 403);

    stage = "rate.ip";
    const previewBypass = env.DEV_TURNSTILE_BYPASS === "true";
    let ipHash = "";
    if (!previewBypass) {
      const rateSalt = requireEnv(env, "RATE_LIMIT_SALT");
      ipHash = await hashRateLimitIp(remoteIp, rateSalt);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      stage = "rate.daily.attempts";
      const { data: dailyRows, error: dailyError } = await supabase
        .from("forum_upload_attempts")
        .select("bytes")
        .eq("user_id", authData.user.id)
        .gte("created_at", oneDayAgo);
      if (dailyError) {
        console.warn("[rate-limit] backend unavailable", {
          purpose: "external_video_upload",
          message: formatDbError(stage, dailyError),
        });
      }
      const usedAttemptBytes = dailyError ? 0 : (dailyRows ?? []).reduce((sum, row) => sum + Number(row.bytes ?? 0), 0);

      stage = "rate.daily.media";
      const { data: mediaRows, error: mediaBytesError } = await supabase
        .from("post_media")
        .select("size_bytes")
        .eq("user_id", authData.user.id)
        .gte("created_at", oneDayAgo);
      if (mediaBytesError) return json({ error: formatDbError(stage, mediaBytesError) }, 500);
      const usedMediaBytes = (mediaRows ?? []).reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0);
      const usedBytes = Math.max(usedAttemptBytes, usedMediaBytes);
      if (usedBytes + sizeBytes > 300 * 1024 * 1024) {
        return json({ error: "Daily upload limit exceeded", code: "DAILY_UPLOAD_LIMIT_EXCEEDED" }, 429);
      }
    }

    stage = "r2.sign";
    const objectKey = buildTmpVideoKey(authData.user.id, fileNameRaw);
    const uploadUrl = await signR2PutUrl({
      env,
      objectKey,
      contentType: mimeType,
    });

    if (!previewBypass) {
      stage = "attempt.insert";
      const uploadLimit = await enforceUploadRateLimit({
        client: supabase,
        userId: authData.user.id,
        ipHash,
        purpose: "external_video_upload",
        maxAttempts: 10,
        windowMs: 60 * 60 * 1000,
        bytes: sizeBytes,
      });
      if (!uploadLimit.allowed) {
        if (uploadLimit.reason === "RATE_LIMITED") {
          return json({ error: "Too many upload attempts from this IP", code: "RATE_LIMITED" }, 429);
        }
      }
    }

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

export const ALL: APIRoute = () => json({ error: "Method not allowed" }, 405);
