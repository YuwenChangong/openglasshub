import { useMemo, useState } from "react";
import { buildAuthCallbackRedirect, buildResetPasswordRedirect, getSafeNext } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";

type Mode = "login" | "signup";

interface AuthPanelProps {
  next?: string;
}

function mapAuthError(errorMessage: string): string {
  if (/Invalid login credentials/i.test(errorMessage)) return "邮箱或密码错误。";
  if (/Email not confirmed/i.test(errorMessage)) return "请先完成邮箱验证后再登录。";
  if (/User already registered/i.test(errorMessage)) return "如果账号已存在，请直接登录；如果账号尚未完成验证，可以重新发送验证邮件。";
  if (/Password should be at least/i.test(errorMessage)) return "密码长度至少为 8 位。";
  return errorMessage;
}

export default function AuthPanel({ next }: AuthPanelProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const safeNext = useMemo(() => {
    if (next) return getSafeNext(next);
    if (typeof window === "undefined") return "/";
    return getSafeNext(new URLSearchParams(window.location.search).get("next"));
  }, [next]);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [resending, setResending] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState("");
  const [forgotMode, setForgotMode] = useState(false);
  const { status, user } = useBrowserAuthState(supabase);

  async function handleAuthSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;

    setLoading(true);
    setError("");
    setMessage("");

    try {
      if (mode === "login") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        window.location.assign(safeNext);
        return;
      }

      const emailRedirectTo =
        typeof window !== "undefined"
          ? buildAuthCallbackRedirect(window.location.origin, safeNext)
          : undefined;

      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo,
        },
      });
      if (signUpError) throw signUpError;

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
    if (!supabase || !pendingVerificationEmail) return;

    setResending(true);
    setError("");
    setMessage("");

    try {
      const emailRedirectTo =
        typeof window !== "undefined"
          ? buildAuthCallbackRedirect(window.location.origin, safeNext)
          : undefined;

      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: pendingVerificationEmail,
        options: emailRedirectTo ? { emailRedirectTo } : undefined,
      });

      if (resendError) {
        throw resendError;
      }

      setMessage("如果账号已存在且尚未验证，我们会尝试重新发送验证邮件。");
    } catch {
      setError("暂时无法重新发送验证邮件，请稍后再试。");
    } finally {
      setResending(false);
    }
  }

  async function handleResetPasswordEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;

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
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(mapAuthError(signOutError.message));
      setLoading(false);
      return;
    }
    window.location.reload();
  }

  if (!supabase) {
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
            onClick={() => setMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            className={mode === "signup" ? "is-active" : ""}
            onClick={() => setMode("signup")}
          >
            注册
          </button>
        </div>
        <div className="auth-next-note">登录后将返回：{safeNext}</div>
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
            <button type="button" className="community-button--secondary auth-button" onClick={handleSignOut} disabled={loading}>
              {loading ? "处理中..." : "退出登录"}
            </button>
          </div>
        </div>
      ) : (
        forgotMode ? (
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
                onClick={() => {
                  setForgotMode(false);
                  setError("");
                  setMessage("");
                }}
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
            <div className="community-cta-row">
              <button className="community-button auth-button" type="submit" disabled={loading}>
                {loading ? "处理中..." : mode === "login" ? "登录" : "注册"}
              </button>
              <button
                type="button"
                className="community-button--secondary auth-button"
                onClick={() => setMode(mode === "login" ? "signup" : "login")}
                disabled={loading}
              >
                {mode === "login" ? "切换到注册" : "切换到登录"}
              </button>
            </div>
            {mode === "login" && (
              <button
                type="button"
                className="auth-forgot-link"
                onClick={() => {
                  setForgotMode(true);
                  setError("");
                  setMessage("");
                }}
              >
                忘记密码？
              </button>
            )}
          </form>
        )
      )}

      <div className="auth-feedback">
        {error ? <div className="auth-alert auth-alert--error">{error}</div> : null}
        {message ? <div className="auth-alert auth-alert--success">{message}</div> : null}
        {pendingVerificationEmail ? (
          <div className="auth-resend">
            <span className="auth-next-note">如果账号已存在且尚未验证，可以重新发送验证邮件。</span>
            <button
              type="button"
              className="community-button--secondary auth-button"
              onClick={handleResendConfirmation}
              disabled={resending}
            >
              {resending ? "发送中..." : "重新发送验证邮件"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
