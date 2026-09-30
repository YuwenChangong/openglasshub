import { useEffect, useMemo, useRef, useState } from "react";
import { buildAuthCallbackRedirect, buildResetPasswordRedirect, getSafeNext } from "../../lib/auth-redirect";
import { LEGAL_POLICY } from "../../lib/legal-policy";
import { getAuthMessages, type AuthLocale, type AuthMessages } from "../../lib/auth-messages";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import type { AuthCaptchaMode } from "../../lib/auth-captcha-mode";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";
import { browserNavigationAdapter, type AuthPanelAdapter, type LegalConsentAdapter, type LegalConsentNavigationAdapter } from "../../lib/legal-consent-adapters";
import AuthTurnstile, { type AuthCaptchaAdapter } from "./AuthTurnstile";

type Mode = "login" | "signup";

interface AuthPanelProps {
  locale?: AuthLocale;
  next?: string;
  initialMode?: Mode;
  captchaMode?: AuthCaptchaMode;
  authTurnstileSiteKey?: string;
  captchaAdapter?: AuthCaptchaAdapter;
  authAdapter?: AuthPanelAdapter;
  /** @deprecated Retained for adapter compatibility; runtime auth does not use consent. */
  consentAdapter?: LegalConsentAdapter;
  navigationAdapter?: LegalConsentNavigationAdapter;
}

type ResendResponse =
  | { ok: true; message?: string }
  | { ok: false; error?: string };

const RESEND_COOLDOWN_MS = 60_000;
const RESEND_COOLDOWN_STORAGE_KEY = "auth-resend-confirmation-cooldown-until";

function mapAuthError(errorMessage: string, messages: AuthMessages): string {
  if (/Invalid login credentials/i.test(errorMessage)) return messages.invalidCredentials;
  if (/Email not confirmed/i.test(errorMessage)) return messages.emailUnconfirmed;
  if (/User already registered/i.test(errorMessage)) {
    return messages.accountMayExist;
  }
  if (/Password should be at least/i.test(errorMessage)) return messages.shortPassword;
  return messages.unavailable;
}

export default function AuthPanel({ locale = "zh-CN", next, initialMode = "login", captchaMode = "off", authTurnstileSiteKey, captchaAdapter, authAdapter, navigationAdapter }: AuthPanelProps) {
  const messages = getAuthMessages(locale);
  const supabase = useMemo(() => authAdapter ? null : createBrowserSupabaseClient(), [authAdapter]);
  const navigation = useMemo(() => navigationAdapter ?? browserNavigationAdapter(), [navigationAdapter]);
  const safeNext = useMemo(() => {
    if (next) return getSafeNext(next);
    if (typeof window === "undefined") return "/";
    return getSafeNext(new URLSearchParams(window.location.search).get("next"));
  }, [next]);

  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [resending, setResending] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState("");
  const [forgotMode, setForgotMode] = useState(false);
  const [resendCooldownUntil, setResendCooldownUntil] = useState(0);
  const [cooldownNow, setCooldownNow] = useState(() => Date.now());
  const turnstileRef = useRef<AuthCaptchaAdapter>(null);
  const captchaFailure = locale === "en" ? "Complete verification and try again." : "请完成验证后重试。";

  async function acquireCaptchaToken(): Promise<string | null> {
    if (captchaMode === "off") return null;
    try { return await (captchaAdapter ?? turnstileRef.current)?.acquireToken() ?? null; }
    catch { return null; }
  }

  function resetCaptcha() {
    if (captchaMode !== "off") (captchaAdapter ?? turnstileRef.current)?.reset();
  }
  const browserAuthState = useBrowserAuthState(supabase);
  const status = authAdapter?.viewState ?? browserAuthState.status;
  const user = authAdapter?.userPresent ? { id: "adapter-user" } : browserAuthState.user;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedValue = window.localStorage.getItem(RESEND_COOLDOWN_STORAGE_KEY);
    const parsed = Number(storedValue ?? "0");
    if (Number.isFinite(parsed) && parsed > Date.now()) {
      setResendCooldownUntil(parsed);
      setCooldownNow(Date.now());
    }
  }, []);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (!resendCooldownUntil || resendCooldownUntil <= Date.now()) {
      if (resendCooldownUntil && typeof window !== "undefined") {
        window.localStorage.removeItem(RESEND_COOLDOWN_STORAGE_KEY);
      }
      return;
    }

    setCooldownNow(Date.now());
    const timer = window.setInterval(() => {
      const nextNow = Date.now();
      setCooldownNow(nextNow);
      if (nextNow >= resendCooldownUntil) {
        setResendCooldownUntil(0);
        window.localStorage.removeItem(RESEND_COOLDOWN_STORAGE_KEY);
        window.clearInterval(timer);
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendCooldownUntil]);

  const resendCooldownSeconds = resendCooldownUntil > cooldownNow
    ? Math.max(1, Math.ceil((resendCooldownUntil - cooldownNow) / 1000))
    : 0;

  function startResendCooldown() {
    const now = Date.now();
    const until = now + RESEND_COOLDOWN_MS;
    setCooldownNow(now);
    setResendCooldownUntil(until);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(RESEND_COOLDOWN_STORAGE_KEY, String(until));
    }
  }

  function selectAuthMode(nextMode: Mode) {
    setMode(nextMode);
    setError("");
    setMessage("");
  }

  function returnToAuthMode() {
    setForgotMode(false);
    setError("");
    setMessage("");
  }

  async function handleAuthSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase && !authAdapter) return;

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const captchaToken = await acquireCaptchaToken();
      if (captchaMode === "required" && !captchaToken) { setError(captchaFailure); return; }
      if (mode === "login") {
        const input = { email, password, ...(captchaToken ? { captchaToken } : {}) };
        const signInResult = authAdapter?.signInWithPassword
          ? await authAdapter.signInWithPassword(input)
          : await supabase!.auth.signInWithPassword({ email, password, options: captchaToken ? { captchaToken } : undefined }).then(({ data, error }) => ({ data: data.session ? { accessToken: data.session.access_token } : null, error }));
        const signInData = signInResult.data;
        const signInError = signInResult.error;
        if (signInError) throw signInError;
        const accessToken = signInData?.accessToken;
        if (!accessToken) throw new Error("Auth session missing");
        navigation.navigate(safeNext);
        return;
      }

      const emailRedirectTo =
        typeof window !== "undefined"
          ? buildAuthCallbackRedirect(window.location.origin, safeNext)
          : undefined;

      const signUpInput = { email, password, emailRedirectTo, ...(captchaToken ? { captchaToken } : {}) };
      const signUpResult = authAdapter?.signUp
        ? await authAdapter.signUp(signUpInput)
        : await supabase!.auth.signUp({ email, password, options: { emailRedirectTo, ...(captchaToken ? { captchaToken } : {}) } }).then(({ data, error }) => ({ data: data.session ? { accessToken: data.session.access_token } : null, error }));
      const signUpData = signUpResult.data;
      const signUpError = signUpResult.error;
      if (signUpError) throw signUpError;

      const accessToken = signUpData?.accessToken;
      if (accessToken) {
        navigation.navigate(safeNext);
        return;
      }

      setPendingVerificationEmail(email.trim());
      setMessage(messages.pendingCheckInbox);
    } catch (authError) {
      const rawMessage = authError instanceof Error ? authError.message : "";
      if (/Email not confirmed/i.test(rawMessage)) {
        setPendingVerificationEmail(email.trim());
      }
      setError(mapAuthError(rawMessage, messages));
    } finally {
      resetCaptcha();
      setLoading(false);
    }
  }

  async function handleResendConfirmation() {
    if (!pendingVerificationEmail || resendCooldownSeconds > 0) return;

    setResending(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/auth/resend-confirmation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: pendingVerificationEmail,
          next: safeNext,
        }),
      });

      const payload = (await response.json().catch(() => null)) as ResendResponse | null;

      if (response.status === 429 || payload?.error === "VERIFICATION_EMAIL_RATE_LIMITED") {
        setError(messages.resendLimit);
        return;
      }

      if (!response.ok || !payload || payload.ok !== true) {
        throw new Error("RESEND_CONFIRMATION_FAILED");
      }

      startResendCooldown();
      setMessage(messages.pendingCheckInbox);
    } catch {
      setError(messages.resendFailed);
    } finally {
      setResending(false);
    }
  }

  async function handleResetPasswordEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase && !authAdapter) return;

    setSendingReset(true);
    setError("");
    setMessage("");

    try {
      const captchaToken = await acquireCaptchaToken();
      if (captchaMode === "required" && !captchaToken) { setError(captchaFailure); return; }
      const redirectTo =
        typeof window !== "undefined"
          ? buildResetPasswordRedirect(window.location.origin)
          : undefined;

      const resetInput = { email: email.trim(), redirectTo: redirectTo ?? "", ...(captchaToken ? { captchaToken } : {}) };
      const { error: resetError } = authAdapter?.requestPasswordReset
        ? await authAdapter.requestPasswordReset(resetInput)
        : await supabase!.auth.resetPasswordForEmail(email.trim(), { redirectTo, ...(captchaToken ? { captchaToken } : {}) });
      if (resetError) {
        setError(messages.resetRequestFailed);
        return;
      }

      setMessage(messages.pendingCheckInbox);
    } catch {
      setError(messages.resetRequestFailed);
    } finally {
      resetCaptcha();
      setSendingReset(false);
    }
  }

  async function handleSignOut() {
    if (!supabase) return;
    setLoading(true);
    setError("");
    setMessage("");
    const signOutError = authAdapter?.signOut ? await authAdapter.signOut() : (await supabase!.auth.signOut()).error;
    if (signOutError) {
      setError(mapAuthError(signOutError.message, messages));
      setLoading(false);
      return;
    }
    navigation.navigate(navigation.getCurrentUrl());
  }

  if (!supabase && !authAdapter) {
    return (
      <section className="auth-card">
        <div className="auth-alert auth-alert--error">{messages.configurationUnavailable}</div>
      </section>
    );
  }

  return (
    <section className="auth-card">
      <div className="auth-card__top">
        <div className="auth-switch" role="tablist" aria-label={`${messages.loginHeading} / ${messages.signupHeading}`}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={mode === "login" ? "is-active" : ""}
            onClick={() => selectAuthMode("login")}
          >
            {messages.login}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            className={mode === "signup" ? "is-active" : ""}
            onClick={() => selectAuthMode("signup")}
          >
            {messages.signup}
          </button>
        </div>
      </div>

      {status === "checking" ? (
        <div className="auth-alert">{messages.checkingAuth}</div>
      ) : status === "signed_in" && user ? (
        <div className="auth-user-state">
          <div className="auth-alert auth-alert--success">{messages.signedIn}</div>
          <div className="community-cta-row">
            <a href="/me/" className="community-button--secondary auth-button">
              {messages.myProfile}
            </a>
            <a href="/me/edit/" className="community-button--secondary auth-button">
              {messages.editProfile}
            </a>
            <a href={safeNext} className="community-button">
              {messages.continue}
            </a>
            <button
              type="button"
              className="community-button--secondary auth-button"
              onClick={handleSignOut}
              disabled={loading}
            >
              {loading ? messages.processing : messages.logout}
            </button>
          </div>
        </div>
      ) : forgotMode ? (
        <form onSubmit={handleResetPasswordEmail} className="auth-form">
          <label>
            <span className="auth-label">{messages.email}</span>
            <input
              className="community-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          {captchaMode !== "off" && authTurnstileSiteKey && !captchaAdapter ? <AuthTurnstile ref={turnstileRef} siteKey={authTurnstileSiteKey} locale={locale} /> : null}
          <div className="community-cta-row">
            <button className="community-button auth-button" type="submit" disabled={sendingReset}>
              {sendingReset ? messages.sending : messages.requestReset}
            </button>
            <button
              type="button"
              className="community-button--secondary auth-button"
              onClick={returnToAuthMode}
              disabled={sendingReset}
            >
              {messages.backToLogin}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleAuthSubmit} className="auth-form">
          <label>
            <span className="auth-label">{messages.email}</span>
            <input
              className="community-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            <span className="auth-label">{messages.password}</span>
            <input
              className="community-input"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          {mode === "signup" ? (
            <p className="auth-signup-notice">
              {messages.signupNoticeLead}<a href={LEGAL_POLICY.routes.terms} target="_blank" rel="noopener noreferrer">{messages.signupNoticeTerms}</a>
              {messages.signupNoticePrivacyLead}<a href={LEGAL_POLICY.routes.privacy} target="_blank" rel="noopener noreferrer">{messages.signupNoticePrivacy}</a>
              {messages.signupNoticeGuidelinesLead}<a href={LEGAL_POLICY.routes.guidelines} target="_blank" rel="noopener noreferrer">{messages.signupNoticeGuidelines}</a>{messages.consentEnd}
            </p>
          ) : null}
          {captchaMode !== "off" && authTurnstileSiteKey && !captchaAdapter ? <AuthTurnstile ref={turnstileRef} siteKey={authTurnstileSiteKey} locale={locale} /> : null}
          <div className="community-cta-row">
            <button className="community-button auth-button" type="submit" disabled={loading}>
              {loading ? messages.processing : mode === "login" ? messages.login : messages.signup}
            </button>
            <button
              type="button"
              className="community-button--secondary auth-button"
              onClick={() => selectAuthMode(mode === "login" ? "signup" : "login")}
              disabled={loading}
            >
              {mode === "login" ? messages.switchToSignup : messages.switchToLogin}
            </button>
          </div>
          {mode === "login" ? (
            <button
              type="button"
              className="auth-forgot-link"
              onClick={() => {
                setForgotMode(true);
                setError("");
                setMessage("");
              }}
            >
              {messages.forgotPassword}
            </button>
          ) : null}
        </form>
      )}

      <div className="auth-feedback">
        {error ? <div className="auth-alert auth-alert--error">{error}</div> : null}
        {message ? <div className="auth-alert auth-alert--success">{message}</div> : null}
        {pendingVerificationEmail ? (
          <div className="auth-resend">
            <div className="auth-resend__actions">
              <button
                type="button"
                className="community-button--secondary auth-button"
                onClick={handleResendConfirmation}
                disabled={resending || resendCooldownSeconds > 0}
              >
                {resending
                  ? messages.sending
                  : resendCooldownSeconds > 0
                    ? messages.cooldown(resendCooldownSeconds)
                    : messages.resend}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
