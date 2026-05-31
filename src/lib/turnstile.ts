interface TurnstileResult {
  ok: boolean;
  code?: "TURNSTILE_FAILED" | "TURNSTILE_NOT_CONFIGURED";
  message?: string;
}

export async function validateTurnstileToken(params: {
  env: Record<string, string | undefined>;
  token: string;
  remoteIp?: string;
}): Promise<TurnstileResult> {
  const { env, token, remoteIp } = params;
  const secret = env.TURNSTILE_SECRET_KEY;
  const bypass = env.DEV_TURNSTILE_BYPASS === "true";
  const envName = (env.CF_PAGES_BRANCH || env.NODE_ENV || "").toLowerCase();
  const isProductionLike =
    envName === "production" ||
    envName === "prod" ||
    env.CF_PAGES_BRANCH === "main" ||
    env.CF_PAGES_BRANCH === "master";

  if (!secret) {
    if (bypass) {
      return { ok: true };
    }
    return {
      ok: false,
      code: "TURNSTILE_NOT_CONFIGURED",
      message: "Turnstile not configured",
    };
  }

  // Preview/local escape hatch: allow explicit bypass to keep release flow unblocked.
  // Keep DEV_TURNSTILE_BYPASS=false in production.
  if (bypass && !isProductionLike) {
    return { ok: true };
  }

  if (!token) {
    return {
      ok: false,
      code: "TURNSTILE_FAILED",
      message: "Missing Turnstile token",
    };
  }

  const body = new URLSearchParams({
    secret,
    response: token,
  });
  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const payload = (await response.json().catch(() => null)) as
    | { success?: boolean; ["error-codes"]?: string[] }
    | null;

  if (!response.ok || !payload?.success) {
    return {
      ok: false,
      code: "TURNSTILE_FAILED",
      message: payload?.["error-codes"]?.join(", ") || "Turnstile verification failed",
    };
  }

  return { ok: true };
}
