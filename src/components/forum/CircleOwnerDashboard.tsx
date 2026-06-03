import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import GlassConfirmDialog from "../common/GlassConfirmDialog";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";
import CircleCoverEditor from "./CircleCoverEditor";

type ManagedCircle = {
  id: string;
  slug: string;
  name: string;
  description: string;
  type: string;
  created_at: string;
  updated_at?: string | null;
  image_path: string | null;
  owner_id: string | null;
  post_count: number;
  comment_count: number;
};

type ManagedPost = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  author: { label: string | null } | null;
  media_count: number;
  report_count: number;
};

type ManagedComment = {
  id: string;
  body: string;
  status: string;
  created_at: string;
  post_title: string;
  author: { display_name?: string | null; username?: string | null } | null;
};

type ManagePayload = {
  can_manage?: boolean;
  role?: string | null;
  is_owner?: boolean;
  circle?: ManagedCircle;
  error?: string;
};

function formatActorLabel(author?: { display_name?: string | null; username?: string | null; label?: string | null } | null) {
  return author?.display_name || author?.username || author?.label || "未知用户";
}

async function sessionFetch<T>(path: string, session: Session, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options?.headers ?? {}),
      authorization: `Bearer ${session.access_token}`,
    },
  });

  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? `请求失败 (${response.status})`);
  }
  return (payload ?? {}) as T;
}

export default function CircleOwnerDashboard({ circleSlug }: { circleSlug: string }) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const authState = useBrowserAuthState(supabase);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissionError, setPermissionError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [circle, setCircle] = useState<ManagedCircle | null>(null);
  const [posts, setPosts] = useState<ManagedPost[]>([]);
  const [comments, setComments] = useState<ManagedComment[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [savingCircle, setSavingCircle] = useState(false);
  const [rowLoadingId, setRowLoadingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: "post" | "comment"; id: string; title: string } | null>(null);

  async function loadAll(activeSession: Session) {
    setLoading(true);
    setError("");
    setPermissionError("");

    try {
      const [managePayload, postsPayload, commentsPayload] = await Promise.all([
        sessionFetch<ManagePayload>(`/api/forum/circles/${circleSlug}/manage`, activeSession, { method: "GET" }),
        sessionFetch<{ posts: ManagedPost[] }>(`/api/forum/circles/${circleSlug}/posts`, activeSession, { method: "GET" }),
        sessionFetch<{ comments: ManagedComment[] }>(`/api/forum/circles/${circleSlug}/comments`, activeSession, { method: "GET" }),
      ]);

      if (!managePayload.circle) {
        throw new Error("圈子管理数据为空");
      }

      setCircle(managePayload.circle);
      setDraftName(managePayload.circle.name);
      setDraftDescription(managePayload.circle.description ?? "");
      setPosts(postsPayload.posts ?? []);
      setComments(commentsPayload.comments ?? []);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "加载圈子管理数据失败";
      if (message.includes("权限") || message.includes("403")) {
        setPermissionError("你没有权限管理这个圈子。");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authState.status !== "signed_in") {
      setSession(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const nextSession = data.session ?? null;
      setSession(nextSession);
      if (nextSession) {
        void loadAll(nextSession);
      } else {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [authState.status, circleSlug, supabase]);

  async function refreshLists(activeSession: Session) {
    const [managePayload, postsPayload, commentsPayload] = await Promise.all([
      sessionFetch<ManagePayload>(`/api/forum/circles/${circleSlug}/manage`, activeSession, { method: "GET" }),
      sessionFetch<{ posts: ManagedPost[] }>(`/api/forum/circles/${circleSlug}/posts`, activeSession, { method: "GET" }),
      sessionFetch<{ comments: ManagedComment[] }>(`/api/forum/circles/${circleSlug}/comments`, activeSession, { method: "GET" }),
    ]);
    if (managePayload.circle) {
      setCircle(managePayload.circle);
    }
    setPosts(postsPayload.posts ?? []);
    setComments(commentsPayload.comments ?? []);
  }

  async function saveCircle() {
    if (!session || !circle) return;
    setSavingCircle(true);
    setError("");
    setSuccess("");

    try {
      const payload = await sessionFetch<{ circle: ManagedCircle }>(`/api/forum/circles/${circleSlug}/manage`, session, {
        method: "PATCH",
        body: JSON.stringify({
          name: draftName.trim(),
          description: draftDescription.trim(),
        }),
      });
      setCircle(payload.circle);
      setDraftName(payload.circle.name);
      setDraftDescription(payload.circle.description ?? "");
      setSuccess("圈子信息已更新。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "更新圈子失败");
    } finally {
      setSavingCircle(false);
    }
  }

  async function updatePostStatus(postId: string, status: "published" | "hidden" | "deleted") {
    if (!session) return;
    setRowLoadingId(postId);
    setError("");
    setSuccess("");

    try {
      await sessionFetch(`/api/forum/circles/${circleSlug}/posts`, session, {
        method: "PATCH",
        body: JSON.stringify({ id: postId, status }),
      });
      await refreshLists(session);
      setSuccess(status === "hidden" ? "帖子已隐藏。" : status === "published" ? "帖子已恢复公开。" : "帖子已删除。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "更新帖子状态失败");
    } finally {
      setRowLoadingId(null);
    }
  }

  async function confirmDeleteAction() {
    if (!session || !confirmDelete) return;
    setRowLoadingId(confirmDelete.id);
    setError("");

    try {
      if (confirmDelete.type === "post") {
        await sessionFetch(`/api/forum/circles/${circleSlug}/posts?id=${confirmDelete.id}`, session, {
          method: "DELETE",
        });
      } else {
        await sessionFetch(`/api/forum/circles/${circleSlug}/comments?id=${confirmDelete.id}`, session, {
          method: "DELETE",
        });
      }
      await refreshLists(session);
      setSuccess(confirmDelete.type === "post" ? "帖子已删除。" : "评论已删除。");
      setConfirmDelete(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除失败");
    } finally {
      setRowLoadingId(null);
    }
  }

  async function updateCommentStatus(commentId: string, status: "published" | "deleted") {
    if (!session) return;
    setRowLoadingId(commentId);
    setError("");

    try {
      await sessionFetch(`/api/forum/circles/${circleSlug}/comments`, session, {
        method: "PATCH",
        body: JSON.stringify({ id: commentId, status }),
      });
      await refreshLists(session);
      setSuccess(status === "published" ? "评论已恢复。" : "评论已删除。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "更新评论状态失败");
    } finally {
      setRowLoadingId(null);
    }
  }

  if (authState.status === "checking") {
    return <section className="community-surface community-surface--padded circle-manage-shell"><p>正在检查登录状态...</p></section>;
  }

  if (authState.status === "signed_in" && !session) {
    return <section className="community-surface community-surface--padded circle-manage-shell"><p>正在加载圈子管理数据...</p></section>;
  }

  if (authState.status !== "signed_in" || !session) {
    return (
      <section className="community-surface community-surface--padded circle-manage-shell circle-manage-gate">
        <h2>管理圈子</h2>
        <p>登录后才能管理自己创建的圈子。</p>
        <div className="community-cta-row">
          <a href={buildLoginHref(`/circles/${circleSlug}/manage/`)} className="community-action-button community-action-button--primary">
            去登录
          </a>
          <a href={`/circles/${circleSlug}/`} className="community-action-button community-action-button--muted">
            返回圈子详情
          </a>
        </div>
      </section>
    );
  }

  if (loading) {
    return <section className="community-surface community-surface--padded circle-manage-shell"><p>正在加载圈子管理数据...</p></section>;
  }

  if (permissionError) {
    return (
      <section className="community-surface community-surface--padded circle-manage-shell circle-manage-gate">
        <h2>无权限</h2>
        <p>{permissionError}</p>
        <a href={`/circles/${circleSlug}/`} className="community-action-button community-action-button--muted">
          返回圈子详情
        </a>
      </section>
    );
  }

  if (!circle) {
    return <section className="community-surface community-surface--padded circle-manage-shell"><p>圈子不存在或暂时不可管理。</p></section>;
  }

  return (
    <>
      <section className="community-surface community-surface--padded circle-manage-shell">
        <div className="community-stream-head">
          <div>
            <h2>管理圈子</h2>
            <p>编辑圈子信息，并管理该圈子下的帖子与评论。</p>
          </div>
          <div className="community-inline-links">
            <a href={`/circles/${circle.slug}/`} className="community-action-button community-action-button--muted">返回圈子详情</a>
          </div>
        </div>

        {error ? <div className="admin-error">{error}</div> : null}
        {success ? <div className="admin-inline-success">{success}</div> : null}

        <div className="circle-manage-grid">
          <article className="community-list-item circle-manage-panel">
            <strong>圈子信息</strong>
            <div className="admin-meta-grid">
              <span>slug：<code>{circle.slug}</code></span>
              <span>帖子：{circle.post_count}</span>
              <span>评论：{circle.comment_count}</span>
              <span>创建时间：{new Date(circle.created_at).toLocaleString("zh-CN")}</span>
            </div>
            <label>
              <span className="community-meta">圈子名称</span>
              <input className="community-input" value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={40} />
            </label>
            <label>
              <span className="community-meta">圈子介绍</span>
              <textarea
                className="community-input community-input--textarea"
                value={draftDescription}
                onChange={(event) => setDraftDescription(event.target.value)}
                maxLength={200}
              />
            </label>
            <CircleCoverEditor
              circleId={circle.id}
              circleSlug={circle.slug}
              supportsExtendedSchema={true}
              ownerId={circle.owner_id}
              onUpdated={(imagePath) => setCircle((current) => (current ? { ...current, image_path: imagePath } : current))}
            />
            <div className="community-cta-row">
              <button type="button" className="community-button" disabled={savingCircle} onClick={() => void saveCircle()}>
                {savingCircle ? "保存中..." : "保存圈子信息"}
              </button>
            </div>
          </article>

          <article className="community-list-item circle-manage-panel">
            <strong>圈子帖子</strong>
            <div className="circle-manage-list">
              {posts.length === 0 ? <p className="community-meta">当前圈子还没有帖子。</p> : posts.map((post) => (
                <div key={post.id} className="circle-manage-item">
                  <div className="admin-action-row">
                    <strong>{post.title}</strong>
                    <span className={`admin-status-badge admin-status-${post.status}`}>{post.status}</span>
                  </div>
                  <div className="admin-meta-grid">
                    <span>作者：{formatActorLabel(post.author)}</span>
                    <span>媒体：{post.media_count}</span>
                    <span>举报：{post.report_count}</span>
                    <span>创建时间：{new Date(post.created_at).toLocaleString("zh-CN")}</span>
                  </div>
                  <div className="admin-inline-actions">
                    {post.status !== "hidden" ? (
                      <button type="button" className="admin-action-button" disabled={rowLoadingId === post.id} onClick={() => void updatePostStatus(post.id, "hidden")}>
                        隐藏帖子
                      </button>
                    ) : (
                      <button type="button" className="admin-action-button" disabled={rowLoadingId === post.id} onClick={() => void updatePostStatus(post.id, "published")}>
                        恢复公开
                      </button>
                    )}
                    {post.status === "deleted" ? (
                      <button type="button" className="admin-action-button" disabled={rowLoadingId === post.id} onClick={() => void updatePostStatus(post.id, "published")}>
                        恢复帖子
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="admin-action-button admin-action-danger"
                        disabled={rowLoadingId === post.id}
                        onClick={() => setConfirmDelete({ type: "post", id: post.id, title: post.title })}
                      >
                        删除帖子
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="community-list-item circle-manage-panel circle-manage-panel--full">
            <strong>圈子评论</strong>
            <div className="circle-manage-list">
              {comments.length === 0 ? <p className="community-meta">当前圈子还没有评论。</p> : comments.map((comment) => (
                <div key={comment.id} className="circle-manage-item">
                  <div className="admin-action-row">
                    <strong>{comment.status === "deleted" ? "该评论已删除" : comment.body.slice(0, 80)}</strong>
                    <span className={`admin-status-badge admin-status-${comment.status}`}>{comment.status}</span>
                  </div>
                  <div className="admin-meta-grid">
                    <span>作者：{formatActorLabel(comment.author)}</span>
                    <span>帖子：{comment.post_title}</span>
                    <span>创建时间：{new Date(comment.created_at).toLocaleString("zh-CN")}</span>
                  </div>
                  <div className="admin-inline-actions">
                    {comment.status === "deleted" ? (
                      <button type="button" className="admin-action-button" disabled={rowLoadingId === comment.id} onClick={() => void updateCommentStatus(comment.id, "published")}>
                        恢复评论
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="admin-action-button admin-action-danger"
                        disabled={rowLoadingId === comment.id}
                        onClick={() => setConfirmDelete({ type: "comment", id: comment.id, title: comment.post_title })}
                      >
                        删除评论
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <GlassConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete?.type === "post" ? "确认删除帖子" : "确认删除评论"}
        description={confirmDelete?.type === "post" ? "删除后该帖子会在公开页面隐藏。" : "删除后有回复的评论会显示删除占位。"}
        detail={confirmDelete ? `目标：${confirmDelete.title}` : ""}
        confirmLabel={confirmDelete?.type === "post" ? "确认删除帖子" : "确认删除评论"}
        cancelLabel="取消"
        danger={true}
        loading={!!confirmDelete && rowLoadingId === confirmDelete.id}
        error=""
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => void confirmDeleteAction()}
      />
    </>
  );
}
