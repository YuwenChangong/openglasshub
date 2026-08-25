export type EmailVerificationChallengeState = "idle" | "active" | "unavailable";

export function shouldRejectEmptyEmailVerificationCaptcha(
  env: Record<string, string | undefined>,
  captchaToken: string,
): boolean {
  return !captchaToken && env.DEV_TURNSTILE_BYPASS !== "true";
}

export function emailVerificationCaptchaError(code: "TURNSTILE_REQUIRED" | "TURNSTILE_INVALID"): "CAPTCHA_REQUIRED" | "CAPTCHA_INVALID" {
  return code === "TURNSTILE_REQUIRED" ? "CAPTCHA_REQUIRED" : "CAPTCHA_INVALID";
}

export function shouldRenderOrdinarySignedInView(params: {
  signedIn: boolean;
  userPresent: boolean;
  otpMode: boolean;
  verificationChallengeState: EmailVerificationChallengeState;
}): boolean {
  return params.signedIn && params.userPresent && !params.otpMode && params.verificationChallengeState !== "unavailable";
}
