import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { getSafeNext } from "../../../../lib/auth-redirect.ts";
import { getBearerToken, jsonResponse, type RuntimeEnv } from "../../../../lib/server/admin-auth.ts";
import { ChallengeError } from "../../../../lib/server/brevo-challenge.server.ts";
import { resendChallenge, startChallenge } from "../../../../lib/server/login-challenge.server.ts";

export const prerender = false;

function failure(error: unknown): Response {
  if (error instanceof ChallengeError) return jsonResponse({ error: error.code }, error.status);
  return jsonResponse({ error: "VERIFICATION_SERVICE_UNAVAILABLE" }, 503);
}

function validIp(value: string | null): value is string {
  if (!value || value !== value.trim()) return false;
  const parts = value.split(".");
  if (parts.length === 4) return parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
  if (!value.includes(":")) return false;
  try {
    return new URL(`http://[${value}]/`).hostname.startsWith("[");
  } catch { return false; }
}

async function ipBudgetHash(request: Request, env: RuntimeEnv): Promise<string> {
  // The Cloudflare edge supplies this header on incoming Worker requests.
  const ip = request.headers.get("cf-connecting-ip");
  const key = env.RATE_LIMIT_SALT;
  if (!validIp(ip) || !key) throw new Error("IP budget unavailable");
  const encoder = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const normalizedIp = ip.includes(":") ? new URL(`http://[${ip}]/`).hostname.slice(1, -1) : ip;
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(`ogh-login-challenge-ip-budget-v1\0${normalizedIp}`)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function handleIssue(request: Request, env: RuntimeEnv, resend: boolean, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const token = getBearerToken(request);
  if (!token) return jsonResponse({ error: "INVALID_AUTH" }, 401);
  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: "INVALID_REQUEST" }, 400); }
  if (typeof body !== "object" || body === null || Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "next") ||
      ("next" in body && typeof body.next !== "string")) {
    return jsonResponse({ error: "INVALID_REQUEST" }, 400);
  }
  try {
    const ipHash = await ipBudgetHash(request, env);
    const result = await (resend ? resendChallenge : startChallenge)({ token, ipHash, body: {} }, env, fetchImpl);
    return jsonResponse({ ...result, next: getSafeNext("next" in body ? body.next as string : null) });
  } catch (error) { return failure(error); }
}

export const handleStart = (request: Request, env: RuntimeEnv, fetchImpl: typeof fetch = fetch) => handleIssue(request, env, false, fetchImpl);
export const POST: APIRoute = ({ request }) => handleStart(request, runtimeEnv as RuntimeEnv);
export const ALL: APIRoute = () => jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
