import {
  consumeForumRateLimit,
  type ConsumeForumRateLimitInput,
  type RateLimitServiceFailureCode,
} from "./consume-forum-rate-limit.server.ts";
import type { RuntimeEnv } from "./admin-auth.ts";

export type ForumRateLimitPurpose = ConsumeForumRateLimitInput["purpose"] | "verification_email_resend";
export type ForumRateLimitResult =
  | { allowed: true; reason: "ALLOWED" }
  | { allowed: false; reason: "RATE_LIMITED" }
  | { allowed: false; reason: Exclude<RateLimitServiceFailureCode, "RATE_LIMIT_MALFORMED_RESULT"> | "RATE_LIMIT_MALFORMED_RESULT" };

export async function hashRateLimitIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function enforceRateLimit(env: RuntimeEnv, input: ConsumeForumRateLimitInput): Promise<ForumRateLimitResult> {
  try {
    return await consumeForumRateLimit(env, input);
  } catch (error) {
    const reason = error instanceof Error && error.name === "RateLimitServiceError"
      ? error.message as RateLimitServiceFailureCode
      : "RATE_LIMIT_SERVICE_UNAVAILABLE";
    return { allowed: false, reason };
  }
}

export function enforceUserRateLimit(params: {
  env: RuntimeEnv;
  userId: string;
  ipHash: string;
  purpose: Extract<ForumRateLimitPurpose, "post_create" | "comment_create" | "circle_create">;
  bytes?: number;
}) {
  return enforceRateLimit(params.env, { userId: params.userId, ipHash: params.ipHash, purpose: params.purpose, bytes: params.bytes ?? 0 });
}

export function enforceUploadRateLimit(params: {
  env: RuntimeEnv;
  userId: string;
  ipHash: string;
  purpose: Extract<ForumRateLimitPurpose, "post_media_upload" | "external_video_upload">;
  bytes: number;
}) {
  return enforceRateLimit(params.env, { userId: params.userId, ipHash: params.ipHash, purpose: params.purpose, bytes: params.bytes });
}
