import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { buildAuthCallbackRedirect, getSafeNext } from "../../../lib/auth-redirect";
import { getRequestIp } from "../../../lib/request-ip";
import { consumeVerificationEmailResendLimit, hashRateLimitIp } from "../../../lib/server/rate-limit";

export const prerender = false;

type RuntimeEnv = Record<string, string | undefined>;

type ResendPayload = {
  email?: string;
  next?: string | null;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function requireEnv(env: RuntimeEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as { runtime?: { env?: RuntimeEnv } }).runtime?.env;
    if (!env) {
      return json({ ok: false, error: "RESEND_CONFIRMATION_FAILED" }, 500);
    }

    const payload = (await request.json().catch(() => null)) as ResendPayload | null;
    const email = String(payload?.email ?? "").trim().toLowerCase();
    const safeNext = getSafeNext(payload?.next ?? null);
    if (!isValidEmail(email)) {
      return json({ ok: false, error: "INVALID_EMAIL" }, 400);
    }

    const supabase = createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const salt = requireEnv(env, "RATE_LIMIT_SALT");
    const ipHash = await hashRateLimitIp(getRequestIp(request), salt);
    const rateLimit = await consumeVerificationEmailResendLimit({
      client: supabase,
      ipHash,
      maxAttempts: 5,
      windowHours: 24,
    });

    if (!rateLimit.allowed) {
      if (rateLimit.reason === "RATE_LIMITED") {
        return json({ ok: false, error: "VERIFICATION_EMAIL_RATE_LIMITED" }, 429);
      }
      return json({ ok: false, error: "RESEND_CONFIRMATION_FAILED" }, 500);
    }

    const redirectTo = buildAuthCallbackRedirect(new URL(request.url).origin, safeNext);

    try {
      await supabase.auth.resend({
        type: "signup",
        email,
        options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
      });
    } catch {
      return json({
        ok: true,
        message: "如果该邮箱可用，我们会发送验证邮件。",
      });
    }

    return json({
      ok: true,
      message: "如果该邮箱可用，我们会发送验证邮件。",
    });
  } catch {
    return json({ ok: false, error: "RESEND_CONFIRMATION_FAILED" }, 500);
  }
};

export const ALL: APIRoute = () => json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
