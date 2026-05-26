import { useEffect, useMemo, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

interface PostModerationActionsProps {
  postId: string;
  authorId: string;
  showManagementActions?: boolean;
}

interface SessionState {
  accessToken: string;
  userId: string;
}

type ModalMode = "report" | "delete" | "hide" | null;

const REPORT_CATEGORIES = [
  "垃圾广告",
  "骚扰/攻击",
  "虚假或误导信息",
  "不相关内容",
  "侵权或违规内容",
  "其他",
] as const;

export default function PostModerationActions({
  postId,
  authorId,
  showManagementActions = true,
}: PostModerationActionsProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [session, setSession] = useState<SessionState | null>(null);
  const [canModerate, setCanModerate] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [reportCategory, setReportCategory] = useState<string>(REPORT_CATEGORIES[0]);
  const [reportDescription, setReportDescription] = useState("");
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [isAuthor, setIsAuthor] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    const syncSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      const token = data.session?.access_token;
      const userId = data.session?.user?.id;
      if (!token || !userId) {
        setSession(null);
        setCanModerate(false);
        setIsAuthor(false);
        setSessionResolved(true);
        return;
      }

      setSession({ accessToken: token, userId });

      // Canonical ownership check from server to avoid client-side id mismatch.
      const ownershipResponse = await fetch(`/api/forum/posts?ownership_check=${encodeURIComponent(postId)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const ownershipPayload = (await ownershipResponse.json().catch(() => null)) as
        | { is_author?: boolean }
        | null;
      if (mounted) {
        setIsAuthor(Boolean(ownershipPayload?.is_author) || userId === authorId);
      }

      const moderationResponse = await fetch("/api/forum/posts?moderation_check=1", {
        headers: { authorization: `Bearer ${token}` },
      });
      const moderationPayload = (await moderationResponse.json().catch(() => null)) as
        | { can_moderate?: boolean }
        | null;
      if (!mounted) return;
      setCanModerate(Boolean(moderationPayload?.can_moderate));
      setSessionResolved(true);
    };

    syncSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      void syncSession();
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [supabase]);

  const loginHref = buildLoginHref(`/posts/${postId}/`);

  function closeModal() {
    if (loading) return;
    setModalMode(null);
    setError("");
    setReportDescription("");
    setReportCategory(REPORT_CATEGORIES[0]);
  }

  function openReportModal() {
    setMessage("");
    setError("");
    if (!sessionResolved) {
      return;
    }
    setModalMode("report");
  }

  function openDeleteModal() {
    setMessage("");
    setError("");
    setModalMode("delete");
  }

  function openHideModal() {
    setMessage("");
    setError("");
    setModalMode("hide");
  }

  async function handleDelete() {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/forum/posts?id=${encodeURIComponent(postId)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? `删除失败 (${response.status})`);
      }
      window.location.assign("/feed/");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除失败。");
    } finally {
      setLoading(false);
    }
  }

  async function handleHide() {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/forum/posts", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ id: postId, status: "hidden" }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? `隐藏失败 (${response.status})`);
      }
      window.location.assign("/feed/");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "隐藏失败。");
    } finally {
      setLoading(false);
    }
  }

  async function handleReportSubmit() {
    if (!session) {
      setError("请先登录后再举报。");
      return;
    }
    if (reportSubmitted) {
      return;
    }

    const trimmedDescription = reportDescription.trim();
    if (trimmedDescription && (trimmedDescription.length < 5 || trimmedDescription.length > 500)) {
      setError("补充说明需要在 5 到 500 字之间。");
      return;
    }

    const reason = trimmedDescription
      ? `${reportCategory}：${trimmedDescription}`
      : `${reportCategory}：未补充说明`;

    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/forum/reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ post_id: postId, reason }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? `举报失败 (${response.status})`);
      }
      setReportSubmitted(true);
      setMessage("已举报");
      setModalMode(null);
      setReportDescription("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "举报失败。");
    } finally {
      setLoading(false);
    }
  }

  function renderModal() {
    if (modalMode === null) return null;

    const title =
      modalMode === "report" ? "举报内容" : modalMode === "delete" ? "删除帖子" : "隐藏帖子";
    const description =
      modalMode === "report"
        ? session
          ? "选择原因并补充说明，提交后管理员会查看。"
          : "先登录账号，再提交举报内容。"
        : modalMode === "delete"
          ? "删除后该帖子将从公开区移除，并跳回动态页。"
          : "隐藏后该帖子将从公开区移除，并跳回动态页。";

    return (
      <div className="glass-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="moderation-modal-title">
        <div className="glass-modal">
          <div className="glass-modal__header">
            <h3 id="moderation-modal-title">{title}</h3>
            <p>{description}</p>
          </div>
          <div className="glass-modal__body">
            {modalMode === "report" ? (
              session ? (
                <>
                <div className="glass-choice-grid">
                  {REPORT_CATEGORIES.map((category) => (
                    <button
                      key={category}
                      type="button"
                      className={`glass-choice${reportCategory === category ? " is-selected" : ""}`}
                      onClick={() => setReportCategory(category)}
                      disabled={loading}
                    >
                      {category}
                    </button>
                  ))}
                </div>
                <label>
                  <span className="community-meta" style={{ display: "inline-block", marginBottom: "0.45rem" }}>
                    补充说明
                  </span>
                  <textarea
                    className="glass-textarea"
                    placeholder="请补充说明，帮助管理员判断"
                    value={reportDescription}
                    onChange={(event) => setReportDescription(event.target.value)}
                    maxLength={500}
                    disabled={loading}
                  />
                </label>
                <span className="community-meta">可只提交原因分类；如填写说明，需在 5 到 500 字之间。</span>
                </>
              ) : (
                <div className="report-login-cta">
                  <p>当前需要登录后才能提交举报。登录后会返回当前帖子。</p>
                  <a href={loginHref} className="community-button">
                    去登录
                  </a>
                </div>
              )
            ) : (
              <p>{modalMode === "delete" ? "确认执行删除操作？" : "确认执行隐藏操作？"}</p>
            )}
            {error ? <span className="inline-error">{error}</span> : null}
          </div>
          <div className="glass-modal__actions">
            <button
              type="button"
              className="community-button--secondary"
              onClick={closeModal}
              disabled={loading}
            >
              取消
            </button>
            {modalMode !== "report" || session ? (
              <button
                type="button"
                className="community-button"
                onClick={
                  modalMode === "report"
                    ? handleReportSubmit
                    : modalMode === "delete"
                      ? handleDelete
                      : handleHide
                }
                disabled={loading || (modalMode === "report" && reportSubmitted)}
              >
                {loading
                  ? "提交中..."
                  : modalMode === "report"
                    ? "提交举报"
                    : modalMode === "delete"
                      ? "确认删除"
                      : "确认隐藏"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (!sessionResolved) {
    return (
      <>
        <div className="post-moderation-actions">
          <button type="button" className="community-action-button" disabled>
            举报
          </button>
        </div>
        {renderModal()}
      </>
    );
  }

  return (
    <>
      <div className="post-moderation-actions">
        <button
          type="button"
          className="community-action-button"
          onClick={openReportModal}
          disabled={loading || reportSubmitted}
        >
          {reportSubmitted ? "已举报" : "举报"}
        </button>
        {showManagementActions && isAuthor ? (
          <button
            type="button"
            className="community-action-button community-action-button--danger"
            onClick={openDeleteModal}
            disabled={loading}
          >
            删除帖子
          </button>
        ) : null}
        {showManagementActions && canModerate ? (
          <button
            type="button"
            className="community-action-button"
            onClick={openHideModal}
            disabled={loading}
          >
            隐藏帖子
          </button>
        ) : null}
        {message ? <span className="inline-success">{message}</span> : null}
        {error && modalMode === null ? <span className="inline-error">{error}</span> : null}
      </div>
      {renderModal()}
    </>
  );
}
