import { useMemo, useState } from "react";
import { createClient, type User } from "@supabase/supabase-js";

type Mode = "login" | "signup";

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

export default function AuthPanel() {
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

  const supabase = useMemo(() => {
    if (!supabaseUrl || !supabaseAnonKey) return null;
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }, [supabaseAnonKey, supabaseUrl]);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [postCircleSlug, setPostCircleSlug] = useState("xreal");
  const [postType, setPostType] = useState("question");
  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [postMessage, setPostMessage] = useState("");
  const [postError, setPostError] = useState("");

  async function refreshSession() {
    if (!supabase) return;
    const { data, error: sessionError } = await supabase.auth.getUser();
    if (sessionError) {
      setError(sessionError.message);
      setUser(null);
      return;
    }
    setUser(data.user ?? null);
  }

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
        setMessage("登录成功。");
      } else {
        const emailRedirectTo =
          typeof window !== "undefined"
            ? `${window.location.origin}/forum/`
            : undefined;
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo,
          },
        });
        if (signUpError) throw signUpError;
        setMessage("注册请求已提交。若开启邮箱确认，请先完成验证。");
      }
      await refreshSession();
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
    } else {
      setUser(null);
      setMessage("已退出登录。");
    }
    setLoading(false);
  }

  async function handleCreatePost(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || !user) return;

    setPostSubmitting(true);
    setPostError("");
    setPostMessage("");

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) {
        throw new Error("Auth session missing!");
      }

      const response = await fetch("/api/forum/posts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({
          circle_slug: postCircleSlug.trim(),
          type: postType.trim(),
          title: postTitle.trim(),
          body: postBody.trim(),
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; post?: { id: string; status: string } }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? `Request failed with status ${response.status}`);
      }

      setPostMessage(
        `帖子提交成功，状态：${payload?.post?.status ?? "pending"}，ID：${payload?.post?.id ?? "-"}`,
      );
      setPostTitle("");
      setPostBody("");
    } catch (submitError) {
      setPostError(submitError instanceof Error ? submitError.message : "提交失败。");
    } finally {
      setPostSubmitting(false);
    }
  }

  if (!supabase) {
    return (
      <section style={wrapperStyle}>
        <h2>Forum Auth 未配置</h2>
        <p>缺少 PUBLIC_SUPABASE_URL 或 PUBLIC_SUPABASE_ANON_KEY。</p>
      </section>
    );
  }

  return (
    <section style={wrapperStyle}>
      <h2>Forum Auth</h2>
      <p>当前阶段只开放基础认证与会话门控。发帖接口在下一阶段接入。</p>
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
        <button type="button" onClick={refreshSession} style={secondaryButtonStyle}>
          刷新会话
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

      <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
        {error ? <div style={messageStyle}>错误：{error}</div> : null}
        {message ? <div style={messageStyle}>{message}</div> : null}
      </div>

      <div style={{ marginTop: "1rem", ...messageStyle }}>
        {user ? (
          <>
            <p>
              当前用户：<strong>{user.email}</strong>
            </p>
            <p>用户 ID：{user.id}</p>
            <button type="button" style={secondaryButtonStyle} onClick={handleSignOut}>
              退出登录
            </button>
            <p style={{ marginTop: "0.75rem" }}>你已通过最小门控，可进入下一阶段发帖 API 测试。</p>
            <form onSubmit={handleCreatePost} style={{ ...stackStyle, marginTop: "1rem" }}>
              <h3 style={{ margin: 0 }}>最小发帖测试（Phase 3.2）</h3>
              <label>
                Circle Slug
                <input
                  style={inputStyle}
                  value={postCircleSlug}
                  onChange={(event) => setPostCircleSlug(event.target.value)}
                  required
                />
              </label>
              <label>
                类型
                <select
                  style={inputStyle}
                  value={postType}
                  onChange={(event) => setPostType(event.target.value)}
                >
                  <option value="experience">experience</option>
                  <option value="question">question</option>
                  <option value="review">review</option>
                  <option value="dev">dev</option>
                  <option value="news">news</option>
                  <option value="feedback">feedback</option>
                </select>
              </label>
              <label>
                标题
                <input
                  style={inputStyle}
                  value={postTitle}
                  onChange={(event) => setPostTitle(event.target.value)}
                  minLength={3}
                  maxLength={180}
                  required
                />
              </label>
              <label>
                内容
                <textarea
                  style={{ ...inputStyle, minHeight: "120px", resize: "vertical" }}
                  value={postBody}
                  onChange={(event) => setPostBody(event.target.value)}
                  minLength={10}
                  maxLength={20000}
                  required
                />
              </label>
              <button type="submit" style={buttonStyle} disabled={postSubmitting}>
                {postSubmitting ? "提交中..." : "提交帖子（应为 pending）"}
              </button>
              {postError ? <div style={messageStyle}>错误：{postError}</div> : null}
              {postMessage ? <div style={messageStyle}>{postMessage}</div> : null}
            </form>
          </>
        ) : (
          <p>未登录。未登录用户在 Forum Phase 3 不能发帖或评论。</p>
        )}
      </div>
    </section>
  );
}
