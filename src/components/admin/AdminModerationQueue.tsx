import { useEffect, useState } from "react";
import { AdminApiError, adminFetch } from "../../lib/admin-api-client";
import { useAdminSession } from "./useAdminSession";

type ModerationItem = {
  id: string;
  target_type: "post" | "comment";
  title: string | null;
  excerpt: string;
  body: string;
  status: string;
  moderation_status: string;
  moderation_reason: string | null;
  moderation_score: number;
  moderation_provider: string;
  created_at: string;
  updated_at: string;
  author_id: string;
  author_profile: {
    display_name?: string | null;
    username?: string | null;
    role?: string | null;
  } | null;
  post?: { id: string; title: string | null; status: string | null } | null;
  circle?: { id?: string; name?: string | null; slug?: string | null } | null;
};

type QueuePayload = { items?: ModerationItem[] };

function authorLabel(item: ModerationItem) {
  return item.author_profile?.display_name || item.author_profile?.username || "未知用户";
}

function statusLabel(status: string) {
  switch (status) {
    case "pending_review":
      return "待审核";
    case "rejected":
      return "已拒绝";
    case "hidden_by_admin":
      return "已隐藏";
    default:
      return status || "未知";
  }
}

function statusClass(status: string) {
  if (status === "pending_review") return "admin-status-badge admin-status-pending";
  if (status === "rejected") return "admin-status-badge admin-status-hidden";
  if (status === "hidden_by_admin") return "admin-status-badge admin-status-hidden";
  return "admin-status-badge";
}

export default function AdminModerationQueue() {
  const adminSession = useAdminSession();
  const [items, setItems] = useState<ModerationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);
  const [success, setSuccess] = useState<Record<string, string>>({});
  const actionEndpoints = {
    approve: "/api/admin/moderation/approve",
    reject: "/api/admin/moderation/reject",
    hide: "/api/admin/moderation/hide",
  } as const;

  useEffect(() => {
    if (adminSession.state.status !== "ready" || !adminSession.session) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const payload = await adminFetch<QueuePayload>("/api/admin/moderation/queue?include_reviewed=1&limit=120", {
          method: "GET",
          session: adminSession.session,
        });
        if (!cancelled) setItems(payload.items ?? []);
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "加载审核队列失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [adminSession.session, adminSession.state.status]);

  async function mutate(item: ModerationItem, action: "approve" | "reject" | "hide") {
    if (!adminSession.session) return;
    setActionId(item.id);
    setError("");
    try {
      await adminFetch(actionEndpoints[action], {
        method: "POST",
        session: adminSession.session,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_type: item.target_type,
          target_id: item.id,
          reason: action === "approve" ? "Approved by moderator" : undefined,
        }),
      });
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                status: action === "approve" ? "published" : "hidden",
                moderation_status:
                  action === "approve"
                    ? "published"
                    : action === "reject"
                      ? "rejected"
                      : "hidden_by_admin",
              }
            : entry,
        ),
      );
      setSuccess((current) => ({ ...current, [item.id]: action === "approve" ? "已通过" : action === "reject" ? "已拒绝" : "已隐藏" }));
    } catch (requestError) {
      if (requestError instanceof AdminApiError && requestError.status === 403) {
        setError("当前账号没有管理员权限");
      } else {
        setError(requestError instanceof Error ? requestError.message : "操作失败");
      }
    } finally {
      setActionId(null);
    }
  }

  if (adminSession.state.status !== "ready") {
    return <div className="community-empty admin-state-message"><strong>{adminSession.state.message}</strong></div>;
  }

  return (
    <section className="community-surface">
      <div className="community-stream-head">
        <div>
          <h2>审核队列</h2>
          <p>处理待审核帖子与评论，并查看最近被拒绝或隐藏的内容。</p>
        </div>
      </div>

      {error ? <div className="admin-error">{error}</div> : null}
      {loading ? <p className="community-meta admin-state-message">正在加载审核队列...</p> : null}

      {!loading && items.length === 0 ? (
        <div className="community-empty">
          <strong>当前没有待处理内容</strong>
          <p>审核队列为空。</p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="community-list" style={{ marginTop: "0.8rem" }}>
          {items.map((item) => (
            <article key={`${item.target_type}-${item.id}`} className="community-list-item" style={{ gap: "0.65rem" }}>
              {(() => {
                const actionable = item.moderation_status === "pending_review";
                return (
                  <>
              <div className="admin-action-row">
                <strong>{item.title || (item.target_type === "comment" ? "评论" : "帖子")}</strong>
                <span className={statusClass(item.moderation_status)}>{statusLabel(item.moderation_status)}</span>
              </div>
              <div className="community-meta">
                {item.target_type === "post" ? "帖子" : "评论"} · 作者 {authorLabel(item)} · 评分 {item.moderation_score.toFixed(2)} · 来源 {item.moderation_provider}
              </div>
              {item.circle?.name ? <div className="community-meta">圈子：{item.circle.name}</div> : null}
              {item.post?.title && item.target_type === "comment" ? <div className="community-meta">所属帖子：{item.post.title}</div> : null}
              <div>{item.excerpt || "无摘要"}</div>
              {item.moderation_reason ? <div className="community-meta">原因：{item.moderation_reason}</div> : null}
              {success[item.id] ? <div className="admin-success">{success[item.id]}</div> : null}
              <div className="admin-action-row">
                <button
                  type="button"
                  className="community-button"
                  disabled={!actionable || actionId === item.id}
                  onClick={() => void mutate(item, "approve")}
                >
                  通过
                </button>
                <button
                  type="button"
                  className="community-action-button community-action-button--danger"
                  disabled={!actionable || actionId === item.id}
                  onClick={() => void mutate(item, "reject")}
                >
                  拒绝
                </button>
                <button
                  type="button"
                  className="community-action-button"
                  disabled={!actionable || actionId === item.id}
                  onClick={() => void mutate(item, "hide")}
                >
                  隐藏
                </button>
              </div>
                  </>
                );
              })()}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
