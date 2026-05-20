import { useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

interface CommentFormProps {
  postId: string;
  onCommentCreated?: () => void;
}

const wrapperStyle: React.CSSProperties = {
  maxWidth: "760px",
  margin: "1.5rem 0",
  padding: "1.25rem",
  border: "1px solid #2a2e45",
  borderRadius: "0.75rem",
  background: "#111527",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  background: "#0a0d1a",
  border: "1px solid #2a2e45",
  borderRadius: "0.5rem",
  color: "#e8edf8",
  padding: "0.75rem",
  minHeight: "80px",
  resize: "vertical",
  fontFamily: "inherit",
  fontSize: "0.95rem",
};

const buttonStyle: React.CSSProperties = {
  borderRadius: "0.5rem",
  border: "1px solid #6366f1",
  background: "#6366f1",
  color: "#fff",
  fontWeight: 600,
  padding: "0.5rem 1.25rem",
  cursor: "pointer",
  fontSize: "0.9rem",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  border: "1px solid #2a2e45",
  background: "transparent",
  color: "#a0a8c0",
};

const messageStyle: React.CSSProperties = {
  border: "1px solid #2a2e45",
  borderRadius: "0.5rem",
  padding: "0.75rem",
  fontSize: "0.9rem",
  marginTop: "0.75rem",
};

const loginBoxStyle: React.CSSProperties = {
  ...wrapperStyle,
  textAlign: "center" as const,
};

export default function CommentForm({ postId, onCommentCreated }: CommentFormProps) {
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

  const supabase = useMemo(() => {
    if (!supabaseUrl || !supabaseAnonKey) return null;
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }, [supabaseAnonKey, supabaseUrl]);

  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  // Check session on mount
  useMemo(async () => {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    setIsLoggedIn(!!data.session);
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
        <p style={{ color: "#5a6480" }}>评论功能未配置</p>
      </section>
    );
  }

  if (isLoggedIn === false) {
    return (
      <section style={loginBoxStyle}>
        <p style={{ color: "#a0a8c0", marginBottom: "0.75rem" }}>
          登录后即可发表评论
        </p>
        <a href="/forum/" style={buttonStyle}>
          前往登录
        </a>
      </section>
    );
  }

  return (
    <section style={wrapperStyle}>
      <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", color: "#e8edf8" }}>
        💬 发表评论
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
          ❌ {error}
        </div>
      )}
      {success && (
        <div style={{ ...messageStyle, borderColor: "#22c55e", color: "#86efac" }}>
          ✅ 评论发布成功！
        </div>
      )}
    </section>
  );
}