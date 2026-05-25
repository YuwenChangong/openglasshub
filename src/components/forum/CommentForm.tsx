import { useEffect, useMemo, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

interface CommentFormProps {
  postId: string;
  onCommentCreated?: () => void;
  loginHref?: string;
}

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
      <section className="comment-shell">
        <div className="glass-panel comment-panel comment-panel__login">
          <p className="community-meta">评论功能未配置</p>
        </div>
      </section>
    );
  }

  if (isLoggedIn === false) {
    return (
      <section className="comment-shell">
        <div className="glass-panel comment-panel comment-panel__login">
          <p className="community-meta" style={{ margin: "0 0 0.75rem" }}>
          登录后即可发表评论
          </p>
          <a href={resolvedLoginHref} className="community-button">
            前往登录
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="comment-shell">
      <div className="glass-panel comment-panel">
      <h3 className="comment-panel__title">发表评论</h3>
      <form onSubmit={handleSubmit} className="comment-form">
        <textarea
          className="glass-textarea"
          value={body}
          onChange={handleBodyChange}
          placeholder="写下你的想法..."
          minLength={1}
          maxLength={5000}
          required
        />
        <div className="comment-form__footer">
          <span className="community-meta">
            {body.length}/5000
          </span>
          <button type="submit" className="community-button" disabled={loading || !body.trim()}>
            {loading ? "提交中..." : "发布评论"}
          </button>
        </div>
      </form>
      {error && (
        <div className="auth-alert auth-alert--error">
          {error}
        </div>
      )}
      {success && (
        <div className="auth-alert auth-alert--success">
          评论发布成功。
        </div>
      )}
      </div>
    </section>
  );
}
