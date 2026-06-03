import { useEffect, useMemo, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

interface CommentFormProps {
  postId: string;
  parentId?: string | null;
  placeholder?: string;
  onCommentCreated?: (comment: unknown) => void;
  loginHref?: string;
  inline?: boolean;
}

export default function CommentForm({
  postId,
  parentId,
  placeholder,
  onCommentCreated,
  loginHref,
  inline,
}: CommentFormProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const resolvedLoginHref = loginHref ?? buildLoginHref(`/posts/${postId}/#comments`);
  const resolvedPlaceholder = placeholder ?? "\u5199\u4e0b\u4f60\u7684\u60f3\u6cd5...";

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
        throw new Error("\u8bf7\u5148\u767b\u5f55\u540e\u518d\u8bc4\u8bba");
      }

      const reqBody: Record<string, unknown> = { post_id: postId, body: body.trim() };
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
        | { error?: string; comment?: Record<string, unknown> }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? `\u8bf7\u6c42\u5931\u8d25 (${response.status})`);
      }

      setBody("");
      setSuccess(true);
      onCommentCreated?.(payload?.comment ?? { id: "", post_id: postId, body: body.trim() });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "\u63d0\u4ea4\u5931\u8d25");
    } finally {
      setLoading(false);
    }
  }

  if (!supabase) {
    return (
      <section className="comment-shell">
        <div className="glass-panel comment-panel comment-panel__login">
          <p className="community-meta">\u8bc4\u8bba\u529f\u80fd\u672a\u914d\u7f6e</p>
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
            \u767b\u5f55\u540e\u5373\u53ef\u53d1\u8868\u8bc4\u8bba
          </p>
          <a href={resolvedLoginHref} className="community-button">
            \u524d\u5f80\u767b\u5f55
          </a>
        </div>
      </section>
    );
  }

  const panelClass = inline ? "comment-panel comment-panel--inline" : "glass-panel comment-panel";
  const shellTag = inline ? "div" : "section";

  const Shell = shellTag as keyof JSX.IntrinsicElements;

  return (
    <Shell className={inline ? "comment-reply-form" : "comment-shell"}>
      <div className={panelClass}>
        {!inline && <h3 className="comment-panel__title">\u53d1\u8868\u8bc4\u8bba</h3>}
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
            <button type="submit" className="community-button" disabled={loading || !body.trim()}>
              {loading ? "\u63d0\u4ea4\u4e2d..." : parentId ? "\u53d1\u5e03\u56de\u590d" : "\u53d1\u5e03\u8bc4\u8bba"}
            </button>
          </div>
        </form>
        {error && <div className="comment-inline-error">{error}</div>}
        {success && <div className="comment-inline-success">\u8bc4\u8bba\u53d1\u5e03\u6210\u529f\u3002</div>}
      </div>
    </Shell>
  );
}
