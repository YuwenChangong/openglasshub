import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { requirePasswordProvenSession, sessionIdFromVerifiedJwt } from "../../../../lib/server/application-session.ts";

export const prerender = false;
const CHALLENGE_COOKIE = "ogh_login_challenge";
type Env = Record<string, string | undefined>;
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  try {
    const env = (locals as { runtime?: { env?: Env } }).runtime?.env;
    const body = await request.json().catch(() => null) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const challengeId = cookies.get(CHALLENGE_COOKIE)?.value;
    if (!env?.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY || !challengeId || !/^\d{6}$/.test(token)) return response({ error: "VERIFICATION_FAILED" }, 400);
    const proof = await requirePasswordProvenSession(request, env);
    const { data: challenge, error: challengeError } = await proof.client.rpc("begin_login_email_verification_v1", { p_challenge_id: challengeId });
    const challengeRow = Array.isArray(challenge) ? challenge[0] : null;
    if (challengeError || !challengeRow?.email || challengeRow.user_id !== proof.user.id) return response({ error: "VERIFICATION_FAILED" }, 403);
    const auth = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await auth.auth.verifyOtp({ email: challengeRow.email, token, type: "email" });
    const session = data.session;
    const sessionId = session ? sessionIdFromVerifiedJwt(session.access_token) : null;
    if (error || !session || data.user?.id !== proof.user.id || !sessionId) return response({ error: "VERIFICATION_FAILED" }, 403);
    const activatedClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const expiresAt = typeof session.expires_at === "number" ? new Date(session.expires_at * 1000).toISOString() : null;
    const { data: activated, error: activationError } = await activatedClient.rpc("activate_login_email_session_v1", { p_challenge_id: challengeId, p_session_id: sessionId, p_user_id: data.user.id, p_expires_at: expiresAt });
    if (activationError || activated !== true) return response({ error: "VERIFICATION_FAILED" }, 403);
    cookies.delete(CHALLENGE_COOKIE, { path: "/api/auth/email-verification/" });
    return response({ access_token: session.access_token, refresh_token: session.refresh_token, expires_in: session.expires_in, token_type: session.token_type });
  } catch (error) { if (error instanceof Response) return error; return response({ error: "VERIFICATION_FAILED" }, 403); }
};
export const ALL: APIRoute = () => response({ error: "METHOD_NOT_ALLOWED" }, 405);
