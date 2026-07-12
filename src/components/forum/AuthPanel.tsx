import { useEffect, useMemo, useState } from "react";
import { buildAuthCallbackRedirect, buildResetPasswordRedirect, getSafeNext } from "../../lib/auth-redirect";
import { LEGAL_POLICY } from "../../lib/legal-policy";
import { recordLegalConsent } from "../../lib/legal-consent-client";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";
import { browserNavigationAdapter, type AuthPanelAdapter, type LegalConsentAdapter, type LegalConsentNavigationAdapter } from "../../lib/legal-consent-adapters";

type Mode = "login" | "signup";

interface AuthPanelProps {
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
const LEGAL_ACKNOWLEDGEMENT_ERROR = `请确认您已年满 ${LEGAL_POLICY.minimumAge} 周岁，并阅读相关政策后继续。`;

function consentRecoveryHref(next: string): string {
  return `/legal-consent/?next=${encodeURIComponent(getSafeNext(next))}&reason=callback`;
}

function mapAuthError(errorMessage: string): string {
  if (/Invalid login credentials/i.test(errorMessage)) return "邮箱或密码错误。";
  if (/Email not confirmed/i.test(errorMessage)) return "请先完成邮箱验证后再登录。";
  if (/User already registered/i.test(errorMessage)) {
    return "如果账号已存在，请直接登录；如果账号尚未完成验证，可以重新发送验证邮件。";
  }
  if (/Password should be at least/i.test(errorMessage)) return "密码长度至少为 8 位。";
  return errorMessage;
}

export default function AuthPanel({ next, initialMode = "login", authAdapter, consentAdapter, navigationAdapter }: AuthPanelProps) {
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
    setLegalAcknowledgementError("");
    setError("");
    setMessage("");
  }

  function returnToAuthMode() {
    setForgotMode(false);
    setLegalAcknowledged(false);
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

    if (!legalAcknowledged) {
      setLegalAcknowledgementError(LEGAL_ACKNOWLEDGEMENT_ERROR);
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
        setMessage("正在记录政策确认...");
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
        setMessage("正在记录政策确认...");
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
      setMessage("验证邮件已发送。请先完成邮箱验证，再返回站内继续。");
    } catch (authError) {
      const rawMessage = authError instanceof Error ? authError.message : "请求失败。";
      if (/Email not confirmed/i.test(rawMessage)) {
        setPendingVerificationEmail(email.trim());
      }
      setError(mapAuthError(rawMessage));
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
        setError("今天发送次数已达上限，请明天再试。");
        return;
      }

      if (!response.ok || !payload || payload.ok !== true) {
        throw new Error("RESEND_CONFIRMATION_FAILED");
      }

      startResendCooldown();
      setMessage(payload.message || "如果该邮箱可用，我们会发送验证邮件。");
    } catch {
      setError("暂时无法重新发送验证邮件，请稍后再试。");
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

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });

      if (resetError) {
        throw resetError;
      }

      setMessage("如果该邮箱存在对应账号，我们会发送重置密码邮件。请检查邮箱并打开重置链接。");
    } catch {
      setError("暂时无法发送重置邮件，请稍后再试。");
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
      setError(mapAuthError(signOutError.message));
      setLoading(false);
      return;
    }
    navigation.navigate(navigation.getCurrentUrl());
  }

  if (!supabase && !authAdapter) {
    return (
      <section className="auth-card">
        <div className="auth-alert auth-alert--error">登录暂不可用，缺少必要的 Supabase 公共环境变量。</div>
      </section>
    );
  }

  return (
    <section className="auth-card">
      <div className="auth-card__top">
        <div className="auth-switch" role="tablist" aria-label="登录注册切换">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={mode === "login" ? "is-active" : ""}
            onClick={() => selectAuthMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            className={mode === "signup" ? "is-active" : ""}
            onClick={() => selectAuthMode("signup")}
          >
            注册
          </button>
        </div>
      </div>

      {status === "checking" ? (
        <div className="auth-alert">正在检查当前登录状态...</div>
      ) : status === "signed_in" && user ? (
        <div className="auth-user-state">
          <div className="auth-alert auth-alert--success">当前已登录。</div>
          <div className="community-cta-row">
            <a href="/me/" className="community-button--secondary auth-button">
              我的主页
            </a>
            <a href="/me/edit/" className="community-button--secondary auth-button">
              编辑资料
            </a>
            <a href={safeNext} className="community-button">
              继续前往
            </a>
            <button
              type="button"
              className="community-button--secondary auth-button"
              onClick={handleSignOut}
              disabled={loading}
            >
              {loading ? "处理中..." : "退出登录"}
            </button>
          </div>
        </div>
      ) : forgotMode ? (
        <form onSubmit={handleResetPasswordEmail} className="auth-form">
          <label>
            <span className="auth-label">邮箱</span>
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
              {sendingReset ? "发送中..." : "发送重置邮件"}
            </button>
            <button
              type="button"
              className="community-button--secondary auth-button"
              onClick={returnToAuthMode}
              disabled={sendingReset}
            >
              返回登录
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleAuthSubmit} className="auth-form">
          <label>
            <span className="auth-label">邮箱</span>
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
            <span className="auth-label">密码</span>
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
              id="auth-legal-acknowledgement"
              type="checkbox"
              checked={legalAcknowledged}
              onChange={(event) => handleLegalAcknowledgementChange(event.target.checked)}
              aria-invalid={legalAcknowledgementError ? true : undefined}
              aria-describedby={legalAcknowledgementError ? "auth-legal-acknowledgement-error" : undefined}
            />
            <label htmlFor="auth-legal-acknowledgement">
              我确认已年满 {LEGAL_POLICY.minimumAge} 周岁，并已阅读并同意
              <a href={LEGAL_POLICY.routes.terms} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
                《服务条款》
              </a>
              和
              <a href={LEGAL_POLICY.routes.guidelines} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
                《社区准则》
              </a>
              ，且已阅读并知悉
              <a href={LEGAL_POLICY.routes.privacy} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
                《隐私政策》
              </a>
              。
              <span lang="en">
                I confirm that I am at least {LEGAL_POLICY.minimumAge} years old, agree to the{" "}
                <a href={LEGAL_POLICY.routes.terms} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
                  Terms of Service
                </a>
                {" "}and{" "}
                <a href={LEGAL_POLICY.routes.guidelines} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>Community Guidelines</a>, and acknowledge that I have read the
                {" "}
                <a href={LEGAL_POLICY.routes.privacy} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
                  Privacy Policy
                </a>
                .
              </span>
            </label>
            {legalAcknowledgementError ? (
              <div id="auth-legal-acknowledgement-error" className="auth-alert auth-alert--error" role="alert">
                {legalAcknowledgementError}
              </div>
            ) : null}
          </div>
          <div className="community-cta-row">
            <button className="community-button auth-button" type="submit" disabled={loading}>
              {loading ? "处理中..." : mode === "login" ? "登录" : "注册"}
            </button>
            <button
              type="button"
              className="community-button--secondary auth-button"
              onClick={() => selectAuthMode(mode === "login" ? "signup" : "login")}
              disabled={loading}
            >
              {mode === "login" ? "切换到注册" : "切换到登录"}
            </button>
          </div>
          {mode === "login" ? (
            <button
              type="button"
              className="auth-forgot-link"
              onClick={() => {
                setForgotMode(true);
                setLegalAcknowledged(false);
                setLegalAcknowledgementError("");
                setError("");
                setMessage("");
              }}
            >
              忘记密码？
            </button>
          ) : null}
        </form>
      )}

      <div className="auth-feedback">
        {error ? <div className="auth-alert auth-alert--error">{error}</div> : null}
        {message ? <div className="auth-alert auth-alert--success">{message}</div> : null}
        {pendingVerificationEmail ? (
          <div className="auth-resend">
            <div className="auth-resend__copy">
              <span className="auth-resend__note">已发送，请检查邮箱或垃圾箱。</span>
              <span className="auth-resend__hint">如果没有收到邮件，请检查垃圾箱，或稍后重新发送。</span>
            </div>
            <div className="auth-resend__actions">
              <button
                type="button"
                className="community-button--secondary auth-button"
                onClick={handleResendConfirmation}
                disabled={resending || resendCooldownSeconds > 0}
              >
                {resending
                  ? "发送中..."
                  : resendCooldownSeconds > 0
                    ? `${resendCooldownSeconds} 秒后可重新发送`
                    : "重新发送验证邮件"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
