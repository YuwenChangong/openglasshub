import { useEffect, useState } from "react";
import { AdminApiError, adminFetch } from "../../lib/admin-api-client";
import { useAdminSession } from "./useAdminSession";

type AdminReport = {
  id: string;
  target_type: string | null;
  target_id: string | null;
  reporter_id: string;
  reason: string;
  status: string | null;
  created_at: string;
  reporter_profile: {
    id: string;
    display_name?: string | null;
    username?: string | null;
    avatar_url?: string | null;
    role?: string | null;
  } | null;
  post: {
    id: string;
    title: string | null;
    body_excerpt: string;
    status: string | null;
    author_id: string | null;
    author_profile: {
      id: string;
      display_name?: string | null;
      username?: string | null;
      avatar_url?: string | null;
      role?: string | null;
    } | null;
    circle: {
      id: string;
      name: string | null;
      slug: string | null;
    } | null;
    created_at: string | null;
    updated_at: string | null;
  } | null;
};

type ReportsPayload = {
  reports?: AdminReport[];
};

type DataState = "idle" | "loading" | "ready" | "error";

function shortId(id: string | null | undefined): string {
  if (!id) return "-";
  return `${id.slice(0, 8)}...`;
}

function getStatusBadge(status: string | null) {
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
      return { label: status ?? "未知", className: "admin-status-badge" };
  }
}

function profileLabel(profile: { display_name?: string | null; username?: string | null } | null, fallback = "未知用户") {
  return profile?.display_name || profile?.username || fallback;
}

export default function AdminReportsPanel() {
  const adminSession = useAdminSession();
  const [dataState, setDataState] = useState<DataState>("idle");
  const [error, setError] = useState("");
  const [reports, setReports] = useState<AdminReport[]>([]);

  useEffect(() => {
    if (adminSession.state.status !== "ready" || !adminSession.session) return;

    let cancelled = false;

    const loadReports = async () => {
      setDataState("loading");
      setError("");
      try {
        const payload = await adminFetch<ReportsPayload>("/api/admin/forum/reports?limit=120", {
          method: "GET",
          session: adminSession.session,
        });
        if (cancelled) return;
        setReports(payload.reports ?? []);
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
        setError(requestError instanceof Error ? requestError.message : "加载举报列表失败");
        setDataState("error");
      }
    };

    void loadReports();
    return () => {
      cancelled = true;
    };
  }, [adminSession.session, adminSession.state.status]);

  if (adminSession.state.status === "checking") {
    return <div className="community-empty admin-state-message"><strong>{adminSession.state.message}</strong></div>;
  }
  if (adminSession.state.status === "timeout") {
    return <div className="community-empty admin-state-message admin-timeout"><strong>{adminSession.state.message}</strong>{adminSession.state.details ? <p className="admin-debug-note">{adminSession.state.details}</p> : null}</div>;
  }
  if (adminSession.state.status === "signed_out") {
    return <div className="community-empty admin-state-message"><strong>{adminSession.state.message}</strong>{adminSession.state.details ? <p className="admin-debug-note">{adminSession.state.details}</p> : null}</div>;
  }
  if (adminSession.state.status === "forbidden") {
    return <div className="community-empty admin-state-message admin-error"><strong>{adminSession.state.message}</strong>{adminSession.state.details ? <p className="admin-debug-note">{adminSession.state.details}</p> : null}</div>;
  }
  if (adminSession.state.status === "error") {
    return <div className="community-empty admin-state-message admin-error"><strong>{adminSession.state.message}</strong>{adminSession.state.details ? <p className="admin-debug-note">{adminSession.state.details}</p> : null}</div>;
  }

  return (
    <section className="community-surface">
      <div className="community-stream-head">
        <div>
          <h2>举报列表</h2>
          <p>查看举报原因、帖子状态和相关作者信息，并跳转处理。</p>
        </div>
      </div>

      <div className="admin-user-line">
        当前管理员：{adminSession.me?.profile?.display_name || adminSession.me?.profile?.username || shortId(adminSession.me?.user_id)} · 角色 {adminSession.me?.role}
      </div>

      {error ? <div className="admin-error">{error}</div> : null}
      {dataState === "loading" ? <p className="community-meta admin-state-message">正在加载举报列表...</p> : null}

      {dataState === "ready" && reports.length === 0 ? (
        <div className="community-empty">
          <strong>暂无举报</strong>
          <p>当前没有可处理的举报记录。</p>
        </div>
      ) : null}

      {reports.length > 0 ? (
        <div className="community-list" style={{ marginTop: "0.8rem" }}>
          {reports.map((report) => {
            const badge = getStatusBadge(report.post?.status ?? report.status);
            const postAuthor = profileLabel(report.post?.author_profile);
            const reporter = profileLabel(report.reporter_profile);
            const postExists = report.target_type === "post" && Boolean(report.post);

            return (
              <article key={report.id} className="community-list-item admin-report-card" style={{ gap: "0.6rem" }}>
                <div className="admin-action-row">
                  <strong>{report.post?.title ?? "帖子不存在或已删除"}</strong>
                  <span className={badge.className}>{badge.label}</span>
                </div>
                <div className="admin-report-target">
                  {report.post ? (
                    <>
                      <span>圈子：{report.post.circle?.name ?? "未归属圈子"}</span>
                      {report.post.body_excerpt ? <p className="admin-post-excerpt">{report.post.body_excerpt}</p> : null}
                    </>
                  ) : (
                    <span className="admin-report-missing-target">
                      {report.target_type === "post" ? "帖子不存在或已删除" : "暂不支持的举报目标类型"}
                    </span>
                  )}
                </div>
                <div className="admin-meta-grid">
                  <span className="admin-report-author">帖子作者：{postAuthor} <code>{shortId(report.post?.author_id)}</code></span>
                  <span>举报人：{reporter} <code>{shortId(report.reporter_id)}</code></span>
                  <span>举报时间：{new Date(report.created_at).toLocaleString("zh-CN")}</span>
                </div>
                <p className="admin-post-excerpt">举报原因：{report.reason}</p>
                <div className="admin-action-row">
                  {postExists ? (
                    <>
                      <a href={`/posts/${report.post?.id}/`} className="admin-action-button">查看帖子</a>
                      <a href={`/admin/forum/?post=${report.post?.id}`} className="admin-action-button">去处理帖子</a>
                    </>
                  ) : (
                    <span className="admin-report-missing-target">帖子不存在或已删除</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
