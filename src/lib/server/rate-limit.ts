import type { SupabaseClient } from "@supabase/supabase-js";

export type ForumRateLimitPurpose =
  | "post_media_upload"
  | "external_video_upload"
  | "post_create"
  | "comment_create"
  | "circle_create";

function windowStartIso(windowMs: number): string {
  return new Date(Date.now() - windowMs).toISOString();
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { client, userId, ipHash, purpose, maxAttempts, windowMs } = params;
  const { count, error } = await client
    .from("forum_upload_attempts")
    .select("id", { count: "exact", head: true })
    .eq("purpose", purpose)
    .eq("user_id", userId)
    .gte("created_at", windowStartIso(windowMs));

  if (error) {
    return { ok: false, error: error.message };
  }

  if ((count ?? 0) >= maxAttempts) {
    return { ok: false, error: "RATE_LIMITED" };
  }

  const { error: insertError } = await client.from("forum_upload_attempts").insert({
    user_id: userId,
    ip_hash: ipHash,
    bytes: 0,
    purpose,
  });

  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  return { ok: true };
}

export async function enforceUploadRateLimit(params: {
  client: SupabaseClient;
  userId: string;
  ipHash: string;
  purpose: Extract<ForumRateLimitPurpose, "post_media_upload" | "external_video_upload">;
  maxAttempts: number;
  windowMs: number;
  bytes?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { client, userId, ipHash, purpose, maxAttempts, windowMs, bytes = 0 } = params;
  const { count, error } = await client
    .from("forum_upload_attempts")
    .select("id", { count: "exact", head: true })
    .in("purpose", ["post_media_upload", "external_video_upload"])
    .eq("ip_hash", ipHash)
    .gte("created_at", windowStartIso(windowMs));

  if (error) {
    return { ok: false, error: error.message };
  }

  if ((count ?? 0) >= maxAttempts) {
    return { ok: false, error: "RATE_LIMITED" };
  }

  const { error: insertError } = await client.from("forum_upload_attempts").insert({
    user_id: userId,
    ip_hash: ipHash,
    bytes: Math.max(0, bytes),
    purpose,
  });

  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  return { ok: true };
}
