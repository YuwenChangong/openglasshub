import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const flow = await import(pathToFileURL(`${root}/src/lib/email-verification-flow.ts`).href);
const turnstile = await import(pathToFileURL(`${root}/src/lib/server/turnstile.ts`).href);
const challengeStart = await readFile(`${root}/src/pages/api/auth/email-verification/start.ts`, "utf8");
const authPanel = await readFile(`${root}/src/components/forum/AuthPanel.tsx`, "utf8");

const localBypassEnv = { DEV_TURNSTILE_BYPASS: "true" };
assert.equal(flow.shouldRejectEmptyEmailVerificationCaptcha(localBypassEnv, ""), false);
assert.deepEqual(await turnstile.validateTurnstileToken({ env: localBypassEnv, token: "" }), { ok: true });

assert.equal(flow.shouldRejectEmptyEmailVerificationCaptcha({}, ""), true);
assert.equal(flow.shouldRejectEmptyEmailVerificationCaptcha({ DEV_TURNSTILE_BYPASS: "false" }, ""), true);
assert.equal(flow.shouldRejectEmptyEmailVerificationCaptcha({ DEV_TURNSTILE_BYPASS: "TRUE" }, ""), true);

const productionResult = await turnstile.validateTurnstileToken({
  env: { DEV_TURNSTILE_BYPASS: "true", NODE_ENV: "production", TURNSTILE_SECRET_KEY: "test-only" },
  token: "",
});
assert.deepEqual(productionResult, { ok: false, code: "TURNSTILE_REQUIRED", message: "Missing Turnstile token" });
assert.equal(flow.emailVerificationCaptchaError("TURNSTILE_REQUIRED"), "CAPTCHA_REQUIRED");
assert(challengeStart.includes("shouldRejectEmptyEmailVerificationCaptcha(env, captchaToken)"));
assert(challengeStart.includes("await validateTurnstileToken({ env, token: captchaToken"));
assert(challengeStart.includes("emailVerificationCaptchaError(turnstile.code)"));

assert.equal(flow.shouldRenderOrdinarySignedInView({
  signedIn: true,
  userPresent: true,
  otpMode: false,
  verificationChallengeState: "unavailable",
}), false);
assert.equal(flow.shouldRenderOrdinarySignedInView({
  signedIn: true,
  userPresent: true,
  otpMode: true,
  verificationChallengeState: "active",
}), false);
assert.equal(flow.shouldRenderOrdinarySignedInView({
  signedIn: true,
  userPresent: true,
  otpMode: false,
  verificationChallengeState: "idle",
}), true);
assert(authPanel.includes('setEmailVerificationChallengeState("unavailable")'));
assert(authPanel.includes('emailVerificationChallengeState === "unavailable"'));
assert(authPanel.includes("shouldRenderOrdinarySignedInView({ signedIn: status === \"signed_in\""));

console.log("EMAIL_VERIFICATION_CHALLENGE_FLOW_OK local-bypass-empty-token=pass normal-empty-token=pass exact-value=pass production-guard=pass challenge-failure-fails-closed=pass challenge-success-enters-otp-state=pass");
