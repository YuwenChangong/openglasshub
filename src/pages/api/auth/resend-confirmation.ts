import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { buildAuthCallbackRedirect, getSafeNext } from "../../../lib/auth-redirect";
import { getRequestIp } from "../../../lib/request-ip";
import { consumeVerificationEmailResendLimit, hashRateLimitIp, type ForumRateLimitResult } from "../../../lib/server/rate-limit";
import { classifyAuthEmailFailure, type AuthEmailEvent } from "../../../lib/server/auth-email-observability";

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

type ResendDependencies = {
  resend: (email: string, redirectTo: string) => Promise<{ error: unknown | null }>;
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
    if (!isValidEmail(email)) {
      return json({ ok: false, error: "INVALID_EMAIL" }, 400);
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
        ? await dependencies.resend(email, redirectTo ?? "")
        : await supabase!.auth.resend({ type: "signup", email, options: redirectTo ? { emailRedirectTo: redirectTo } : undefined });
      observe(result.error !== null ? classifyAuthEmailFailure(result.error) : "accepted");
    } catch (error) {
      observe(classifyAuthEmailFailure(error));
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

export const POST = createResendPost();

export const ALL: APIRoute = () => json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
