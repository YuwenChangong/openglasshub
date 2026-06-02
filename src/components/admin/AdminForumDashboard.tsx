import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AdminApiError, adminFetch, type AdminAuthState } from "../../lib/admin-api-client";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

type AdminPost = {
  id: string;
  title: string;
  status: string;
  author_id: string;
  author_name: string | null;
  circle_name: string | null;
  circle_slug: string | null;
  created_at: string;
  media_count: number;
  video_count: number;
  media_total_bytes: number;
  report_count: number;
};

type PostsPayload = {
  posts?: AdminPost[];
  error?: string;
  details?: unknown;
};

type PostActionPayload = {
  post?: { id: string; status: string };
  deleted?: boolean;
  error?: string;
  details?: unknown;
};

type StatusBadgeConfig = {
  label: string;
  className: string;
};

const DELETE_CONFIRM_MS = 5000;

function bytesLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[idx]}`;
}

function getStatusBadge(status: string): StatusBadgeConfig {
  switch (status) {
    case "published":
      return { label: "公开", className: "admin-status-badge admin-status-published" };
    case "hidden":
      return { label: "已隐藏", className: "admin-status-badge admin-status-hidden" };
    case "deleted":
      return { label: "已删除", className: "admin-status-badge admin-status-deleted" };
    case "pending":
      return { label: "待审核", className: "admin-status-badge admin-status-pending" };
    default:
      return { label: status || "未知", className: "admin-status-badge" };
  }
}

export default function AdminForumDashboard() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [authState, setAuthState] = useState<AdminAuthState>("checking");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [rowSuccess, setRowSuccess] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const deleteConfirmTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (deleteConfirmTimer.current !== null) {
        window.clearTimeout(deleteConfirmTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthState("error");
      setError("Supabase 浏览器客户端不可用");
      return;
    }

    let mounted = true;

    const applySession = async () => {
      setAuthState("checking");
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!mounted) return;

      if (sessionError) {
        setSession(null);
        setAuthState("error");
        setError(sessionError.message);
        return;
      }

      const nextSession = data.session ?? null;
      setSession(nextSession);
      setAuthState(nextSession ? "ready" : "signed_out");
    };

    void applySession();

    const { data: listener } = supabase.auth.onAuthStateChange(async () => {
      await applySession();
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  async function loadPosts(currentSession: Session, currentStatus: string) {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ status: currentStatus, limit: "80" });
      const payload = await adminFetch<PostsPayload>(`/api/admin/forum/posts?${query.toString()}`, {
        method: "GET",
        session: currentSession,
      });
      setPosts(payload.posts ?? []);
      setAuthState("ready");
    } catch (requestError) {
      if (requestError instanceof AdminApiError) {
        if (requestError.status === 401) {
          setAuthState("signed_out");
        } else if (requestError.status === 403) {
          setAuthState("forbidden");
        } else {
          setAuthState("error");
        }
        setError(requestError.message);
      } else {
        setAuthState("error");
        setError(requestError instanceof Error ? requestError.message : "加载失败");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authState !== "ready" || !session) return;
    void loadPosts(session, statusFilter);
  }, [authState, session, statusFilter]);

  function clearRowFeedback(postId: string) {
    setRowSuccess((current) => {
      const next = { ...current };
      delete next[postId];
      return next;
    });
    setRowError((current) => {
      const next = { ...current };
      delete next[postId];
      return next;
    });
  }

  function armDeleteConfirmation(postId: string) {
    setConfirmDeleteId(postId);
    if (deleteConfirmTimer.current !== null) {
      window.clearTimeout(deleteConfirmTimer.current);
    }
    deleteConfirmTimer.current = window.setTimeout(() => {
      setConfirmDeleteId((current) => (current === postId ? null : current));
      deleteConfirmTimer.current = null;
    }, DELETE_CONFIRM_MS);
  }

  function applyPostStatus(postId: string, nextStatus: string) {
    setPosts((current) =>
      current.map((post) => (post.id === postId ? { ...post, status: nextStatus } : post)),
    );
  }

  async function mutatePost(postId: string, action: "hide" | "restore" | "delete") {
    if (!session) return;

    if (action === "delete" && confirmDeleteId !== postId) {
      clearRowFeedback(postId);
      armDeleteConfirmation(postId);
      return;
    }

    setActionLoadingId(postId);
    clearRowFeedback(postId);
    setError("");

    try {
      if (action === "delete") {
        const payload = await adminFetch<PostActionPayload>(
          `/api/admin/forum/posts?id=${encodeURIComponent(postId)}`,
          {
            method: "DELETE",
            session,
          },
        );
        applyPostStatus(postId, payload.post?.status ?? "deleted");
        setRowSuccess((current) => ({ ...current, [postId]: "已删除并清理媒体" }));
      } else {
        const payload = await adminFetch<PostActionPayload>("/api/admin/forum/posts", {
          method: "PATCH",
          session,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: postId, action }),
        });
        const nextStatus = payload.post?.status ?? (action === "hide" ? "hidden" : "published");
        applyPostStatus(postId, nextStatus);
        setRowSuccess((current) => ({
          ...current,
          [postId]: action === "hide" ? "已隐藏" : "已恢复为公开",
        }));
      }
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : action === "delete" ? "删除失败" : "操作失败";
      setRowError((current) => ({ ...current, [postId]: message }));
      if (requestError instanceof AdminApiError) {
        if (requestError.status === 401) {
          setAuthState("signed_out");
        } else if (requestError.status === 403) {
          setAuthState("forbidden");
        }
      }
    } finally {
      if (deleteConfirmTimer.current !== null) {
        window.clearTimeout(deleteConfirmTimer.current);
        deleteConfirmTimer.current = null;
      }
      setConfirmDeleteId(null);
      setActionLoadingId(null);
    }
  }

  if (authState === "checking") {
    return (
      <div className="community-empty admin-state-message">
        <strong>正在确认登录状态...</strong>
      </div>
    );
  }

  if (authState === "signed_out") {
    return (
      <div className="community-empty admin-state-message">
        <strong>请先登录</strong>
        <p>管理员页面需要登录后访问。</p>
      </div>
    );
  }

  if (authState === "forbidden") {
    return (
      <div className="community-empty admin-state-message admin-error">
        <strong>当前账号没有管理员权限</strong>
      </div>
    );
  }

  if (authState === "error") {
    return (
      <div className="community-empty admin-state-message admin-error">
        <strong>加载失败</strong>
        <p>{error || "管理员页面加载失败"}</p>
      </div>
    );
  }

  return (
    <section className="community-surface">
      <div className="community-stream-head">
        <div>
          <h2>管理员帖子治理</h2>
          <p>查看帖子状态、举报量和媒体体积，并执行隐藏、恢复、删除。</p>
        </div>
        <div className="community-cta-row">
          {[
            { key: "all", label: "全部" },
            { key: "published", label: "公开" },
            { key: "hidden", label: "隐藏" },
            { key: "deleted", label: "删除" },
            { key: "pending", label: "待审核" },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              className={statusFilter === item.key ? "community-button" : "community-button--secondary"}
              onClick={() => setStatusFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error && authState === "ready" ? <div className="admin-error">{error}</div> : null}
      {loading ? <p className="community-meta admin-state-message">正在加载帖子列表...</p> : null}

      {!loading && posts.length === 0 ? (
        <div className="community-empty">
          <strong>暂无帖子</strong>
          <p>当前筛选条件下没有可治理的帖子。</p>
        </div>
      ) : (
        <div className="community-list" style={{ marginTop: "0.8rem" }}>
          {posts.map((post) => {
            const loadingThis = actionLoadingId === post.id;
            const badge = getStatusBadge(post.status);
            const deleted = post.status === "deleted";
            const hideDisabled = loadingThis || deleted || post.status === "hidden";
            const restoreDisabled = loadingThis || deleted || post.status === "published";
            const deleteArmed = confirmDeleteId === post.id;

            return (
              <article key={post.id} className="community-list-item" style={{ gap: "0.65rem" }}>
                <div className="admin-action-row">
                  <strong>{post.title}</strong>
                  <span className={badge.className}>{badge.label}</span>
                </div>
                <span>
                  圈子 {post.circle_name ?? "-"} · 作者 {post.author_name ?? post.author_id}
                </span>
                <span>
                  媒体 {post.media_count}（视频 {post.video_count}）· 总大小 {bytesLabel(post.media_total_bytes)} · 举报 {post.report_count}
                </span>
                <span>{new Date(post.created_at).toLocaleString("zh-CN")}</span>

                {rowSuccess[post.id] ? <div className="admin-inline-success">{rowSuccess[post.id]}</div> : null}
                {rowError[post.id] ? <div className="admin-error">{rowError[post.id]}</div> : null}

                <div className="admin-action-row">
                  <a href={`/posts/${post.id}/`} className="admin-action-button">
                    查看帖子
                  </a>
                  <button
                    type="button"
                    className="admin-action-button"
                    onClick={() => mutatePost(post.id, "hide")}
                    disabled={hideDisabled}
                  >
                    {loadingThis && post.status !== "hidden" ? "处理中..." : deleted ? "已删除" : "隐藏"}
                  </button>
                  <button
                    type="button"
                    className="admin-action-button"
                    onClick={() => mutatePost(post.id, "restore")}
                    disabled={restoreDisabled}
                  >
                    {loadingThis && post.status !== "published" ? "处理中..." : deleted ? "已删除" : "恢复"}
                  </button>
                  <button
                    type="button"
                    className="admin-action-button admin-action-danger"
                    onClick={() => mutatePost(post.id, "delete")}
                    disabled={loadingThis || deleted}
                  >
                    {deleted
                      ? "已删除"
                      : deleteArmed
                        ? "确认删除"
                        : loadingThis
                          ? "处理中..."
                          : "删除"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
