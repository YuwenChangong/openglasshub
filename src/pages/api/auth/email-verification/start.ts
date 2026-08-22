import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { getRequestIp } from "../../../../lib/request-ip";
import { requirePasswordProvenSession } from "../../../../lib/server/application-session.ts";
import { hashRateLimitIp } from "../../../../lib/server/rate-limit";

export const prerender = false;
const CHALLENGE_COOKIE = "ogh_login_challenge";
type Env = Record<string, string | undefined>;
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
function envOf(locals: unknown): Env | undefined { return (locals as { runtime?: { env?: Env } }).runtime?.env; }
function maskEmail(email: string) { const [local, domain] = email.split("@"); return `${local.slice(0, 1)}***@${domain ?? ""}`; }
function cookieOptions(request: Request) {
  const url = new URL(request.url);
  const localLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  return { httpOnly: true, sameSite: "lax" as const, secure: url.protocol === "https:" && !localLoopback, path: "/api/auth/email-verification/", maxAge: 10 * 60 };
}

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  try {
    const env = envOf(locals);
    if (!env?.RATE_LIMIT_SALT) return response({ error: "AUTH_UNAVAILABLE" }, 503);
    const body = await request.json().catch(() => null) as { captchaToken?: unknown } | null;
    const captchaToken = typeof body?.captchaToken === "string" ? body.captchaToken : "";
    if (!captchaToken) return response({ error: "CAPTCHA_REQUIRED" }, 400);
    const proof = await requirePasswordProvenSession(request, env);
    const email = proof.user.email?.trim().toLowerCase();
    if (!email || !proof.user.email_confirmed_at) return response({ error: "AUTHENTICATION_FAILED" }, 403);
    const ipHash = await hashRateLimitIp(getRequestIp(request), env.RATE_LIMIT_SALT);
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return response({ error: "AUTH_UNAVAILABLE" }, 503);
    const serverClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: challengeId, error: challengeError } = await serverClient.rpc("create_login_email_challenge_v1", {
      p_user_id: proof.user.id, p_password_session_id: proof.sessionId, p_email: email, p_request_ip_hash: ipHash,
    });
    if (challengeError || typeof challengeId !== "string") return response({ error: "AUTHENTICATION_FAILED" }, 403);
    const { error: otpError } = await proof.client.auth.signInWithOtp({ email, options: { shouldCreateUser: false, captchaToken } });
    if (otpError) return response({ error: "OTP_DELIVERY_UNAVAILABLE" }, 503);
    cookies.set(CHALLENGE_COOKIE, challengeId, cookieOptions(request));
    return response({ ok: true, destination: maskEmail(email), expiresInSeconds: 600, resendAfterSeconds: 60 });
  } catch (error) {
    if (error instanceof Response) return error;
    return response({ error: "AUTHENTICATION_FAILED" }, 401);
  }
};
export const ALL: APIRoute = () => response({ error: "METHOD_NOT_ALLOWED" }, 405);
