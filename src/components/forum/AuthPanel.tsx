import { useEffect, useMemo, useRef, useState } from "react";
import { buildAuthCallbackRedirect, buildResetPasswordRedirect, getSafeNext } from "../../lib/auth-redirect";
import { LEGAL_POLICY } from "../../lib/legal-policy";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";
import { browserNavigationAdapter, type AuthPanelAdapter, type LegalConsentAdapter, type LegalConsentNavigationAdapter } from "../../lib/legal-consent-adapters";
import { useInvisibleTurnstile } from "./useInvisibleTurnstile";

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
const LEGAL_ACKNOWLEDGEMENT_ERROR = "请确认您已阅读并同意相关政策后继续。";

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
  const [showPassword, setShowPassword] = useState(false);
  const [otpMode, setOtpMode] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpDestination, setOtpDestination] = useState("");
  const passwordProofRef = useRef<string | null>(null);
  const turnstile = useInvisibleTurnstile("安全验证未完成，请稍后重试。");
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
      const captchaToken = await turnstile.ensureToken({ forceRefresh: true });
      if (turnstile.siteKeyEnabled && !captchaToken) throw new Error("CAPTCHA_REQUIRED");
      if (mode === "login") {
        const signInResult = authAdapter?.signInWithPassword
          ? await authAdapter.signInWithPassword({ email, password })
          : await supabase!.auth.signInWithPassword({ email, password, options: { captchaToken } }).then(({ data, error }) => ({ data: data.session ? { accessToken: data.session.access_token } : null, error }));
        const signInData = signInResult.data;
        const signInError = signInResult.error;
        if (signInError) throw signInError;
        const accessToken = signInData?.accessToken;
        if (!accessToken) {
          navigation.navigate(consentRecoveryHref(safeNext));
          return;
        }
        if (authAdapter) {
          // Test adapters have no HTTP challenge endpoint; production always uses the flow below.
          navigation.navigate(consentRecoveryHref(safeNext));
          return;
        }
        passwordProofRef.current = accessToken;
        const start = await fetch("/api/auth/email-verification/start", {
          method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ captchaToken }),
        });
        const startPayload = await start.json().catch(() => null) as { destination?: string; error?: string } | null;
        if (!start.ok || !startPayload?.destination) throw new Error(startPayload?.error ?? "OTP_DELIVERY_UNAVAILABLE");
        setOtpDestination(startPayload.destination);
        setOtpMode(true);
        setMessage("验证码已发送到已验证的绑定邮箱。");
        return;
      }

      const emailRedirectTo =
        typeof window !== "undefined"
          ? buildAuthCallbackRedirect(window.location.origin, safeNext)
          : undefined;

      const signUpResult = authAdapter?.signUp
        ? await authAdapter.signUp({ email, password, emailRedirectTo })
        : await supabase!.auth.signUp({ email, password, options: { emailRedirectTo, captchaToken } }).then(({ data, error }) => ({ data: data.session ? { accessToken: data.session.access_token } : null, error }));
      const signUpData = signUpResult.data;
      const signUpError = signUpResult.error;
      if (signUpError) throw signUpError;

      const accessToken = signUpData?.accessToken;
      if (accessToken && supabase) await supabase.auth.signOut({ scope: "local" });

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

  async function handleOtpVerify(event: React.FormEvent) {
    event.preventDefault();
    const proof = passwordProofRef.current;
    if (!proof || !/^\d{6}$/.test(otp)) { setError("请输入 6 位验证码。"); return; }
    setLoading(true); setError("");
    try {
      const result = await fetch("/api/auth/email-verification/verify", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${proof}` }, body: JSON.stringify({ token: otp }) });
      const payload = await result.json().catch(() => null) as { access_token?: string; refresh_token?: string; error?: string } | null;
      if (!result.ok || !payload?.access_token || !payload.refresh_token) throw new Error(payload?.error ?? "VERIFICATION_FAILED");
      const { error: sessionError } = await supabase!.auth.setSession({ access_token: payload.access_token, refresh_token: payload.refresh_token });
      if (sessionError) throw sessionError;
      passwordProofRef.current = null;
      navigation.navigate(`/legal-consent/?next=${encodeURIComponent(safeNext)}&reason=login`);
    } catch { setError("验证码无效、已过期或暂时无法验证，请重新登录后再试。"); }
    finally { setLoading(false); }
  }

  async function handleOtpResend() {
    const proof = passwordProofRef.current;
    if (!proof || resendCooldownSeconds > 0) return;
    setResending(true); setError("");
    try {
      const captchaToken = await turnstile.ensureToken({ forceRefresh: true });
      if (turnstile.siteKeyEnabled && !captchaToken) throw new Error("CAPTCHA_REQUIRED");
      const result = await fetch("/api/auth/email-verification/resend", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${proof}` }, body: JSON.stringify({ captchaToken }) });
      if (!result.ok) throw new Error("RESEND_UNAVAILABLE");
      startResendCooldown(); setMessage("验证码已重新发送。");
    } catch { setError("暂时无法重新发送验证码，请稍后重新登录。 "); }
    finally { setResending(false); }
  }

  function cancelOtp() { passwordProofRef.current = null; setOtp(""); setOtpMode(false); setMessage(""); setError(""); }

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
        redirectTo, captchaToken: await turnstile.ensureToken({ forceRefresh: true }),
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
      ) : status === "signed_in" && user && !otpMode ? (
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
      ) : otpMode ? (
        <form onSubmit={handleOtpVerify} className="auth-form">
          <div className="auth-alert">请输入发送到 {otpDestination} 的 6 位验证码。验证码将在 10 分钟后失效。</div>
          <label><span className="auth-label">邮箱验证码</span><input className="community-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} aria-label="6 位邮箱验证码" required /></label>
          <div className="community-cta-row"><button className="community-button auth-button" type="submit" disabled={loading}>{loading ? "验证中..." : "验证并继续"}</button><button className="community-button--secondary auth-button" type="button" onClick={cancelOtp} disabled={loading}>取消并返回登录</button></div>
          <button type="button" className="auth-forgot-link" onClick={handleOtpResend} disabled={resending || resendCooldownSeconds > 0}>{resending ? "发送中..." : resendCooldownSeconds > 0 ? `${resendCooldownSeconds} 秒后可重新发送` : "重新发送验证码"}</button>
        </form>
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
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
            <button type="button" className="auth-password-toggle" aria-pressed={showPassword} aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? "◉" : "◌"}<span className="sr-only">{showPassword ? "隐藏密码" : "显示密码"}</span></button>
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
              我已阅读并同意
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
                By continuing, I agree to the{" "}
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

      <div ref={turnstile.containerRef} aria-hidden="true" />

      <div className="auth-feedback">
        {error ? <div className="auth-alert auth-alert--error" role="alert">{error}</div> : null}
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
