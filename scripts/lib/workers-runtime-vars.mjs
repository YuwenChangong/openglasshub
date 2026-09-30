import { parseAuthCaptchaMode } from "../../src/lib/auth-captcha-mode.ts";

export function withWorkerRuntimeVars(generated, productionVars) {
  const supabaseUrl = productionVars.SUPABASE_URL;
  if (typeof supabaseUrl !== "string" || supabaseUrl.trim() === "") {
    throw new Error("WORKERS_RUNTIME_SUPABASE_URL_MISSING");
  }

  const vars = {
    ...(generated.vars ?? {}),
    SUPABASE_URL: supabaseUrl,
    AUTH_CAPTCHA_MODE: parseAuthCaptchaMode(productionVars.AUTH_CAPTCHA_MODE),
  };
  const authSiteKey = productionVars.PUBLIC_AUTH_TURNSTILE_SITE_KEY;
  if (typeof authSiteKey === "string" && authSiteKey.trim() !== "") {
    vars.PUBLIC_AUTH_TURNSTILE_SITE_KEY = authSiteKey;
  } else {
    delete vars.PUBLIC_AUTH_TURNSTILE_SITE_KEY;
  }

  return { ...generated, vars };
}
