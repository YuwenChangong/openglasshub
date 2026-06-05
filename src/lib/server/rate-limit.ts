import type { SupabaseClient } from "@supabase/supabase-js";

export type ForumRateLimitPurpose =
  | "post_media_upload"
  | "external_video_upload"
  | "post_create"
  | "comment_create"
  | "circle_create";

export type ForumRateLimitResult =
  | {
      allowed: true;
      backendAvailable: true;
    }
  | {
      allowed: false;
      backendAvailable: true;
      reason: "RATE_LIMITED";
    }
  | {
      allowed: true;
      backendAvailable: false;
      reason: "RATE_LIMIT_BACKEND_UNAVAILABLE";
      details: string;
    };

function windowStartIso(windowMs: number): string {
  return new Date(Date.now() - windowMs).toISOString();
}

function normalizeBytes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.max(0, Math.trunc(parsed));
}

function sanitizeRateLimitError(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 240);
}

function backendUnavailableResult(purpose: ForumRateLimitPurpose, message: string): ForumRateLimitResult {
  const sanitizedMessage = sanitizeRateLimitError(message);
  console.warn("[rate-limit] backend unavailable", {
    purpose,
    message: sanitizedMessage,
  });
  return {
    allowed: true,
    backendAvailable: false,
    reason: "RATE_LIMIT_BACKEND_UNAVAILABLE",
    details: sanitizedMessage,
  };
}

export async function hashRateLimitIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function enforceUserRateLimit(params: {
  client: SupabaseClient;
  userId: string;
  ipHash: string;
  purpose: Extract<ForumRateLimitPurpose, "post_create" | "comment_create" | "circle_create">;
  maxAttempts: number;
  windowMs: number;
  bytes?: number;
}): Promise<ForumRateLimitResult> {
  const { client, userId, ipHash, purpose, maxAttempts, windowMs, bytes = 0 } = params;
  const { count, error } = await client
    .from("forum_upload_attempts")
    .select("id", { count: "exact", head: true })
    .eq("purpose", purpose)
    .eq("user_id", userId)
    .gte("created_at", windowStartIso(windowMs));

  if (error) {
    return backendUnavailableResult(purpose, error.message);
  }

  if ((count ?? 0) >= maxAttempts) {
    return { allowed: false, backendAvailable: true, reason: "RATE_LIMITED" };
  }

  const { error: insertError } = await client.from("forum_upload_attempts").insert({
    user_id: userId,
    ip_hash: ipHash,
    bytes: normalizeBytes(bytes),
    purpose,
  });

  if (insertError) {
    return backendUnavailableResult(purpose, insertError.message);
  }

  return { allowed: true, backendAvailable: true };
}

export async function enforceUploadRateLimit(params: {
  client: SupabaseClient;
  userId: string;
  ipHash: string;
  purpose: Extract<ForumRateLimitPurpose, "post_media_upload" | "external_video_upload">;
  maxAttempts: number;
  windowMs: number;
  bytes?: number;
}): Promise<ForumRateLimitResult> {
  const { client, userId, ipHash, purpose, maxAttempts, windowMs, bytes = 0 } = params;
  const { count, error } = await client
    .from("forum_upload_attempts")
    .select("id", { count: "exact", head: true })
    .in("purpose", ["post_media_upload", "external_video_upload"])
    .eq("ip_hash", ipHash)
    .gte("created_at", windowStartIso(windowMs));

  if (error) {
    return backendUnavailableResult(purpose, error.message);
  }

  if ((count ?? 0) >= maxAttempts) {
    return { allowed: false, backendAvailable: true, reason: "RATE_LIMITED" };
  }

  const { error: insertError } = await client.from("forum_upload_attempts").insert({
    user_id: userId,
    ip_hash: ipHash,
    bytes: normalizeBytes(bytes),
    purpose,
  });

  if (insertError) {
    return backendUnavailableResult(purpose, insertError.message);
  }

  return { allowed: true, backendAvailable: true };
}
