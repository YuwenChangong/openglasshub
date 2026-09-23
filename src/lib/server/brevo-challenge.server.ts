import type { RuntimeEnv } from "./admin-auth.ts";

export class ChallengeError extends Error {
  readonly code: "INVALID_AUTH" | "INVALID_REQUEST" | "VERIFICATION_SERVICE_UNAVAILABLE" |
    "EMAIL_BUDGET_EXHAUSTED" | "RESEND_COOLDOWN" | "CHALLENGE_INVALID" |
    "CHALLENGE_EXPIRED" | "CHALLENGE_SUPERSEDED" | "CHALLENGE_EXHAUSTED" | "SESSION_GONE";
  readonly status: number;
  constructor(
    code: ChallengeError["code"], status: number,
  ) {
    super(code);
    this.name = "ChallengeError";
    this.code = code;
    this.status = status;
  }
}

export const challengeError = (code: ChallengeError["code"], status: number) => new ChallengeError(code, status);
const unavailable = () => challengeError("VERIFICATION_SERVICE_UNAVAILABLE", 503);

export async function sendFreshLoginCode(
  { to, code, requestId: _requestId }: { to: string; code: string; requestId: string },
  env: RuntimeEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const apiKey = env.BREVO_API_KEY?.trim();
  const sender = env.BREVO_VERIFIED_SENDER_EMAIL?.trim();
  if (!apiKey || !sender) throw unavailable();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        sender: { email: sender },
        to: [{ email: to }],
        subject: "OpenGlass Hub sign-in code",
        htmlContent: `<p>Your OpenGlass Hub sign-in code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
      }),
      signal: controller.signal,
    });
    if (controller.signal.aborted || response.status < 200 || response.status >= 300) throw unavailable();
  } catch {
    throw unavailable();
  } finally {
    clearTimeout(timeout);
  }
}
