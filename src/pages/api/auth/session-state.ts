import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { createUserClient, getBearerToken, jsonResponse, type RuntimeEnv } from "../../../lib/server/admin-auth.ts";
import { requireCurrentPolicyConsent } from "../../../lib/server/legal-consent-mutation.server.ts";
import { getLiveProviderSessionUser, getTrustedSessionClaims } from "../../../lib/server/verified-session.server.ts";

export const prerender = false;

export async function handleSessionState(request: Request, env: RuntimeEnv): Promise<Response> {
  const token = getBearerToken(request);
  if (!token) return jsonResponse({ state: "ANONYMOUS", policy: "UNAVAILABLE" });

  try {
    const claims = await getTrustedSessionClaims(token, env);
    await getLiveProviderSessionUser(token, env, claims);
  } catch (error) {
    if (error instanceof Response && error.status === 401) {
      return jsonResponse({ state: "ANONYMOUS", policy: "UNAVAILABLE" });
    }
    return jsonResponse({ error: "VERIFICATION_SERVICE_UNAVAILABLE" }, 503);
  }

  const client = createUserClient(env, token);
  try {
    const verification = await client.rpc("ogh_is_verified_session");
    if (verification.error || typeof verification.data !== "boolean") throw new Error("verification unavailable");

    let policy: "CURRENT" | "NEEDS_ACCEPTANCE" | "UNAVAILABLE" = "UNAVAILABLE";
    try {
      policy = await requireCurrentPolicyConsent(client) ? "CURRENT" : "NEEDS_ACCEPTANCE";
    } catch {
      // Policy availability does not change the verified-session state.
    }
    return jsonResponse({
      state: verification.data ? "VERIFIED_AUTHENTICATED" : "PENDING_VERIFICATION",
      policy,
    });
  } catch {
    return jsonResponse({ error: "VERIFICATION_SERVICE_UNAVAILABLE" }, 503);
  }
}

export const GET: APIRoute = ({ request }) => handleSessionState(request, runtimeEnv as RuntimeEnv);
export const ALL: APIRoute = () => jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
