import { useEffect, useMemo, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import GlassConfirmDialog from "../common/GlassConfirmDialog";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import ReportTrigger from "../reports/ReportTrigger";

interface PostModerationActionsProps {
  postId: string;
  authorId: string;
  showManagementActions?: boolean;
}

interface SessionState {
  accessToken: string;
  userId: string;
}

type ModalMode = "delete" | "hide" | null;

function mapModerationError(message: string, fallback: string): string {
  if (message.includes("Cannot delete a post you do not own") || message.includes("FORBIDDEN")) {
    return "无权执行该操作。";
  }
  if (message.includes("forum_notifications only allow read_at updates")) {
    return "操作失败，请稍后重试。";
  }
  return fallback;
}

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
  const [isAuthor, setIsAuthor] = useState(false);
  const showDeleteButton = showManagementActions && (isAuthor || canModerate);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    const syncSession = async () => {
      try {
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

        const [ownershipResponse, moderationResponse] = await Promise.all([
          fetch(`/api/forum/posts?ownership_check=${encodeURIComponent(postId)}`, {
            headers: { authorization: `Bearer ${token}` },
          }),
          fetch("/api/forum/posts?moderation_check=1", {
            headers: { authorization: `Bearer ${token}` },
          }),
        ]);

        const ownershipPayload = (await ownershipResponse.json().catch(() => null)) as
          | { is_author?: boolean }
          | null;
        const moderationPayload = (await moderationResponse.json().catch(() => null)) as
          | { can_moderate?: boolean }
          | null;
        if (!mounted) return;

        setIsAuthor(Boolean(ownershipPayload?.is_author) || userId === authorId);
        setCanModerate(Boolean(moderationPayload?.can_moderate));
      } finally {
        if (mounted) {
          setSessionResolved(true);
        }
      }
    };

    void syncSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      void syncSession();
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [authorId, postId, supabase]);

  const loginHref = buildLoginHref(`/posts/${postId}/`);

  function closeModal() {
    if (loading) return;
    setModalMode(null);
    setError("");
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
    if (!session) {
      setError("请先登录后再删除帖子。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/forum/posts?id=${encodeURIComponent(postId)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(mapModerationError(payload?.error ?? "", `删除失败 (${response.status})`));
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
        throw new Error(mapModerationError(payload?.error ?? "", `隐藏失败 (${response.status})`));
      }
      window.location.assign("/feed/");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "隐藏失败。");
    } finally {
      setLoading(false);
    }
  }

  function renderModal() {
    if (modalMode === null) return null;

    if (modalMode === "delete") {
      return (
        <GlassConfirmDialog
          open
          title="删除帖子"
          description="删除后该帖子将从公开区移除，并跳回动态页。"
          detail="该操作不可撤销。"
          confirmLabel="确认删除"
          cancelLabel="取消"
          danger
          loading={loading}
          error={error}
          onConfirm={() => void handleDelete()}
          onCancel={closeModal}
        />
      );
    }

    return (
      <div className="glass-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="moderation-modal-title">
        <div className="glass-modal">
          <div className="glass-modal__header">
            <h3 id="moderation-modal-title">隐藏帖子</h3>
            <p>隐藏后该帖子将从公开区移除，并跳回动态页。</p>
          </div>
          <div className="glass-modal__body">
            <p>确认执行隐藏操作？</p>
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
            <button
              type="button"
              className="community-button"
              onClick={handleHide}
              disabled={loading}
            >
              {loading ? "处理中..." : "确认隐藏"}
            </button>
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
        <ReportTrigger targetType="post" targetId={postId} loginHref={loginHref} />
        {showDeleteButton ? (
          <button
            type="button"
            className="community-action-button community-action-button--danger community-action-button--compact"
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
