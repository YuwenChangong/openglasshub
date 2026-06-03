import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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

const DELETE_CONFIRM_MS = 5000;
const LIKE_ANIMATION_MS = 240;

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
  return author?.display_name || author?.username || "社区成员";
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
  const [likeAnimatingId, setLikeAnimatingId] = useState<string | null>(null);
  const [commentErrors, setCommentErrors] = useState<Record<string, string>>({});
  const deleteConfirmTimerRef = useRef<number | null>(null);
  const likeTimerRef = useRef<number | null>(null);

  const clearCommentError = useCallback((commentId: string) => {
    setCommentErrors((current) => {
      const next = { ...current };
      delete next[commentId];
      return next;
    });
  }, []);

  const clearDeleteConfirm = useCallback(() => {
    if (deleteConfirmTimerRef.current !== null) {
      window.clearTimeout(deleteConfirmTimerRef.current);
      deleteConfirmTimerRef.current = null;
    }
    setConfirmDeleteId(null);
  }, []);

  const triggerLikeAnimation = useCallback((commentId: string) => {
    setLikeAnimatingId(commentId);
    if (likeTimerRef.current !== null) {
      window.clearTimeout(likeTimerRef.current);
    }
    likeTimerRef.current = window.setTimeout(() => {
      setLikeAnimatingId((current) => (current === commentId ? null : current));
      likeTimerRef.current = null;
    }, LIKE_ANIMATION_MS);
  }, []);

  const fetchComments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const headers: Record<string, string> = {};
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) {
          headers.authorization = `Bearer ${data.session.access_token}`;
        }
      }
      const res = await fetch(`/api/forum/comments?post_id=${encodeURIComponent(postId)}`, { headers });
      const data = (await res.json().catch(() => null)) as { comments?: Comment[]; error?: string } | null;
      if (!res.ok) {
        if (data?.error === "COMMENTS_INTERACTIONS_MIGRATION_REQUIRED") {
          throw new Error("MIGRATION_REQUIRED::评论互动数据库迁移尚未执行，请先运行 comments interactions migration。");
        }
        throw new Error(data?.error ?? `请求失败 (${res.status})`);
      }
      setComments(data?.comments ?? []);
    } catch (fetchError) {
      const msg = fetchError instanceof Error ? fetchError.message : "加载评论失败";
      if (msg.startsWith("MIGRATION_REQUIRED::")) {
        setError(msg.slice("MIGRATION_REQUIRED::".length));
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [postId, supabase]);

  useEffect(() => {
    let cancelled = false;
    if (!cancelled) {
      void fetchComments();
    }
    return () => {
      cancelled = true;
    };
  }, [fetchComments, refreshKey]);

  useEffect(() => {
    return () => {
      if (deleteConfirmTimerRef.current !== null) {
        window.clearTimeout(deleteConfirmTimerRef.current);
      }
      if (likeTimerRef.current !== null) {
        window.clearTimeout(likeTimerRef.current);
      }
    };
  }, []);

  const handleCommentCreated = useCallback((newComment: Comment) => {
    setComments((prev) => [...prev, newComment]);
    setReplyingTo(null);
  }, []);

  const handleToggleLike = useCallback(async (commentId: string) => {
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.access_token) return;

    clearCommentError(commentId);

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
      if (!res.ok) throw new Error(payload?.error ?? "操作失败");

      triggerLikeAnimation(commentId);
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, liked_by_me: payload?.liked ?? false, like_count: payload?.like_count ?? c.like_count }
            : c,
        ),
      );
    } catch {
      // Keep the existing lightweight failure behavior for likes.
    }
  }, [clearCommentError, supabase, triggerLikeAnimation]);

  const armDeleteConfirmation = useCallback((commentId: string) => {
    clearDeleteConfirm();
    setConfirmDeleteId(commentId);
    deleteConfirmTimerRef.current = window.setTimeout(() => {
      setConfirmDeleteId((current) => (current === commentId ? null : current));
      deleteConfirmTimerRef.current = null;
    }, DELETE_CONFIRM_MS);
  }, [clearDeleteConfirm]);

  const handleDeleteClick = useCallback(async (commentId: string) => {
    clearCommentError(commentId);

    if (confirmDeleteId !== commentId) {
      armDeleteConfirmation(commentId);
      return;
    }

    if (!supabase) return;
    setDeletingId(commentId);
    clearDeleteConfirm();

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.access_token) throw new Error("请先登录");

      const res = await fetch(`/api/forum/comments?id=${encodeURIComponent(commentId)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionData.session.access_token}` },
      });
      const payload = (await res.json().catch(() => null)) as { deleted?: boolean; has_replies?: boolean; error?: string } | null;
      if (!res.ok) throw new Error(payload?.error ?? "删除失败");

      setReplyingTo((current) => (current === commentId ? null : current));
      if (payload?.has_replies) {
        setComments((prev) =>
          prev.map((c) =>
            c.id === commentId ? { ...c, status: "deleted", body: "", like_count: 0, liked_by_me: false } : c,
          ),
        );
      } else {
        setComments((prev) => prev.filter((c) => c.id !== commentId));
      }
    } catch (deleteError) {
      setCommentErrors((current) => ({
        ...current,
        [commentId]: deleteError instanceof Error ? deleteError.message : "删除失败",
      }));
    } finally {
      setDeletingId(null);
    }
  }, [armDeleteConfirmation, clearCommentError, clearDeleteConfirm, confirmDeleteId, supabase]);

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
    const authorName = isDeleted ? "匿名" : authorDisplayName(comment.author);
    const showReplyForm = replyingTo === comment.id;

    return (
      <div key={comment.id} className={isReply ? "comment-thread comment-thread--reply" : "comment-thread"}>
        <article className={`glass-card comment-card comment-item${isDeleted ? " comment-deleted" : ""}`}>
          <div className="comment-item-main">
            <div className="comment-meta">
              <span className={`comment-author${isStaff(comment.author) ? " comment-author--staff" : ""}`}>
                {authorName}
              </span>
              {isStaff(comment.author) && !isDeleted ? (
                <span className="comment-staff-badge">{comment.author?.role === "admin" ? "管理员" : "版主"}</span>
              ) : null}
              <span className="comment-time">{formatDate(comment.created_at)}</span>
              {comment.updated_at && comment.updated_at !== comment.created_at && !isDeleted ? (
                <span className="comment-time">已编辑</span>
              ) : null}
            </div>

            {isDeleted ? (
              <div className="comment-body comment-deleted">该评论已删除</div>
            ) : (
              <div className="comment-body">{comment.body}</div>
            )}
          </div>

          {!isDeleted ? (
            <>
              <div className="comment-action-row">
                <button
                  type="button"
                  className={`community-action-button community-action-button--social comment-action-button${comment.liked_by_me ? " is-active is-liked" : ""}`}
                  onClick={() => void handleToggleLike(comment.id)}
                  disabled={!supabase}
                  aria-label={comment.liked_by_me ? "取消点赞" : "点赞"}
                >
                  <span className={`community-like-heart${likeAnimatingId === comment.id ? " is-animating" : ""}`} aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <path d="M12 21.35 10.55 20C5.4 15.24 2 12.09 2 8.23 2 5.08 4.42 2.7 7.5 2.7c1.74 0 3.41.82 4.5 2.09 1.09-1.27 2.76-2.09 4.5-2.09 3.08 0 5.5 2.38 5.5 5.53 0 3.86-3.4 7.01-8.55 11.78L12 21.35Z" />
                    </svg>
                  </span>
                  <span>{comment.like_count}</span>
                </button>

                <button
                  type="button"
                  className="community-action-button comment-action-button"
                  onClick={() => {
                    clearCommentError(comment.id);
                    setReplyingTo(showReplyForm ? null : comment.id);
                  }}
                  disabled={!supabase}
                >
                  <span className="comment-action-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <polyline points="9 17 4 12 9 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M20 18v-2a4 4 0 0 0-4-4H4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span>回复</span>
                  <span>{comment.reply_count}</span>
                </button>

                {comment.can_delete ? (
                  <button
                    type="button"
                    className={`community-action-button community-action-button--danger comment-action-button comment-action-button--danger${isConfirming ? " is-confirming" : ""}`}
                    onClick={() => void handleDeleteClick(comment.id)}
                    disabled={isDeleting}
                  >
                    <span className="comment-action-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <polyline points="3 6 5 6 21 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M10 11v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M14 11v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span>{isDeleting ? "删除中..." : isConfirming ? "确认删除" : "删除"}</span>
                  </button>
                ) : null}
              </div>

              {isConfirming ? (
                <div className="comment-delete-confirm glass-card">
                  <span>再次点击“确认删除”即可删除评论，5 秒后自动恢复。</span>
                  <button
                    type="button"
                    className="community-action-button community-action-button--muted comment-action-button"
                    onClick={clearDeleteConfirm}
                    disabled={isDeleting}
                  >
                    取消
                  </button>
                </div>
              ) : null}

              {commentErrors[comment.id] ? <div className="comment-inline-error">{commentErrors[comment.id]}</div> : null}
            </>
          ) : null}
        </article>

        {replies.length > 0 ? (
          <div className="comment-replies">
            {replies.map((reply) => renderComment(reply, true))}
          </div>
        ) : null}

        {showReplyForm ? (
          <div className="comment-reply-form">
            <CommentForm
              postId={postId}
              parentId={comment.id}
              placeholder="回复这条评论..."
              onCommentCreated={(c) => handleCommentCreated(c as Comment)}
              loginHref={loginHref}
              inline
              onCancel={() => setReplyingTo(null)}
            />
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className="comment-shell" aria-label="评论区">
      <CommentForm
        postId={postId}
        loginHref={loginHref}
        onCommentCreated={(c) => handleCommentCreated(c as Comment)}
      />

      <h2 className="comment-panel__title" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        评论
        {!loading ? <span className="comment-count">{totalCount}</span> : null}
      </h2>

      {loading ? <div className="comment-empty">加载评论中...</div> : null}

      {error ? (
        <div className="glass-card comment-card auth-alert auth-alert--error" style={{ textAlign: "center" }}>
          {error}
        </div>
      ) : null}

      {!loading && !error && topLevelComments.length === 0 ? (
        <div className="comment-empty">暂无评论，来发表第一条吧。</div>
      ) : null}

      {!loading && !error && topLevelComments.length > 0 ? (
        <div className="comment-list">
          {topLevelComments.map((comment) => renderComment(comment, false))}
        </div>
      ) : null}
    </section>
  );
}
