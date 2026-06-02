import { useEffect, useState } from "react";
import { AdminApiError, adminFetch } from "../../lib/admin-api-client";
import { useAdminSession } from "./useAdminSession";

type AdminReport = {
  id: string;
  post_id: string;
  reporter_id: string;
  reason: string;
  status: string;
  created_at: string;
  post_title: string | null;
  post_status: string | null;
  post_author_id: string | null;
  post_author_profile: {
    id: string;
    display_name?: string | null;
    username?: string | null;
  } | null;
  reporter_profile: {
    id: string;
    display_name?: string | null;
    username?: string | null;
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
            const badge = getStatusBadge(report.post_status);
            const postAuthor =
              report.post_author_profile?.display_name ||
              report.post_author_profile?.username ||
              "未知用户";
            const reporter =
              report.reporter_profile?.display_name ||
              report.reporter_profile?.username ||
              "未知用户";

            return (
              <article key={report.id} className="community-list-item" style={{ gap: "0.6rem" }}>
                <div className="admin-action-row">
                  <strong>{report.post_title ?? "(帖子已删除)"}</strong>
                  <span className={badge.className}>{badge.label}</span>
                </div>
                <div className="admin-meta-grid">
                  <span>帖子作者：{postAuthor} <code>{shortId(report.post_author_id)}</code></span>
                  <span>举报人：{reporter} <code>{shortId(report.reporter_id)}</code></span>
                  <span>举报时间：{new Date(report.created_at).toLocaleString("zh-CN")}</span>
                </div>
                <p className="admin-post-excerpt">举报原因：{report.reason}</p>
                <div className="admin-action-row">
                  <a href={`/posts/${report.post_id}/`} className="admin-action-button">查看帖子</a>
                  <a href="/admin/forum/" className="admin-action-button">去处理帖子</a>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
