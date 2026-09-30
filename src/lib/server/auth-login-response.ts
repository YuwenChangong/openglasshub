import { parseAuthCaptchaMode, type AuthCaptchaMode } from "../auth-captcha-mode";

export function configureAuthLoginResponse(
  response: { headers: Headers },
  runtimeEnv: { AUTH_CAPTCHA_MODE?: string },
): AuthCaptchaMode {
  const mode = parseAuthCaptchaMode(runtimeEnv.AUTH_CAPTCHA_MODE);
  response.headers.set("Cache-Control", "no-store");
  return mode;
}
