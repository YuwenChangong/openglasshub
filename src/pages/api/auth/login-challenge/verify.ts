import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { getSafeNext } from "../../../../lib/auth-redirect.ts";
import { getBearerToken, jsonResponse, type RuntimeEnv } from "../../../../lib/server/admin-auth.ts";
import { ChallengeError } from "../../../../lib/server/brevo-challenge.server.ts";
import { verifyChallenge } from "../../../../lib/server/login-challenge.server.ts";

export const prerender = false;

export async function handleVerify(request: Request, env: RuntimeEnv): Promise<Response> {
  const token = getBearerToken(request);
  if (!token) return jsonResponse({ error: "INVALID_AUTH" }, 401);
  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: "INVALID_REQUEST" }, 400); }
  if (typeof body !== "object" || body === null || Array.isArray(body) ||
      Object.keys(body).some((key) => !["challengeId", "code", "next"].includes(key)) ||
      !("challengeId" in body) || typeof body.challengeId !== "string" ||
      !("code" in body) || typeof body.code !== "string" ||
      ("next" in body && typeof body.next !== "string")) {
    return jsonResponse({ error: "INVALID_REQUEST" }, 400);
  }
  try {
    const result = await verifyChallenge({ token, challengeId: body.challengeId, code: body.code }, env);
    return jsonResponse({ ...result, next: getSafeNext("next" in body ? body.next as string : null) });
  } catch (error) {
    if (error instanceof ChallengeError) return jsonResponse({ error: error.code }, error.status);
    return jsonResponse({ error: "VERIFICATION_SERVICE_UNAVAILABLE" }, 503);
  }
}

export const POST: APIRoute = ({ request }) => handleVerify(request, runtimeEnv as RuntimeEnv);
export const ALL: APIRoute = () => jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
