import { useEffect, useRef, useState } from "react";
import { AdminApiError, adminFetch } from "../../lib/admin-api-client";
import { useAdminSession } from "./useAdminSession";

type AdminPost = {
  id: string;
  title: string;
  body_excerpt: string;
  status: string;
  author_id: string;
  author_profile: {
    id: string;
    username?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
    role?: string | null;
  } | null;
  circle_id: string | null;
  circle_name: string | null;
  circle_slug: string | null;
  created_at: string;
  updated_at: string;
  media_count: number;
  media_total_bytes: number;
  video_count: number;
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

type DataState = "idle" | "loading" | "ready" | "error";
type StatusBadgeConfig = { label: string; className: string };

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

function shortId(id: string | null | undefined): string {
  if (!id) return "-";
  return `${id.slice(0, 8)}...`;
}

function authorLabel(post: AdminPost): string {
  return post.author_profile?.display_name || post.author_profile?.username || "未知用户";
}

export default function AdminForumDashboard() {
  const adminSession = useAdminSession();
  const [dataState, setDataState] = useState<DataState>("idle");
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
      if (deleteConfirmTimer.current !== null) window.clearTimeout(deleteConfirmTimer.current);
    };
  }, []);

  useEffect(() => {
    if (adminSession.state.status !== "ready" || !adminSession.session) return;

    let cancelled = false;

    const loadPosts = async () => {
      setDataState("loading");
      setError("");
      try {
        const query = new URLSearchParams({ status: statusFilter, limit: "80" });
        const payload = await adminFetch<PostsPayload>(`/api/admin/forum/posts?${query.toString()}`, {
          method: "GET",
          session: adminSession.session,
        });
        if (cancelled) return;
        setPosts(payload.posts ?? []);
        setDataState("ready");
      } catch (requestError) {
        if (cancelled) return;
        if (requestError instanceof AdminApiError && requestError.status === 401) {
          adminSession.setState({
            status: "signed_out",
            message: "登录状态已失效，请重新登录",
            details: `api status code: 401 | error message: ${requestError.message}`,
          });
          return;
        }
        if (requestError instanceof AdminApiError && requestError.status === 403) {
          adminSession.setState({
            status: "forbidden",
            message: "当前账号没有管理员权限",
            details:
              typeof requestError.details === "string"
                ? requestError.details
                : `api status code: 403 | error message: ${requestError.message}`,
          });
          return;
        }
        setError(requestError instanceof Error ? requestError.message : "加载帖子列表失败");
        setDataState("error");
      }
    };

    void loadPosts();

    return () => {
      cancelled = true;
    };
  }, [adminSession.session, adminSession.state.status, statusFilter]);

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
    if (deleteConfirmTimer.current !== null) window.clearTimeout(deleteConfirmTimer.current);
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
    if (!adminSession.session) return;

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
            session: adminSession.session,
          },
        );
        applyPostStatus(postId, payload.post?.status ?? "deleted");
        setRowSuccess((current) => ({ ...current, [postId]: "已删除并清理媒体" }));
      } else {
        const payload = await adminFetch<PostActionPayload>("/api/admin/forum/posts", {
          method: "PATCH",
          session: adminSession.session,
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
      const message = requestError instanceof Error ? requestError.message : "操作失败";
      if (requestError instanceof AdminApiError && requestError.status === 401) {
        adminSession.setState({
          status: "signed_out",
          message: "登录状态已失效，请重新登录",
          details: `api status code: 401 | error message: ${message}`,
        });
      } else if (requestError instanceof AdminApiError && requestError.status === 403) {
        adminSession.setState({
          status: "forbidden",
          message: "当前账号没有管理员权限",
          details:
            typeof requestError.details === "string"
              ? requestError.details
              : `api status code: 403 | error message: ${message}`,
        });
      }
      setRowError((current) => ({ ...current, [postId]: message }));
    } finally {
      if (deleteConfirmTimer.current !== null) {
        window.clearTimeout(deleteConfirmTimer.current);
        deleteConfirmTimer.current = null;
      }
      setConfirmDeleteId(null);
      setActionLoadingId(null);
    }
  }

  if (adminSession.state.status === "checking") {
    return (
      <div className="community-empty admin-state-message">
        <strong>{adminSession.state.message}</strong>
      </div>
    );
  }

  if (adminSession.state.status === "timeout") {
    return (
      <div className="community-empty admin-state-message admin-timeout">
        <strong>{adminSession.state.message}</strong>
        {adminSession.state.details ? <p className="admin-debug-note">{adminSession.state.details}</p> : null}
      </div>
    );
  }

  if (adminSession.state.status === "signed_out") {
    return (
      <div className="community-empty admin-state-message">
        <strong>{adminSession.state.message}</strong>
        {adminSession.state.details ? <p className="admin-debug-note">{adminSession.state.details}</p> : null}
      </div>
    );
  }

  if (adminSession.state.status === "forbidden") {
    return (
      <div className="community-empty admin-state-message admin-error">
        <strong>{adminSession.state.message}</strong>
        {adminSession.state.details ? <p className="admin-debug-note">{adminSession.state.details}</p> : null}
      </div>
    );
  }

  if (adminSession.state.status === "error") {
    return (
      <div className="community-empty admin-state-message admin-error">
        <strong>{adminSession.state.message}</strong>
        {adminSession.state.details ? <p className="admin-debug-note">{adminSession.state.details}</p> : null}
      </div>
    );
  }

  return (
    <section className="community-surface">
      <div className="community-stream-head">
        <div>
          <h2>管理员帖子治理</h2>
          <p>查看帖子内容、作者资料、媒体体积和举报数量，并执行隐藏、恢复、删除。</p>
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

      <div className="admin-user-line">
        当前管理员：{adminSession.me?.profile?.display_name || adminSession.me?.profile?.username || shortId(adminSession.me?.user_id)} ·
        角色 {adminSession.me?.role}
      </div>

      {error && dataState !== "loading" ? <div className="admin-error">{error}</div> : null}
      {dataState === "loading" ? <p className="community-meta admin-state-message">正在加载帖子列表...</p> : null}

      {dataState === "ready" && posts.length === 0 ? (
        <div className="community-empty">
          <strong>暂无帖子</strong>
          <p>当前筛选条件下没有可治理的帖子。</p>
        </div>
      ) : null}

      {posts.length > 0 ? (
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

                {post.body_excerpt ? <p className="admin-post-excerpt">{post.body_excerpt}</p> : null}

                <div className="admin-meta-grid">
                  <span>
                    作者：{authorLabel(post)} <code>{shortId(post.author_id)}</code>
                  </span>
                  <span>圈子：{post.circle_name ?? "-"}</span>
                  <span>媒体：{post.media_count}</span>
                  <span>视频：{post.video_count}</span>
                  <span>媒体总大小：{bytesLabel(post.media_total_bytes)}</span>
                  <span>举报：{post.report_count}</span>
                  <span>创建时间：{new Date(post.created_at).toLocaleString("zh-CN")}</span>
                </div>

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
                    {deleted ? "已删除" : deleteArmed ? "确认删除" : loadingThis ? "处理中..." : "删除"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
