import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { buildAuthCallbackRedirect, getSafeNext } from "../../../lib/auth-redirect";
import { getRequestIp } from "../../../lib/request-ip";
import { consumeVerificationEmailResendLimit, hashRateLimitIp, type ForumRateLimitResult } from "../../../lib/server/rate-limit";
import { classifyAuthEmailFailure, type AuthEmailEvent } from "../../../lib/server/auth-email-observability";
import { parseAuthCaptchaMode } from "../../../lib/auth-captcha-mode";

export const prerender = false;

type RuntimeEnv = Record<string, string | undefined>;

type ResendPayload = {
  email?: string;
  next?: string | null;
  captchaToken?: string;
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

type ResendDependencies = {
  resend: (email: string, redirectTo: string, captchaToken?: string) => Promise<{ error: unknown | null }>;
  consumeLimit: (input: { ipHash: string; maxAttempts: number; windowHours: number }) => Promise<ForumRateLimitResult>;
  observe: (event: AuthEmailEvent) => void;
};

export function createResendPost(dependencies?: ResendDependencies): APIRoute {
  return async ({ request }) => {
  try {
    const env = runtimeEnv;
    if (!env) {
      return json({ ok: false, error: "RESEND_CONFIRMATION_FAILED" }, 500);
    }

    const payload = (await request.json().catch(() => null)) as ResendPayload | null;
    const email = String(payload?.email ?? "").trim().toLowerCase();
    const safeNext = getSafeNext(payload?.next ?? null);
    const captchaMode = parseAuthCaptchaMode(env.AUTH_CAPTCHA_MODE);
    if (!isValidEmail(email)) {
      return json({ ok: false, error: "INVALID_EMAIL" }, 400);
    }
    const captchaToken = payload?.captchaToken;
    if (captchaToken !== undefined && (typeof captchaToken !== "string" || !captchaToken.trim() || captchaToken.length > 4096)) {
      return json({ ok: false, error: "BOT_PROOF_REQUIRED" }, 400);
    }
    if (captchaMode === "required" && !captchaToken) {
      return json({ ok: false, error: "BOT_PROOF_REQUIRED" }, 400);
    }

    const supabase = dependencies ? null : createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const salt = requireEnv(env, "RATE_LIMIT_SALT");
    const ipHash = await hashRateLimitIp(getRequestIp(request), salt);
    const started = performance.now();
    const observe = (outcome: AuthEmailEvent["outcome"]) => {
      const event: AuthEmailEvent = { flow: "RESEND", stage: "provider", outcome, durationMs: Math.max(0, performance.now() - started) };
      try {
        if (dependencies) dependencies.observe(event);
        else console.info("auth_email_event", event);
      } catch { /* Diagnostics must not change the public response. */ }
    };
    const rateLimit = dependencies
      ? await dependencies.consumeLimit({ ipHash, maxAttempts: 5, windowHours: 24 })
      : await consumeVerificationEmailResendLimit({ client: supabase!, ipHash, maxAttempts: 5, windowHours: 24 });

    if (!rateLimit.allowed) {
      observe(rateLimit.reason === "RATE_LIMITED" ? "rate_limited" : "unavailable");
      if (rateLimit.reason === "RATE_LIMITED") {
        return json({ ok: false, error: "VERIFICATION_EMAIL_RATE_LIMITED" }, 429);
      }
      return json({ ok: false, error: "RESEND_CONFIRMATION_FAILED" }, 500);
    }

    const redirectTo = buildAuthCallbackRedirect(new URL(request.url).origin, safeNext);

    try {
      const result = dependencies
        ? await dependencies.resend(email, redirectTo ?? "", captchaToken)
        : await supabase!.auth.resend({ type: "signup", email, options: { ...(redirectTo ? { emailRedirectTo: redirectTo } : {}), ...(captchaToken ? { captchaToken } : {}) } });
      if (result.error !== null) {
        observe(classifyAuthEmailFailure(result.error));
        if (isCaptchaFailure(result.error)) return json({ ok: false, error: "CAPTCHA_RETRY" }, 400);
        if (!isAccountSpecificAuthFailure(result.error)) return json({ ok: false, error: "RESEND_CONFIRMATION_FAILED" }, 503);
      } else observe("accepted");
    } catch (error) {
      observe(classifyAuthEmailFailure(error));
      if (isCaptchaFailure(error)) return json({ ok: false, error: "CAPTCHA_RETRY" }, 400);
      if (!isAccountSpecificAuthFailure(error)) return json({ ok: false, error: "RESEND_CONFIRMATION_FAILED" }, 503);
    }

    return json({
      ok: true,
      message: "如果该邮箱可用，我们会发送验证邮件。",
    });
  } catch {
    return json({ ok: false, error: "RESEND_CONFIRMATION_FAILED" }, 500);
  }
};
}

function isAccountSpecificAuthFailure(error: unknown): boolean {
  try {
    if (typeof error !== "object" || error === null) return false;
    const { status, code } = error as { status?: unknown; code?: unknown };
    // These account-state codes are in the installed Auth ErrorCode contract; status alone is insufficient.
    return (status === 400 || status === 404)
      && (code === "user_not_found" || code === "email_exists" || code === "user_already_exists" || code === "email_not_confirmed");
  } catch {
    return false;
  }
}

function isCaptchaFailure(error: unknown): boolean {
  try {
    if (typeof error !== "object" || error === null) return false;
    const { code, message } = error as { code?: unknown; message?: unknown };
    return (typeof code === "string" && /^captcha[_-](?:failed|expired|invalid)$/i.test(code))
      || (typeof message === "string" && /captcha[_\s-]*failed|captcha.*(?:invalid|expired|failed)/i.test(message));
  } catch {
    return false;
  }
}

export const POST = createResendPost();

export const ALL: APIRoute = () => json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
