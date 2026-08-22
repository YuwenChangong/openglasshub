import type { APIRoute } from "astro";
import { requirePasswordProvenSession } from "../../../../lib/server/application-session.ts";

export const prerender = false;
const CHALLENGE_COOKIE = "ogh_login_challenge";
type Env = Record<string, string | undefined>;
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  try {
    const env = (locals as { runtime?: { env?: Env } }).runtime?.env;
    const body = await request.json().catch(() => null) as { captchaToken?: unknown } | null;
    const captchaToken = typeof body?.captchaToken === "string" ? body.captchaToken : "";
    if (!env || !captchaToken) return response({ error: "CAPTCHA_REQUIRED" }, 400);
    const challengeId = cookies.get(CHALLENGE_COOKIE)?.value;
    if (!challengeId) return response({ error: "CHALLENGE_UNAVAILABLE" }, 403);
    const proof = await requirePasswordProvenSession(request, env);
    const { data: email, error: reserveError } = await proof.client.rpc("reserve_login_email_challenge_resend_v1", { p_challenge_id: challengeId });
    if (reserveError || typeof email !== "string") return response({ error: "RESEND_UNAVAILABLE" }, 429);
    const { error } = await proof.client.auth.signInWithOtp({ email, options: { shouldCreateUser: false, captchaToken } });
    if (error) return response({ error: "OTP_DELIVERY_UNAVAILABLE" }, 503);
    return response({ ok: true, resendAfterSeconds: 60 });
  } catch (error) { if (error instanceof Response) return error; return response({ error: "RESEND_UNAVAILABLE" }, 403); }
};
export const ALL: APIRoute = () => response({ error: "METHOD_NOT_ALLOWED" }, 405);
