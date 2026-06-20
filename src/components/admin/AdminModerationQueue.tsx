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

function providerLabel(provider: string | null | undefined) {
  switch (provider) {
    case "layered":
      return "layered";
    case "local+openai":
      return "local+openai";
    case "openai":
      return "openai";
    case "local":
      return "local";
    case "manual-admin":
      return "manual";
    default:
      return provider || "unknown";
  }
}

function reasonLabel(reason: string | null | undefined) {
  if (!reason) return "";
  if (reason === "off_platform_contact") return "Off-platform contact";
  if (reason === "spam_or_promotion") return "Spam or promotion";
  if (reason === "scam_or_resource_lure") return "Resource lure or scam";
  if (reason === "suspicious_external_link") return "Suspicious external link";
  if (reason === "fake_download_or_private_access") return "Fake download or private access";
  if (reason === "sexual_content") return "Sexual content";
  if (reason === "violence_or_threat") return "Violence or threat";
  if (reason === "hate_or_harassment") return "Hate or harassment";
  if (reason === "illegal_goods_or_services") return "Illegal goods or services";
  if (reason === "personal_data_or_doxxing") return "Possible personal data";
  if (reason === "political_sensitive") return "Political sensitive content";
  if (reason === "vulgar_abuse") return "Vulgar abuse";
  if (reason === "low_quality_spam") return "Low-quality spam";
  if (reason === "platform_policy_custom") return "Platform policy review";
  if (reason === "openai_flagged_text") return "OpenAI flagged text";
  if (reason === "openai_flagged_image") return "OpenAI flagged image";
  if (reason === "openai_threshold_review") return "OpenAI review threshold";
  if (reason === "openai_response_parse_error") return "OpenAI invalid response";
  if (reason === "openai_provider_error_missing_key") return "OpenAI provider unavailable";
  if (reason === "openai_provider_error_http") return "OpenAI provider error";
  if (reason === "openai_provider_error_timeout") return "OpenAI provider timeout";
  if (reason === "openai_provider_error_review") return "OpenAI provider review fallback";
  if (reason === "openai_provider_error_reject") return "OpenAI provider reject fallback";
  if (reason.startsWith("openai_provider_error_")) return "OpenAI provider error";
  if (reason === "openai_video_thumbnail_missing_review") return "Video thumbnail required for review";
  if (reason === "forum_policy_clean") return "Forum policy allow";
  if (reason === "forum_policy_off_platform_contact") return "Forum policy: off-platform contact";
  if (reason === "forum_policy_spam_or_promotion") return "Forum policy: spam or promotion";
  if (reason === "forum_policy_scam_or_resource_lure") return "Forum policy: resource lure or scam";
  if (reason === "forum_policy_suspicious_external_link") return "Forum policy: suspicious external link";
  if (reason === "forum_policy_fake_download_or_private_access") return "Forum policy: fake download or private access";
  if (reason === "forum_policy_sexual_content") return "Forum policy: sexual content";
  if (reason === "forum_policy_violence_or_threat") return "Forum policy: violence or threat";
  if (reason === "forum_policy_hate_or_harassment") return "Forum policy: hate or harassment";
  if (reason === "forum_policy_illegal_goods_or_services") return "Forum policy: illegal goods or services";
  if (reason === "forum_policy_personal_data_or_doxxing") return "Forum policy: personal data";
  if (reason === "forum_policy_political_sensitive") return "Forum policy: political sensitive content";
  if (reason === "forum_policy_vulgar_abuse") return "Forum policy: vulgar abuse";
  if (reason === "forum_policy_low_quality_spam") return "Forum policy: low-quality spam";
  if (reason === "forum_policy_platform_policy_custom") return "Forum policy: custom rule";
  if (reason === "forum_policy_invalid_json") return "Forum policy invalid response";
  if (reason === "forum_policy_timeout") return "Forum policy timeout";
  if (reason === "forum_policy_error") return "Forum policy provider error";
  if (reason === "forum_policy_missing_model") return "Forum policy model missing";
  if (reason === "sensitive_review") return "Local rule review";
  if (reason === "excessive_links") return "Excessive links";
  if (reason === "repeated_content") return "Repeated content";
  if (reason === "gibberish") return "Low-signal content";
  return reason;
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
                {item.target_type === "post" ? "帖子" : "评论"} · 作者 {authorLabel(item)} · 评分 {item.moderation_score.toFixed(2)} · Provider {providerLabel(item.moderation_provider)}
              </div>
              {item.circle?.name ? <div className="community-meta">圈子：{item.circle.name}</div> : null}
              {item.post?.title && item.target_type === "comment" ? <div className="community-meta">所属帖子：{item.post.title}</div> : null}
              <div>{item.excerpt || "无摘要"}</div>
              {item.moderation_reason ? <div className="community-meta">原因：{reasonLabel(item.moderation_reason)}</div> : null}
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
