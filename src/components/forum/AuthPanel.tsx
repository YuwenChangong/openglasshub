import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSafeNext } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

type Mode = "login" | "signup";

interface AuthPanelProps {
  next?: string;
}

const wrapperStyle: React.CSSProperties = {
  maxWidth: "760px",
  margin: "2rem auto",
  padding: "1.5rem",
  border: "1px solid var(--sl-color-gray-5)",
  borderRadius: "0.75rem",
  background: "var(--sl-color-bg-nav)",
};

const stackStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.75rem",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--sl-color-black)",
  border: "1px solid var(--sl-color-gray-5)",
  borderRadius: "0.5rem",
  color: "var(--sl-color-white)",
  padding: "0.625rem 0.75rem",
};

const buttonStyle: React.CSSProperties = {
  borderRadius: "0.5rem",
  border: "1px solid var(--sl-color-accent)",
  background: "var(--sl-color-accent)",
  color: "var(--sl-color-white)",
  fontWeight: 600,
  padding: "0.625rem 0.875rem",
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  border: "1px solid var(--sl-color-gray-5)",
  background: "transparent",
};

const messageStyle: React.CSSProperties = {
  border: "1px solid var(--sl-color-gray-5)",
  borderRadius: "0.5rem",
  padding: "0.75rem",
  fontSize: "0.95rem",
};

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
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setCheckingSession(false);
      return;
    }

    let mounted = true;

    supabase.auth.getUser().then(({ data, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) {
        setError(sessionError.message);
        setUser(null);
      } else {
        setUser(data.user ?? null);
      }
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
          ? `${window.location.origin}/auth/callback/?next=${encodeURIComponent(safeNext)}`
          : undefined;

      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo,
        },
      });
      if (signUpError) throw signUpError;

      setMessage("注册请求已提交。请在 Brevo 确认邮件中完成验证，验证后会返回站内继续。");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "请求失败。");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    if (!supabase) return;
    setLoading(true);
    setError("");
    setMessage("");
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
      setLoading(false);
      return;
    }
    setUser(null);
    setMessage("已退出登录。");
    setLoading(false);
  }

  if (!supabase) {
    return (
      <section style={wrapperStyle}>
        <h2>登录暂不可用</h2>
        <p>缺少 `PUBLIC_SUPABASE_URL` 或 `PUBLIC_SUPABASE_ANON_KEY`。</p>
      </section>
    );
  }

  return (
    <section style={wrapperStyle}>
      <h2>登录 OpenGlass Hub</h2>
      <p>浏览内容无需登录。发帖、评论等互动操作需要先登录。</p>

      <div style={{ ...messageStyle, marginBottom: "1rem" }}>
        登录后将返回：<strong>{safeNext}</strong>
      </div>

      {checkingSession ? (
        <div style={messageStyle}>正在检查当前登录状态...</div>
      ) : user ? (
        <div style={{ ...stackStyle, marginTop: "1rem" }}>
          <div style={messageStyle}>
            当前已登录：<strong>{user.email}</strong>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <a href={safeNext} style={buttonStyle}>
              继续前往
            </a>
            <button type="button" style={secondaryButtonStyle} onClick={handleSignOut} disabled={loading}>
              {loading ? "处理中..." : "退出登录"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <button
              type="button"
              onClick={() => setMode("login")}
              style={mode === "login" ? buttonStyle : secondaryButtonStyle}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              style={mode === "signup" ? buttonStyle : secondaryButtonStyle}
            >
              注册
            </button>
          </div>

          <form onSubmit={handleAuthSubmit} style={stackStyle}>
            <label>
              邮箱
              <input
                style={inputStyle}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              密码
              <input
                style={inputStyle}
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
              />
            </label>
            <button style={buttonStyle} type="submit" disabled={loading}>
              {loading ? "处理中..." : mode === "login" ? "登录" : "注册"}
            </button>
          </form>
        </>
      )}

      <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
        {error ? <div style={messageStyle}>错误：{error}</div> : null}
        {message ? <div style={messageStyle}>{message}</div> : null}
      </div>
    </section>
  );
}
