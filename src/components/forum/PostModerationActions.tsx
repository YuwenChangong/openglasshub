import { useEffect, useMemo, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import GlassConfirmDialog from "../common/GlassConfirmDialog";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import ReportTrigger from "../reports/ReportTrigger";
import { resolveLocale, type LocaleContext } from "../../lib/i18n/locale";
import { getUiMessages } from "../../lib/i18n/catalog";
import { useLocale } from "../i18n/useLocale";

interface PostModerationActionsProps {
  localeContext?: LocaleContext;
  postId: string;
  authorId: string;
  showManagementActions?: boolean;
}

interface SessionState {
  accessToken: string;
  userId: string;
}

type ModalMode = "delete" | "hide" | null;

function mapModerationError(message: string, fallback: string, text: ReturnType<typeof getUiMessages>["community"]): string {
  if (message.includes("Cannot delete a post you do not own") || message.includes("FORBIDDEN")) {
    return text.forbidden;
  }
  if (message.includes("forum_notifications only allow read_at updates")) {
    return text.operationFailed;
  }
  return fallback;
}

export default function PostModerationActions({
  postId,
  authorId,
  showManagementActions = true,
  localeContext = resolveLocale({ acceptLanguage: "zh-CN" }),
}: PostModerationActionsProps) {
  const { context, messages } = useLocale(localeContext);
  const text = messages.community;
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
      setError(text.loginDeletePost);
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
        throw new Error(mapModerationError(payload?.error ?? "", `${text.deleteFailed} (${response.status})`, text));
      }
      window.location.assign("/feed/");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : text.deleteFailed);
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
        throw new Error(mapModerationError(payload?.error ?? "", `${text.hideFailed} (${response.status})`, text));
      }
      window.location.assign("/feed/");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : text.hideFailed);
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
          localeContext={context}
          title={text.deletePost}
          description={text.deletePostDetail}
          detail={text.irreversible}
          confirmLabel={text.confirmDelete}
          cancelLabel={text.cancel}
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
            <h3 id="moderation-modal-title">{text.hidePost}</h3>
            <p>{text.hidePostDetail}</p>
          </div>
          <div className="glass-modal__body">
            <p>{text.hideConfirmQuestion}</p>
            {error ? <span className="inline-error">{error}</span> : null}
          </div>
          <div className="glass-modal__actions">
            <button
              type="button"
              className="community-button--secondary"
              onClick={closeModal}
              disabled={loading}
            >
              {text.cancel}
            </button>
            <button
              type="button"
              className="community-button"
              onClick={handleHide}
              disabled={loading}
            >
              {loading ? text.processing : text.confirmHide}
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
            {text.report}
          </button>
        </div>
        {renderModal()}
      </>
    );
  }

  return (
    <>
      <div className="post-moderation-actions">
        <ReportTrigger targetType="post" targetId={postId} loginHref={loginHref} localeContext={context} />
        {showDeleteButton ? (
          <button
            type="button"
            className="community-action-button community-action-button--danger community-action-button--compact"
            onClick={openDeleteModal}
            disabled={loading}
          >
            {text.deletePost}
          </button>
        ) : null}
        {showManagementActions && canModerate ? (
          <button
            type="button"
            className="community-action-button"
            onClick={openHideModal}
            disabled={loading}
          >
            {text.hidePost}
          </button>
        ) : null}
        {message ? <span className="inline-success">{message}</span> : null}
        {error && modalMode === null ? <span className="inline-error">{error}</span> : null}
      </div>
      {renderModal()}
    </>
  );
}
