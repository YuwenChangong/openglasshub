import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import GlassConfirmDialog from "../common/GlassConfirmDialog";
import { buildLoginHref } from "../../lib/auth-redirect";
import { buildProfileHref } from "../../lib/profile-links";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";
import CircleCoverEditor from "./CircleCoverEditor";

type ManagedCircle = {
  id: string;
  slug: string;
  name: string;
  description: string;
  type: string;
  status: string;
  created_at: string;
  updated_at?: string | null;
  image_path: string | null;
  cover_url?: string | null;
  owner_id: string | null;
  post_count: number;
  comment_count: number;
};

type ManagedPost = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  author: { id?: string | null; label?: string | null; display_name?: string | null; username?: string | null } | null;
  media_count: number;
  report_count: number;
};

type ManagedComment = {
  id: string;
  body: string;
  status: string;
  created_at: string;
  post_title: string;
  author: { id?: string | null; display_name?: string | null; username?: string | null } | null;
};

type ManagePayload = {
  ok?: boolean;
  circle?: ManagedCircle;
  viewer?: {
    id: string;
    role: string | null;
    is_owner: boolean;
    can_manage: boolean;
  };
  error?: string;
};

type ApiErrorPayload = {
  error?: string;
  details?: string;
};

function formatActorLabel(author?: { display_name?: string | null; username?: string | null; label?: string | null } | null) {
  return author?.display_name || author?.username || author?.label || "未知用户";
}

function actorHref(author?: { id?: string | null; username?: string | null } | null) {
  return buildProfileHref({
    id: author?.id ?? null,
    username: author?.username ?? null,
  });
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

  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
  if (!response.ok) {
    const detailSuffix = payload?.details ? `: ${payload.details}` : "";
    throw new Error(`${payload?.error ?? `请求失败 (${response.status})`}${detailSuffix}`);
  }
  return (payload ?? {}) as T;
}

function mapManageError(message: string) {
  if (message.includes("NOT_AUTHENTICATED")) return { kind: "auth", text: "登录后才能管理圈子。" };
  if (message.includes("CIRCLE_NOT_FOUND")) return { kind: "not_found", text: "圈子不存在。" };
  if (message.includes("PROFILE_NOT_FOUND")) return { kind: "profile", text: "当前账号缺少 profile，暂时无法管理圈子。" };
  if (message.includes("CIRCLE_MANAGE_FORBIDDEN")) return { kind: "forbidden", text: "没有权限管理该圈子。" };
  if (message.includes("CIRCLE_STATUS_SCHEMA_NOT_READY") || message.includes("CIRCLE_STATUS_COLUMN_MISSING")) {
    return { kind: "schema", text: "数据库还没有完成圈子状态 migration，请先执行最新 SQL。" };
  }
  if (message.includes("CIRCLE_DELETE_RLS_FAILED")) return { kind: "delete_rls", text: "圈子删除权限未就绪，请检查 circles RLS / policy。" };
  if (message.includes("CIRCLE_DELETE_FAILED")) return { kind: "delete_failed", text: "圈子删除失败，请稍后重试。" };
  if (message.includes("CIRCLE_MANAGE_QUERY_FAILED")) return { kind: "query", text: "圈子管理信息查询失败，请稍后重试。" };
  return { kind: "generic", text: message };
}

export default function CircleOwnerDashboard({ circleSlug }: { circleSlug: string }) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const authState = useBrowserAuthState(supabase);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissionError, setPermissionError] = useState("");
  const [notFoundError, setNotFoundError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [circle, setCircle] = useState<ManagedCircle | null>(null);
  const [posts, setPosts] = useState<ManagedPost[]>([]);
  const [comments, setComments] = useState<ManagedComment[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [savingCircle, setSavingCircle] = useState(false);
  const [rowLoadingId, setRowLoadingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: "post" | "comment" | "circle"; id: string; title: string } | null>(null);
  const [deletingCircle, setDeletingCircle] = useState(false);

  async function loadAll(activeSession: Session) {
    setLoading(true);
    setError("");
    setPermissionError("");
    setNotFoundError("");

    try {
      const managePayload = await sessionFetch<ManagePayload>(`/api/forum/circles/${circleSlug}/manage`, activeSession, { method: "GET" });
      if (!managePayload.circle) {
        throw new Error("CIRCLE_MANAGE_QUERY_FAILED");
      }

      setCircle(managePayload.circle);
      setDraftName(managePayload.circle.name);
      setDraftDescription(managePayload.circle.description ?? "");

      const [postsPayload, commentsPayload] = await Promise.all([
        sessionFetch<{ posts: ManagedPost[] }>(`/api/forum/circles/${circleSlug}/posts`, activeSession, { method: "GET" }),
        sessionFetch<{ comments: ManagedComment[] }>(`/api/forum/circles/${circleSlug}/comments`, activeSession, { method: "GET" }),
      ]);

      setPosts(postsPayload.posts ?? []);
      setComments(commentsPayload.comments ?? []);
    } catch (requestError) {
      const mapped = mapManageError(requestError instanceof Error ? requestError.message : "加载圈子管理数据失败");
      if (mapped.kind === "forbidden") {
        setPermissionError(mapped.text);
      } else if (mapped.kind === "not_found") {
        setNotFoundError(mapped.text);
      } else {
        setError(mapped.text);
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

    if (managePayload.circle) setCircle(managePayload.circle);
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
      setError(mapManageError(requestError instanceof Error ? requestError.message : "更新圈子失败").text);
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
      setError(mapManageError(requestError instanceof Error ? requestError.message : "更新帖子状态失败").text);
    } finally {
      setRowLoadingId(null);
    }
  }

  async function updateCircleStatus(status: "active" | "deleted") {
    if (!session || !circle) return;
    setSavingCircle(true);
    setError("");
    setSuccess("");

    try {
      const payload = await sessionFetch<{ circle: ManagedCircle }>(`/api/forum/circles/${circleSlug}/manage`, session, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setCircle(payload.circle);
      setSuccess(status === "deleted" ? "圈子已删除。" : "圈子已恢复。");
    } catch (requestError) {
      setError(mapManageError(requestError instanceof Error ? requestError.message : "更新圈子状态失败").text);
    } finally {
      setSavingCircle(false);
    }
  }

  async function confirmDeleteAction() {
    if (!session || !confirmDelete) return;
    if (confirmDelete.type === "circle" && deletingCircle) return;
    setRowLoadingId(confirmDelete.id);
    setError("");

    try {
      if (confirmDelete.type === "circle") {
        setDeletingCircle(true);
        await sessionFetch(`/api/forum/circles/${circleSlug}/manage`, session, { method: "DELETE" });
        setConfirmDelete(null);
        setSuccess("圈子已删除，正在返回圈子列表。");
        window.location.assign("/circles/");
        return;
      } else if (confirmDelete.type === "post") {
        await sessionFetch(`/api/forum/circles/${circleSlug}/posts?id=${confirmDelete.id}`, session, { method: "DELETE" });
      } else {
        await sessionFetch(`/api/forum/circles/${circleSlug}/comments?id=${confirmDelete.id}`, session, { method: "DELETE" });
      }
      if (confirmDelete.type !== "circle") {
        await refreshLists(session);
      }
      setSuccess(
        confirmDelete.type === "circle"
          ? "圈子已删除。"
          : confirmDelete.type === "post"
            ? "帖子已删除。"
            : "评论已删除。",
      );
      setConfirmDelete(null);
    } catch (requestError) {
      setConfirmDelete(null);
      setError(mapManageError(requestError instanceof Error ? requestError.message : "删除失败").text);
    } finally {
      setDeletingCircle(false);
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
      setError(mapManageError(requestError instanceof Error ? requestError.message : "更新评论状态失败").text);
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

  if (notFoundError) {
    return (
      <section className="community-surface community-surface--padded circle-manage-shell circle-manage-gate">
        <h2>圈子不存在</h2>
        <p>{notFoundError}</p>
        <a href="/circles/" className="community-action-button community-action-button--muted">
          返回圈子列表
        </a>
      </section>
    );
  }

  if (permissionError) {
    return (
      <section className="community-surface community-surface--padded circle-manage-shell circle-manage-gate">
        <h2>没有权限管理该圈子</h2>
        <p>{permissionError}</p>
        <a href={`/circles/${circleSlug}/`} className="community-action-button community-action-button--muted">
          返回圈子详情
        </a>
      </section>
    );
  }

  if (!circle) {
    return <section className="community-surface community-surface--padded circle-manage-shell"><p>圈子不存在。</p></section>;
  }

  return (
    <>
      <section className="community-surface community-surface--padded circle-manage-shell">
        <div className="community-stream-head">
          <div>
            <h2>管理圈子</h2>
          </div>
          <div className="community-inline-links">
            {circle.status === "deleted" ? (
              <a href="/circles/" className="community-action-button community-action-button--muted">返回圈子列表</a>
            ) : (
              <a href={`/circles/${circle.slug}/`} className="community-action-button community-action-button--muted">返回圈子详情</a>
            )}
          </div>
        </div>

        {error ? <div className="admin-error">{error}</div> : null}
        {success ? <div className="admin-inline-success">{success}</div> : null}

        <div className="circle-manage-grid">
          <article className="community-list-item circle-manage-panel">
            <strong>圈子信息</strong>
            <div className="admin-meta-grid">
              <span>slug：<code>{circle.slug}</code></span>
              <span className="circle-manage-status">状态：<span className={`admin-status-badge admin-status-${circle.status}`}>{circle.status}</span></span>
              <span>帖子：{circle.post_count}</span>
              <span>评论：{circle.comment_count}</span>
              <span>创建时间：{new Date(circle.created_at).toLocaleString("zh-CN")}</span>
            </div>
            {circle.cover_url ? (
              <div className="create-circle-form__preview">
                <img src={circle.cover_url} alt={`${circle.name} 圈子封面`} />
              </div>
            ) : null}
            <label>
              <span className="community-meta">圈子名称</span>
              <input className="community-input" value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={40} />
            </label>
            <label>
              <span className="community-meta">圈子介绍</span>
              <textarea className="community-input community-input--textarea" value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} maxLength={200} />
            </label>
            <CircleCoverEditor
              circleId={circle.id}
              circleSlug={circle.slug}
              supportsExtendedSchema={true}
              ownerId={circle.owner_id}
              onUpdated={(imagePath, coverUrl) =>
                setCircle((current) => (current ? { ...current, image_path: imagePath, cover_url: coverUrl ?? null } : current))
              }
            />
            <div className="community-cta-row">
              <button type="button" className="community-button" disabled={savingCircle} onClick={() => void saveCircle()}>
                {savingCircle ? "保存中..." : "保存圈子信息"}
              </button>
              {circle.status === "deleted" ? (
                <button
                  type="button"
                  className="community-action-button community-action-button--muted"
                  disabled={savingCircle}
                  onClick={() => void updateCircleStatus("active")}
                >
                  恢复圈子
                </button>
              ) : (
                <button
                  type="button"
                  className="community-action-button community-action-button--danger"
                  disabled={savingCircle || deletingCircle}
                  onClick={() => {
                    if (deletingCircle) return;
                    setConfirmDelete({ type: "circle", id: circle.id, title: circle.name });
                  }}
                >
                  删除圈子
                </button>
              )}
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
                    <span>作者：{actorHref(post.author) ? <a href={actorHref(post.author)!} className="community-post-meta__link">{formatActorLabel(post.author)}</a> : formatActorLabel(post.author)}</span>
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
                    <span>作者：{actorHref(comment.author) ? <a href={actorHref(comment.author)!} className="community-post-meta__link">{formatActorLabel(comment.author)}</a> : formatActorLabel(comment.author)}</span>
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
        title={
          confirmDelete?.type === "circle"
            ? "确认删除圈子"
            : confirmDelete?.type === "post"
              ? "确认删除帖子"
              : "确认删除评论"
        }
        description={
          confirmDelete?.type === "circle"
            ? "删除后圈子会从公开列表、公开详情和发帖选择器中隐藏，但数据库记录仍保留。"
            : confirmDelete?.type === "post"
              ? "删除后该帖子会在公开页面隐藏。"
              : "删除后有回复的评论会显示删除占位。"
        }
        detail={confirmDelete ? `目标：${confirmDelete.title}` : ""}
        confirmLabel={
          confirmDelete?.type === "circle"
            ? "确认删除圈子"
            : confirmDelete?.type === "post"
              ? "确认删除帖子"
              : "确认删除评论"
        }
        cancelLabel="取消"
        danger={true}
        loading={confirmDelete?.type === "circle" ? deletingCircle : !!confirmDelete && rowLoadingId === confirmDelete.id}
        error=""
        onCancel={() => {
          if (deletingCircle) return;
          setConfirmDelete(null);
        }}
        onConfirm={() => void confirmDeleteAction()}
      />
    </>
  );
}
