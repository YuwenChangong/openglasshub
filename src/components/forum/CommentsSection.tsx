import { useEffect, useState } from "react";

interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  status: string;
  created_at: string;
  updated_at: string;
  profiles?: {
    username?: string;
    display_name?: string;
  } | null;
}

interface CommentsSectionProps {
  postId: string;
  refreshKey?: number;
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

export default function CommentsSection({ postId, refreshKey }: CommentsSectionProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function fetchComments() {
      setLoading(true);
      setError("");

      try {
        const res = await fetch(`/api/forum/comments?post_id=${encodeURIComponent(postId)}`);
        const data = (await res.json().catch(() => null)) as
          | { comments?: Comment[]; error?: string }
          | null;

        if (cancelled) return;

        if (!res.ok) {
          throw new Error(data?.error ?? `请求失败 (${res.status})`);
        }

        setComments(data?.comments ?? []);
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "加载评论失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchComments();

    return () => {
      cancelled = true;
    };
  }, [postId, refreshKey]);

  return (
    <section className="comment-shell" aria-label="评论区">
      <h2 className="comment-panel__title" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        评论
        {!loading && <span className="comment-count">{comments.length}</span>}
      </h2>

      {loading && (
        <div className="comment-empty">
          加载评论中...
        </div>
      )}

      {error && (
        <div className="glass-card comment-card auth-alert auth-alert--error" style={{ textAlign: "center" }}>
          {error}
        </div>
      )}

      {!loading && !error && comments.length === 0 && (
        <div className="comment-empty">
          暂无评论，来发表第一条吧。
        </div>
      )}

      {!loading && !error && comments.length > 0 && (
        <div className="comment-list">
          {comments.map((comment) => (
            <article key={comment.id} className="glass-card comment-card">
              <div className="comment-card__meta">
                <span>
                  {comment.profiles?.display_name || comment.profiles?.username || "社区成员"}
                </span>
                <span>{formatDate(comment.created_at)}</span>
                {comment.updated_at &&
                  comment.updated_at !== comment.created_at && (
                    <span>已编辑</span>
                  )}
              </div>
              <div className="comment-card__body">{comment.body}</div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
