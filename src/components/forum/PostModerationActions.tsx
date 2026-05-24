import { useEffect, useMemo, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

interface PostModerationActionsProps {
  postId: string;
  authorId: string;
}

interface SessionState {
  accessToken: string;
  userId: string;
}

export default function PostModerationActions({ postId, authorId }: PostModerationActionsProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [session, setSession] = useState<SessionState | null>(null);
  const [canModerate, setCanModerate] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      const token = data.session?.access_token;
      const userId = data.session?.user?.id;
      if (!token || !userId) {
        setSession(null);
        return;
      }

      setSession({ accessToken: token, userId });
      const moderationResponse = await fetch("/api/forum/posts?moderation_check=1", {
        headers: { authorization: `Bearer ${token}` },
      });
      const moderationPayload = (await moderationResponse.json().catch(() => null)) as
        | { can_moderate?: boolean }
        | null;
      if (!mounted) return;
      setCanModerate(Boolean(moderationPayload?.can_moderate));
    });

    return () => {
      mounted = false;
    };
  }, [supabase]);

  const isAuthor = session?.userId === authorId;
  const loginHref = buildLoginHref(`/posts/${postId}/`);

  async function handleDelete() {
    if (!session) return;
    if (!window.confirm("确认删除这篇帖子？删除后公开区将不再显示。")) return;
    setLoading(true);
    setError("");
    setMessage("");
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
    if (!window.confirm("确认隐藏这篇帖子？隐藏后公开区将不再显示。")) return;
    setLoading(true);
    setError("");
    setMessage("");
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

  async function handleReport() {
    if (!session) return;
    const reason = window.prompt("请输入举报原因（5-500字）");
    if (!reason || !reason.trim()) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/forum/reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ post_id: postId, reason: reason.trim() }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? `举报失败 (${response.status})`);
      }
      setMessage("举报已提交，我们会尽快处理。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "举报失败。");
    } finally {
      setLoading(false);
    }
  }

  if (!session) {
    return (
      <div className="post-moderation-actions">
        <a href={loginHref} className="community-button--secondary">登录后可举报</a>
      </div>
    );
  }

  return (
    <div className="post-moderation-actions">
      <button
        type="button"
        className="community-button--secondary"
        onClick={handleReport}
        disabled={loading}
      >
        举报
      </button>
      {isAuthor ? (
        <button
          type="button"
          className="community-button--secondary"
          onClick={handleDelete}
          disabled={loading}
        >
          删除帖子
        </button>
      ) : null}
      {canModerate ? (
        <button
          type="button"
          className="community-button"
          onClick={handleHide}
          disabled={loading}
        >
          隐藏帖子
        </button>
      ) : null}
      {message ? <span className="community-meta">{message}</span> : null}
      {error ? <span className="community-meta" style={{ color: "#fca5a5" }}>{error}</span> : null}
    </div>
  );
}
