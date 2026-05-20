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

const sectionStyle: React.CSSProperties = {
  maxWidth: "760px",
  margin: "2rem 0 0 0",
};

const commentStyle: React.CSSProperties = {
  background: "#111527",
  border: "1px solid #2a2e45",
  borderRadius: "0.75rem",
  padding: "1rem 1.25rem",
  marginBottom: "0.75rem",
};

const metaStyle: React.CSSProperties = {
  fontSize: "0.85rem",
  color: "#5a6480",
  marginBottom: "0.5rem",
  display: "flex",
  gap: "0.75rem",
  flexWrap: "wrap" as const,
};

const bodyStyle: React.CSSProperties = {
  color: "#c0c8e0",
  lineHeight: 1.7,
  whiteSpace: "pre-wrap" as const,
  wordBreak: "break-word" as const,
  fontSize: "0.95rem",
};

const emptyStyle: React.CSSProperties = {
  color: "#5a6480",
  fontStyle: "italic",
  textAlign: "center" as const,
  padding: "2rem 1rem",
  fontSize: "0.95rem",
};

const headerStyle: React.CSSProperties = {
  fontSize: "1.1rem",
  fontWeight: 600,
  color: "#e8edf8",
  marginBottom: "1rem",
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
};

const countBadgeStyle: React.CSSProperties = {
  background: "#2a2e45",
  borderRadius: "0.75rem",
  padding: "0.15rem 0.6rem",
  fontSize: "0.8rem",
  color: "#a0a8c0",
  fontWeight: 400,
};

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
    <section style={sectionStyle} aria-label="评论区">
      <h2 style={headerStyle}>
        💬 评论
        {!loading && <span style={countBadgeStyle}>{comments.length}</span>}
      </h2>

      {loading && (
        <div style={{ ...emptyStyle, color: "#a0a8c0" }}>
          加载评论中...
        </div>
      )}

      {error && (
        <div
          style={{
            ...commentStyle,
            borderColor: "#ef4444",
            color: "#fca5a5",
            textAlign: "center",
          }}
        >
          ❌ {error}
        </div>
      )}

      {!loading && !error && comments.length === 0 && (
        <div style={emptyStyle}>
          暂无评论，来发表第一条吧 💭
        </div>
      )}

      {!loading && !error && comments.length > 0 && (
        <div>
          {comments.map((comment) => (
            <article key={comment.id} style={commentStyle}>
              <div style={metaStyle}>
                <span>
                  👤 {comment.profiles?.display_name || comment.profiles?.username || "匿名用户"}
                </span>
                <span>📅 {formatDate(comment.created_at)}</span>
                {comment.updated_at &&
                  comment.updated_at !== comment.created_at && (
                    <span>✏️ 已编辑</span>
                  )}
              </div>
              <div style={bodyStyle}>{comment.body}</div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}