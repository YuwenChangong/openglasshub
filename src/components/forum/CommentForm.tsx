import { useEffect, useMemo, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useInvisibleTurnstile } from "./useInvisibleTurnstile";

interface CommentFormProps {
  postId: string;
  parentId?: string | null;
  placeholder?: string;
  onCommentCreated?: (comment: unknown) => void;
  loginHref?: string;
  inline?: boolean;
  onCancel?: () => void;
}

export default function CommentForm({
  postId,
  parentId,
  placeholder,
  onCommentCreated,
  loginHref,
  inline,
  onCancel,
}: CommentFormProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const resolvedLoginHref = loginHref ?? buildLoginHref(`/posts/${postId}/#comments`);
  const resolvedPlaceholder = placeholder ?? "写下你的想法...";
  const {
    siteKeyEnabled,
    ready: turnstileReady,
    error: turnstileError,
    containerRef,
    ensureToken,
    resetToken,
  } = useInvisibleTurnstile("评论验证失败，请刷新后重试。");

  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

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

      const turnstileToken = await ensureToken({ forceRefresh: true });
      const reqBody: Record<string, unknown> = {
        post_id: postId,
        body: body.trim(),
        turnstile_token: turnstileToken || undefined,
      };
      if (parentId) reqBody.parent_id = parentId;

      const response = await fetch("/api/forum/comments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify(reqBody),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; code?: string; comment?: Record<string, unknown> }
        | null;

      if (!response.ok) {
        throw new Error(
          payload?.code ? `${payload.code}: ${payload.error ?? ""}` : payload?.error ?? `请求失败 (${response.status})`,
        );
      }

      setBody("");
      setSuccess(true);
      resetToken();
      onCommentCreated?.(payload?.comment ?? { id: "", post_id: postId, body: body.trim() });
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "提交失败";
      if (/TURNSTILE_REQUIRED/i.test(message)) {
        setError("请先完成安全验证后再评论。");
      } else if (/TURNSTILE_INVALID/i.test(message)) {
        setError("评论验证失败，请刷新页面后重试。");
      } else if (/RATE_LIMITED/i.test(message)) {
        setError("评论过于频繁，请稍后再试。");
      } else {
        setError(message);
      }
      resetToken();
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
    if (inline) return null;
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

  const panelClass = inline
    ? "glass-card comment-panel comment-panel--inline comment-reply-form__panel"
    : "glass-panel comment-panel";
  const shellTag = inline ? "div" : "section";
  const Shell = shellTag as keyof JSX.IntrinsicElements;

  return (
    <Shell className={inline ? "comment-reply-form" : "comment-shell"}>
      <div className={panelClass}>
        {!inline && <h3 className="comment-panel__title">发表评论</h3>}
        <form onSubmit={handleSubmit} className="comment-form">
          <textarea
            className="glass-textarea"
            value={body}
            onChange={handleBodyChange}
            placeholder={resolvedPlaceholder}
            minLength={1}
            maxLength={5000}
            required
            rows={inline ? 3 : undefined}
          />
          <div className="comment-form__footer">
            <span className="community-meta">{body.length}/5000</span>
            <div className="comment-form__actions">
              {inline && onCancel ? (
                <button
                  type="button"
                  className="community-action-button community-action-button--muted"
                  onClick={onCancel}
                  disabled={loading}
                >
                  取消回复
                </button>
              ) : null}
              <button type="submit" className="community-button" disabled={loading || !body.trim()}>
                {loading ? "提交中..." : parentId ? "发布回复" : "发布评论"}
              </button>
            </div>
          </div>
        </form>
        {error && <div className="comment-inline-error">{error}</div>}
        {success && <div className="comment-inline-success">评论发布成功。</div>}
        {turnstileError && <div className="comment-inline-error">{turnstileError}</div>}
        {!turnstileReady && siteKeyEnabled && <div className="community-meta">正在初始化评论验证…</div>}
        <div ref={containerRef} aria-hidden="true" style={{ position: "absolute", insetInlineStart: "-9999px" }} />
      </div>
    </Shell>
  );
}
