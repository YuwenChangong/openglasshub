export type AuthCaptchaMode = "off" | "prepare" | "required";

export function parseAuthCaptchaMode(raw: string | undefined): AuthCaptchaMode {
  if (raw === undefined) return "off";
  if (raw === "off" || raw === "prepare" || raw === "required") return raw;
  throw new Error("AUTH_CAPTCHA_MODE_INVALID");
}
