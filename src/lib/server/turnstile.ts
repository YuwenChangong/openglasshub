export type TurnstileResult =
  | { ok: true }
  | { ok: false; code: "TURNSTILE_REQUIRED" | "TURNSTILE_INVALID"; message: string };

export type UploadTurnstileMode = "risk_based" | "required" | "off";

export function resolveUploadTurnstileMode(env: Record<string, string | undefined>): UploadTurnstileMode {
  const raw = String(env.UPLOAD_TURNSTILE_MODE ?? "risk_based").trim().toLowerCase();
  if (raw === "required" || raw === "off") return raw;
  return "risk_based";
}

export function shouldRequireUploadTurnstile(params: {
  env: Record<string, string | undefined>;
  uploadKind: string;
  sizeBytes: number;
}): boolean {
  const mode = resolveUploadTurnstileMode(params.env);
  if (mode === "off") return false;
  if (mode === "required") return true;

  const normalizedBytes = Number.isFinite(params.sizeBytes) && params.sizeBytes > 0
    ? Math.trunc(params.sizeBytes)
    : 0;

  if (params.uploadKind === "post_media" && normalizedBytes >= 100 * 1024 * 1024) {
    return true;
  }

  return false;
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
    if (bypass && !isProductionLike) {
      return { ok: true };
    }
    return {
      ok: false,
      code: "TURNSTILE_INVALID",
      message: "Turnstile not configured",
    };
  }

  if (bypass && !isProductionLike) {
    return { ok: true };
  }

  if (!token) {
    return {
      ok: false,
      code: "TURNSTILE_REQUIRED",
      message: "Missing Turnstile token",
    };
  }

  try {
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
      const errorCodes = payload?.["error-codes"] ?? [];
      const code = errorCodes.includes("missing-input-response")
        ? "TURNSTILE_REQUIRED"
        : "TURNSTILE_INVALID";
      return {
        ok: false,
        code,
        message: errorCodes.join(", ") || "Turnstile verification failed",
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      code: "TURNSTILE_INVALID",
      message: error instanceof Error ? error.message : "Turnstile verification failed",
    };
  }
}
