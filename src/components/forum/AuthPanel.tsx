import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { buildAuthCallbackRedirect, getSafeNext } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

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
  const [resending, setResending] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState("");

  useEffect(() => {
    if (!supabase) {
      setCheckingSession(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user ?? null);
      setCheckingSession(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      setCheckingSession(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

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
    setUser(null);
    setMessage("已退出登录。");
    setLoading(false);
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

      {checkingSession ? (
        <div className="auth-alert">正在检查当前登录状态...</div>
      ) : user ? (
        <div className="auth-user-state">
          <div className="auth-alert auth-alert--success">
            当前已登录：<strong>{user.email}</strong>
          </div>
          <div className="community-cta-row">
            <a href={safeNext} className="community-button">
              继续前往
            </a>
            <button type="button" className="community-button--secondary auth-button" onClick={handleSignOut} disabled={loading}>
              {loading ? "处理中..." : "退出登录"}
            </button>
          </div>
        </div>
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
        </form>
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
