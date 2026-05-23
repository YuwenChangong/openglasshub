import { useEffect, useMemo, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

interface CommentFormProps {
  postId: string;
  onCommentCreated?: () => void;
  loginHref?: string;
}

const wrapperStyle: React.CSSProperties = {
  maxWidth: "860px",
  margin: "1.5rem 0",
  padding: "1.2rem",
  border: "1px solid #20283a",
  borderRadius: "1rem",
  background: "#0f1624",
  boxShadow: "0 16px 38px rgba(3, 8, 18, 0.2)",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  background: "#0c1220",
  border: "1px solid #25314a",
  borderRadius: "0.75rem",
  color: "#e8edf8",
  padding: "0.75rem",
  minHeight: "80px",
  resize: "vertical",
  fontFamily: "inherit",
  fontSize: "0.95rem",
};

const buttonStyle: React.CSSProperties = {
  borderRadius: "0.75rem",
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "#fff",
  fontWeight: 600,
  padding: "0.5rem 1.25rem",
  cursor: "pointer",
  fontSize: "0.9rem",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  border: "1px solid #25314a",
  background: "#111827",
  color: "#aab5d1",
};

const messageStyle: React.CSSProperties = {
  border: "1px solid #25314a",
  borderRadius: "0.75rem",
  padding: "0.75rem",
  fontSize: "0.9rem",
  marginTop: "0.75rem",
  background: "#101827",
};

const loginBoxStyle: React.CSSProperties = {
  ...wrapperStyle,
  textAlign: "center" as const,
};

export default function CommentForm({ postId, onCommentCreated, loginHref }: CommentFormProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const resolvedLoginHref = loginHref ?? buildLoginHref(`/posts/${postId}/#comments`);

  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  // Check session on mount (useEffect for side-effects, not useMemo)
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setIsLoggedIn(!!data.session);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // Reset success state when body changes
  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setBody(e.target.value);
    if (success) setSuccess(false);
    if (error) setError("");
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !body.trim()) return;

    setLoading(true);
    setError("");
    setSuccess(false);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) {
        throw new Error("请先登录后再评论");
      }

      const response = await fetch("/api/forum/comments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({ post_id: postId, body: body.trim() }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; comment?: { id: string } }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? `请求失败 (${response.status})`);
      }

      setBody("");
      setSuccess(true);
      onCommentCreated?.();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交失败");
    } finally {
      setLoading(false);
    }
  }

  if (!supabase) {
    return (
      <section style={loginBoxStyle}>
        <p style={{ color: "#7d8fb0" }}>评论功能未配置</p>
      </section>
    );
  }

  if (isLoggedIn === false) {
    return (
      <section style={loginBoxStyle}>
        <p style={{ color: "#a0a8c0", marginBottom: "0.75rem" }}>
          登录后即可发表评论
        </p>
        <a href={resolvedLoginHref} style={buttonStyle}>
          前往登录
        </a>
      </section>
    );
  }

  return (
    <section style={wrapperStyle}>
      <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.08rem", color: "#e8edf8" }}>
        发表评论
      </h3>
      <form onSubmit={handleSubmit}>
        <textarea
          style={textareaStyle}
          value={body}
          onChange={handleBodyChange}
          placeholder="写下你的想法..."
          minLength={1}
          maxLength={5000}
          required
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "0.75rem",
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "#5a6480" }}>
            {body.length}/5000
          </span>
          <button type="submit" style={buttonStyle} disabled={loading || !body.trim()}>
            {loading ? "提交中..." : "发布评论"}
          </button>
        </div>
      </form>
      {error && (
        <div style={{ ...messageStyle, borderColor: "#ef4444", color: "#fca5a5" }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ ...messageStyle, borderColor: "#22c55e", color: "#86efac" }}>
          评论发布成功。
        </div>
      )}
    </section>
  );
}
