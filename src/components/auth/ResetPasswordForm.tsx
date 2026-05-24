import { useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

export default function ResetPasswordForm() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) {
      setError("缺少 PUBLIC_SUPABASE_URL 或 PUBLIC_SUPABASE_ANON_KEY。");
      return;
    }

    let mounted = true;
    let timeoutId: number | undefined;

    async function ensureRecoverySession() {
      const currentUrl = new URL(window.location.href);
      const code = currentUrl.searchParams.get("code");
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          throw exchangeError;
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (data.session) {
        setReady(true);
      }
    }

    async function boot() {
      try {
        await ensureRecoverySession();

        const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
          if (!mounted) return;
          if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
            setReady(true);
          }
        });

        timeoutId = window.setTimeout(() => {
          if (!mounted) return;
          if (!ready) {
            setError("未检测到可用的重置会话。请重新通过邮件中的重置链接进入。");
          }
        }, 2800);

        return () => {
          listener.subscription.unsubscribe();
        };
      } catch {
        if (!mounted) return;
        setError("重置链接无效或已过期，请重新发起忘记密码流程。");
      }
    }

    let unsubscribe: (() => void) | undefined;
    boot().then((cleanup) => {
      unsubscribe = cleanup;
    });

    return () => {
      mounted = false;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      unsubscribe?.();
    };
  }, [supabase, ready]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;

    setError("");
    setMessage("");

    const trimmedPassword = newPassword.trim();
    const trimmedConfirm = confirmPassword.trim();

    if (!trimmedPassword) {
      setError("新密码不能为空。");
      return;
    }
    if (trimmedPassword.length < 8) {
      setError("密码长度至少为 8 位。");
      return;
    }
    if (trimmedPassword !== trimmedConfirm) {
      setError("两次输入的密码不一致。");
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: trimmedPassword });
      if (updateError) {
        throw updateError;
      }

      setMessage("密码已更新，请重新登录。");
      window.setTimeout(() => {
        window.location.assign("/login/");
      }, 1200);
    } catch {
      setError("更新密码失败，请重新进入邮件中的链接后再试。");
    } finally {
      setLoading(false);
    }
  }

  if (!supabase) {
    return <section className="auth-card"><div className="auth-alert auth-alert--error">{error}</div></section>;
  }

  return (
    <section className="auth-card">
      <div className="auth-card__top">
        <h2 style={{ margin: 0 }}>重置密码</h2>
        <p style={{ margin: 0, color: "var(--text-muted)" }}>请设置新密码，更新后使用新密码登录。</p>
      </div>

      {!ready ? (
        <div className="auth-alert">正在验证重置会话...</div>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            <span className="auth-label">新密码</span>
            <input
              className="community-input"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          <label>
            <span className="auth-label">确认新密码</span>
            <input
              className="community-input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          <div className="community-cta-row">
            <button className="community-button auth-button" type="submit" disabled={loading}>
              {loading ? "更新中..." : "更新密码"}
            </button>
            <a href="/login/" className="community-button--secondary">
              返回登录
            </a>
          </div>
        </form>
      )}

      <div className="auth-feedback">
        {error ? <div className="auth-alert auth-alert--error">{error}</div> : null}
        {message ? <div className="auth-alert auth-alert--success">{message}</div> : null}
      </div>
    </section>
  );
}
