import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { LEGAL_POLICY } from "../../../lib/legal-policy.ts";
import { jsonResponse, requireEnv, type RuntimeEnv } from "../../../lib/server/admin-auth.ts";
import { getCurrentConfirmedAuthUser, getTrustedSessionClaims } from "../../../lib/server/verified-session.server.ts";

export const prerender = false;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const codePattern = /^\d{6}$/;
const keys = ["email", "code", "acceptedPolicies", "policyVersions"];
const versionKeys = ["bundle", "terms", "privacy", "guidelines"];

function validRequest(request: Request): boolean {
  const url = new URL(request.url);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  return (url.protocol === "https:" || local) && request.headers.get("origin") === url.origin &&
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json";
}

function validBody(value: unknown): value is { email: string; code: string; acceptedPolicies: true } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== keys.length || Object.keys(body).some((key) => !keys.includes(key)) ||
      typeof body.email !== "string" || body.email.length > 254 || !emailPattern.test(body.email.trim()) ||
      typeof body.code !== "string" || !codePattern.test(body.code) || body.acceptedPolicies !== true) return false;
  const versions = body.policyVersions;
  if (!versions || typeof versions !== "object" || Array.isArray(versions)) return false;
  const supplied = versions as Record<string, unknown>;
  return Object.keys(supplied).length === versionKeys.length &&
    Object.keys(supplied).every((key) => versionKeys.includes(key)) &&
    supplied.bundle === LEGAL_POLICY.bundleVersion && supplied.terms === LEGAL_POLICY.termsVersion &&
    supplied.privacy === LEGAL_POLICY.privacyVersion && supplied.guidelines === LEGAL_POLICY.guidelinesVersion;
}

export async function handleSignupConfirm(request: Request, env: RuntimeEnv): Promise<Response> {
  if (!validRequest(request)) return jsonResponse({ error: "INVALID_REQUEST" }, 400);
  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: "INVALID_REQUEST" }, 400); }
  if (!validBody(body)) return jsonResponse({ error: "INVALID_REQUEST" }, 400);

  const email = body.email.trim().toLowerCase();
  try {
    const anon = createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon.auth.verifyOtp({ email, token: body.code, type: "signup" });
    const session = data?.session;
    if (error || !session?.access_token || !session.refresh_token || !data.user ||
        data.user.id !== session.user.id || data.user.email?.trim().toLowerCase() !== email) {
      return jsonResponse({ error: "SIGNUP_CONFIRMATION_FAILED" }, 400);
    }

    const claims = await getTrustedSessionClaims(session.access_token, env);
    const user = await getCurrentConfirmedAuthUser(session.access_token, env, claims);
    if (claims.userId !== data.user.id || user.id !== data.user.id || user.email.trim().toLowerCase() !== email) {
      return jsonResponse({ error: "SIGNUP_CONFIRMATION_FAILED" }, 400);
    }

    const service = createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const acceptance = await service.rpc("ogh_record_policy_acceptance", {
      p_user_id: claims.userId, p_bundle: LEGAL_POLICY.bundleVersion,
      p_terms: LEGAL_POLICY.termsVersion, p_privacy: LEGAL_POLICY.privacyVersion,
      p_guidelines: LEGAL_POLICY.guidelinesVersion, p_source: "registration",
    });
    if (acceptance.error) return jsonResponse({ error: "SIGNUP_CONFIRMATION_UNAVAILABLE" }, 503);
    const activation = await service.rpc("ogh_activate_signup_session", {
      p_user_id: claims.userId, p_session_id: claims.sessionId,
    });
    if (activation.error || activation.data !== true) return jsonResponse({ error: "SIGNUP_CONFIRMATION_UNAVAILABLE" }, 503);
    return jsonResponse({ access_token: session.access_token, refresh_token: session.refresh_token });
  } catch {
    return jsonResponse({ error: "SIGNUP_CONFIRMATION_UNAVAILABLE" }, 503);
  }
}

export const POST: APIRoute = ({ request }) => handleSignupConfirm(request, runtimeEnv as RuntimeEnv);
export const ALL: APIRoute = () => jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
