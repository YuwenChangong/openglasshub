import { useEffect, useMemo, useState } from "react";
import { buildAuthCallbackRedirect, buildResetPasswordRedirect, getSafeNext } from "../../lib/auth-redirect";
import { LEGAL_POLICY } from "../../lib/legal-policy";
import { getAuthMessages, type AuthLocale, type AuthMessages } from "../../lib/auth-messages";
import { recordLegalConsent } from "../../lib/legal-consent-client";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";
import { browserNavigationAdapter, type AuthPanelAdapter, type LegalConsentAdapter, type LegalConsentNavigationAdapter } from "../../lib/legal-consent-adapters";

type Mode = "login" | "signup";

interface AuthPanelProps {
  locale?: AuthLocale;
  next?: string;
  initialMode?: Mode;
  authAdapter?: AuthPanelAdapter;
  consentAdapter?: LegalConsentAdapter;
  navigationAdapter?: LegalConsentNavigationAdapter;
}

type ResendResponse =
  | { ok: true; message?: string }
  | { ok: false; error?: string };

const RESEND_COOLDOWN_MS = 60_000;
const RESEND_COOLDOWN_STORAGE_KEY = "auth-resend-confirmation-cooldown-until";

function consentRecoveryHref(next: string): string {
  return `/legal-consent/?next=${encodeURIComponent(getSafeNext(next))}&reason=callback`;
}

function mapAuthError(errorMessage: string, messages: AuthMessages): string {
  if (/Invalid login credentials/i.test(errorMessage)) return messages.invalidCredentials;
  if (/Email not confirmed/i.test(errorMessage)) return messages.emailUnconfirmed;
  if (/User already registered/i.test(errorMessage)) {
    return messages.accountMayExist;
  }
  if (/Password should be at least/i.test(errorMessage)) return messages.shortPassword;
  return messages.unavailable;
}

export default function AuthPanel({ locale = "zh-CN", next, initialMode = "login", authAdapter, consentAdapter, navigationAdapter }: AuthPanelProps) {
  const messages = getAuthMessages(locale);
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
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
  const [legalAcknowledged, setLegalAcknowledged] = useState(false);
  const [ageEligible, setAgeEligible] = useState(false);
  const [legalAcknowledgementError, setLegalAcknowledgementError] = useState("");
  const [resendCooldownUntil, setResendCooldownUntil] = useState(0);
  const [cooldownNow, setCooldownNow] = useState(() => Date.now());
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
    setLegalAcknowledged(false);
    setAgeEligible(false);
    setLegalAcknowledgementError("");
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
    setLegalAcknowledged(false);
    setAgeEligible(false);
    setLegalAcknowledgementError("");
    setError("");
    setMessage("");
  }

  function returnToAuthMode() {
    setForgotMode(false);
    setLegalAcknowledged(false);
    setAgeEligible(false);
    setLegalAcknowledgementError("");
    setError("");
    setMessage("");
  }

  function handleLegalAcknowledgementChange(checked: boolean) {
    setLegalAcknowledged(checked);
    if (checked) setLegalAcknowledgementError("");
  }

  async function handleAuthSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase && !authAdapter) return;

    if (!ageEligible || !legalAcknowledged) {
      setLegalAcknowledgementError(messages.legalRequired);
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      if (mode === "login") {
        const signInResult = authAdapter?.signInWithPassword
          ? await authAdapter.signInWithPassword({ email, password })
          : await supabase!.auth.signInWithPassword({ email, password }).then(({ data, error }) => ({ data: data.session ? { accessToken: data.session.access_token } : null, error }));
        const signInData = signInResult.data;
        const signInError = signInResult.error;
        if (signInError) throw signInError;
        const accessToken = signInData?.accessToken;
        if (!accessToken) {
          navigation.navigate(consentRecoveryHref(safeNext));
          return;
        }
        setMessage(messages.recording);
        try {
          if (consentAdapter) await consentAdapter.recordCurrentConsent({ accessToken, source: "login" }); else await recordLegalConsent({ accessToken, source: "login" });
        } catch {
          navigation.navigate(consentRecoveryHref(safeNext));
          return;
        }
        navigation.navigate(safeNext);
        return;
      }

      const emailRedirectTo =
        typeof window !== "undefined"
          ? buildAuthCallbackRedirect(window.location.origin, safeNext)
          : undefined;

      const signUpResult = authAdapter?.signUp
        ? await authAdapter.signUp({ email, password, emailRedirectTo })
        : await supabase!.auth.signUp({ email, password, options: { emailRedirectTo } }).then(({ data, error }) => ({ data: data.session ? { accessToken: data.session.access_token } : null, error }));
      const signUpData = signUpResult.data;
      const signUpError = signUpResult.error;
      if (signUpError) throw signUpError;

      const accessToken = signUpData?.accessToken;
      if (accessToken) {
        setMessage(messages.recording);
        try {
          if (consentAdapter) await consentAdapter.recordCurrentConsent({ accessToken, source: "registration" }); else await recordLegalConsent({ accessToken, source: "registration" });
          navigation.navigate(safeNext);
          return;
        } catch {
          navigation.navigate(consentRecoveryHref(safeNext));
          return;
        }
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
      const redirectTo =
        typeof window !== "undefined"
          ? buildResetPasswordRedirect(window.location.origin)
          : undefined;

      if (authAdapter?.requestPasswordReset) {
        await authAdapter.requestPasswordReset({ email: email.trim(), redirectTo: redirectTo ?? "" });
      } else {
        await supabase!.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      }

      setMessage(messages.pendingCheckInbox);
    } catch {
      setError(messages.resetRequestFailed);
    } finally {
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
          <div className="auth-legal-acknowledgement">
            <input
              id="auth-age-eligibility"
              type="checkbox"
              checked={ageEligible}
              onChange={(event) => { setAgeEligible(event.target.checked); if (event.target.checked) setLegalAcknowledgementError(""); }}
              aria-invalid={legalAcknowledgementError ? true : undefined}
              aria-describedby={legalAcknowledgementError ? "auth-legal-acknowledgement-error" : undefined}
            />
            <label htmlFor="auth-age-eligibility">{messages.eligibility(LEGAL_POLICY.minimumAge)}</label>
          </div>
          <div className="auth-legal-acknowledgement">
            <input
              id="auth-legal-acknowledgement"
              type="checkbox"
              checked={legalAcknowledged}
              onChange={(event) => handleLegalAcknowledgementChange(event.target.checked)}
              aria-invalid={legalAcknowledgementError ? true : undefined}
              aria-describedby={legalAcknowledgementError ? "auth-legal-acknowledgement-error" : undefined}
            />
            <label htmlFor="auth-legal-acknowledgement">
              {messages.consentSentence}{" "}
              <a href={LEGAL_POLICY.routes.terms} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
                {messages.terms}
              </a>
              {" "}{messages.legalJoin}{" "}
              <a href={LEGAL_POLICY.routes.guidelines} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
                {messages.guidelines}
              </a>
              {messages.privacyLead}{" "}
              <a href={LEGAL_POLICY.routes.privacy} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
                {messages.privacy}
              </a>
              {messages.consentEnd}
            </label>
            {legalAcknowledgementError ? (
              <div id="auth-legal-acknowledgement-error" className="auth-alert auth-alert--error" role="alert">
                {legalAcknowledgementError}
              </div>
            ) : null}
          </div>
          <div className="community-cta-row">
            <button className="community-button auth-button" type="submit" disabled={loading || !ageEligible || !legalAcknowledged} style={{ opacity: !ageEligible || !legalAcknowledged ? 0.55 : undefined }}>
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
                setLegalAcknowledged(false);
                setAgeEligible(false);
                setLegalAcknowledgementError("");
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
