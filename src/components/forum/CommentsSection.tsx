import { useEffect, useMemo, useState, useCallback } from "react";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import CommentForm from "./CommentForm";

interface Author {
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: string | null;
}

interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  status: string;
  created_at: string;
  updated_at: string;
  author: Author | null;
  like_count: number;
  liked_by_me: boolean;
  reply_count: number;
  can_delete: boolean;
}

interface CommentsSectionProps {
  postId: string;
  refreshKey?: number;
  loginHref?: string;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function authorDisplayName(author: Author | null): string {
  return author?.display_name || author?.username || "\u793e\u533a\u6210\u5458";
}

function isStaff(author: Author | null): boolean {
  return author?.role === "moderator" || author?.role === "admin";
}

export default function CommentsSection({ postId, refreshKey, loginHref }: CommentsSectionProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let headers: Record<string, string> = {};
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) {
          headers.authorization = `Bearer ${data.session.access_token}`;
        }
      }
      const res = await fetch(`/api/forum/comments?post_id=${encodeURIComponent(postId)}`, { headers });
      const data = (await res.json().catch(() => null)) as { comments?: Comment[]; error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? `\u8bf7\u6c42\u5931\u8d25 (${res.status})`);
      setComments(data?.comments ?? []);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "\u52a0\u8f7d\u8bc4\u8bba\u5931\u8d25");
    } finally {
      setLoading(false);
    }
  }, [postId, supabase]);

  useEffect(() => {
    let cancelled = false;
    if (!cancelled) fetchComments();
    return () => { cancelled = true; };
  }, [fetchComments, refreshKey]);

  const handleCommentCreated = useCallback((newComment: Comment) => {
    setComments((prev) => [...prev, newComment]);
    setReplyingTo(null);
  }, []);

  const handleToggleLike = useCallback(async (commentId: string) => {
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.access_token) return;

    try {
      const res = await fetch("/api/forum/comments", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({ comment_id: commentId }),
      });
      const payload = (await res.json().catch(() => null)) as { liked?: boolean; like_count?: number; error?: string } | null;
      if (!res.ok) throw new Error(payload?.error ?? "\u64cd\u4f5c\u5931\u8d25");

      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, liked_by_me: payload?.liked ?? false, like_count: payload?.like_count ?? c.like_count }
            : c,
        ),
      );
    } catch {
      // Silently fail for likes
    }
  }, [supabase]);

  const handleDeleteClick = useCallback((commentId: string) => {
    setConfirmDeleteId(commentId);
    setTimeout(() => {
      setConfirmDeleteId((current) => (current === commentId ? null : current));
    }, 5000);
  }, []);

  const handleConfirmDelete = useCallback(async (commentId: string) => {
    if (!supabase) return;
    setDeletingId(commentId);
    setConfirmDeleteId(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.access_token) throw new Error("\u8bf7\u5148\u767b\u5f55");

      const res = await fetch(`/api/forum/comments?id=${encodeURIComponent(commentId)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionData.session.access_token}` },
      });
      const payload = (await res.json().catch(() => null)) as { deleted?: boolean; has_replies?: boolean; error?: string } | null;
      if (!res.ok) throw new Error(payload?.error ?? "\u5220\u9664\u5931\u8d25");

      if (payload?.has_replies) {
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, status: "deleted", body: "", like_count: 0 } : c)),
        );
      } else {
        setComments((prev) => prev.filter((c) => c.id !== commentId));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "\u5220\u9664\u5931\u8d25");
    } finally {
      setDeletingId(null);
    }
  }, [supabase]);

  const handleCancelDelete = useCallback(() => {
    setConfirmDeleteId(null);
  }, []);

  const topLevelComments = comments.filter((c) => !c.parent_id || c.status === "deleted");
  const repliesByParent = new Map<string, Comment[]>();
  for (const c of comments) {
    if (c.parent_id && c.status !== "deleted") {
      const list = repliesByParent.get(c.parent_id) ?? [];
      list.push(c);
      repliesByParent.set(c.parent_id, list);
    }
  }

  const totalCount = comments.filter((c) => c.status !== "deleted").length;

  const renderComment = (comment: Comment, isReply: boolean) => {
    const isDeleted = comment.status === "deleted";
    const replies = repliesByParent.get(comment.id) ?? [];
    const isConfirming = confirmDeleteId === comment.id;
    const isDeleting = deletingId === comment.id;
    const authorName = isDeleted ? "\u533f\u540d" : authorDisplayName(comment.author);
    const showReplyForm = replyingTo === comment.id;

    return (
      <div key={comment.id} className={isReply ? "comment-thread comment-thread--reply" : "comment-thread"}>
        <article className={`glass-card comment-card${isDeleted ? " comment-deleted" : ""}`}>
          <div className="comment-card__meta">
            <span className={isStaff(comment.author) ? "comment-author--staff" : ""}>
              {authorName}
              {isStaff(comment.author) && !isDeleted && (
                <span className="comment-staff-badge">{comment.author?.role === "admin" ? "\u7ba1\u7406\u5458" : "\u7248\u4e3b"}</span>
              )}
            </span>
            <span>{formatDate(comment.created_at)}</span>
            {comment.updated_at && comment.updated_at !== comment.created_at && !isDeleted && (
              <span>\u5df2\u7f16\u8f91</span>
            )}
          </div>

          {isDeleted ? (
            <div className="comment-card__body comment-card__body--deleted">
              \u8be5\u8bc4\u8bba\u5df2\u5220\u9664
            </div>
          ) : (
            <div className="comment-card__body">{comment.body}</div>
          )}

          {!isDeleted && (
            <div className="comment-action-row">
              <button
                className={`comment-action-button${comment.liked_by_me ? " comment-liked" : ""}`}
                onClick={() => handleToggleLike(comment.id)}
                disabled={!supabase}
                aria-label={comment.liked_by_me ? "\u53d6\u6d88\u70b9\u8d5e" : "\u70b9\u8d5e"}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill={comment.liked_by_me ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                {comment.like_count > 0 && <span>{comment.like_count}</span>}
              </button>

              <button
                className="comment-action-button"
                onClick={() => setReplyingTo(showReplyForm ? null : comment.id)}
                disabled={!supabase}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 17 4 12 9 7" />
                  <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                </svg>
                {comment.reply_count > 0 && <span>{comment.reply_count}</span>}
              </button>

              {comment.can_delete && (
                isConfirming ? (
                  <span className="comment-delete-confirm">
                    <button className="comment-action-button comment-action-button--danger" onClick={() => handleConfirmDelete(comment.id)} disabled={isDeleting}>
                      {isDeleting ? "\u5220\u9664\u4e2d..." : "\u786e\u8ba4\u5220\u9664"}
                    </button>
                    <button className="comment-action-button" onClick={handleCancelDelete}>\u53d6\u6d88</button>
                  </span>
                ) : (
                  <button
                    className="comment-action-button comment-action-button--danger"
                    onClick={() => handleDeleteClick(comment.id)}
                    disabled={isDeleting}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                    </svg>
                    \u5220\u9664
                  </button>
                )
              )}
            </div>
          )}
        </article>

        {replies.length > 0 && (
          <div className="comment-replies">
            {replies.map((reply) => renderComment(reply, true))}
          </div>
        )}

        {showReplyForm && (
          <div className="comment-reply-form">
            <CommentForm
              postId={postId}
              parentId={comment.id}
              placeholder={"\u56de\u590d\u8fd9\u6761\u8bc4\u8bba..."}
              onCommentCreated={(c) => handleCommentCreated(c as Comment)}
              inline
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="comment-shell" aria-label="\u8bc4\u8bba\u533a">
      {/* Top-level comment form */}
      <CommentForm
        postId={postId}
        loginHref={loginHref}
        onCommentCreated={(c) => handleCommentCreated(c as Comment)}
      />

      <h2 className="comment-panel__title" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        \u8bc4\u8bba
        {!loading && <span className="comment-count">{totalCount}</span>}
      </h2>

      {loading && <div className="comment-empty">\u52a0\u8f7d\u8bc4\u8bba\u4e2d...</div>}

      {error && (
        <div className="glass-card comment-card auth-alert auth-alert--error" style={{ textAlign: "center" }}>
          {error}
        </div>
      )}

      {!loading && !error && topLevelComments.length === 0 && (
        <div className="comment-empty">\u6682\u65e0\u8bc4\u8bba\uff0c\u6765\u53d1\u8868\u7b2c\u4e00\u6761\u5427\u3002</div>
      )}

      {!loading && !error && topLevelComments.length > 0 && (
        <div className="comment-list">
          {topLevelComments.map((comment) => renderComment(comment, false))}
        </div>
      )}
    </section>
  );
}
