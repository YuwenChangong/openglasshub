import { env as runtimeEnv } from "cloudflare:workers";
import { createClient } from "@supabase/supabase-js";
import type { APIRoute } from "astro";
import { getBearerToken, jsonResponse, type RuntimeEnv } from "../../../lib/server/admin-auth.ts";
import { getLiveProviderSessionUser, getTrustedSessionClaims } from "../../../lib/server/verified-session.server.ts";

export const prerender = false;

export async function handleLogout(request: Request, env: RuntimeEnv): Promise<Response> {
  const token = getBearerToken(request);
  if (!token) return jsonResponse({ error: "INVALID_AUTH" }, 401);

  let claims;
  try {
    claims = await getTrustedSessionClaims(token, env);
    await getLiveProviderSessionUser(token, env, claims);
  } catch (error) {
    if (error instanceof Response && error.status === 401) return jsonResponse({ error: "INVALID_AUTH" }, 401);
    return jsonResponse({ error: "VERIFICATION_SERVICE_UNAVAILABLE" }, 503);
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "VERIFICATION_SERVICE_UNAVAILABLE" }, 503);
  }
  try {
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await client.rpc("ogh_revoke_verified_session", {
      p_user_id: claims.userId,
      p_session_id: claims.sessionId,
    });
    if (result.error || result.data !== true) throw new Error("revocation failed");
    return jsonResponse({ ok: true });
  } catch {
    return jsonResponse({ error: "VERIFICATION_SERVICE_UNAVAILABLE" }, 503);
  }
}

export const POST: APIRoute = ({ request }) => handleLogout(request, runtimeEnv as RuntimeEnv);
export const ALL: APIRoute = () => jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
