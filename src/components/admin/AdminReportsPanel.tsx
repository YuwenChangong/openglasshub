import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AdminApiError, adminFetch, type AdminAuthState } from "../../lib/admin-api-client";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

type AdminReport = {
  id: string;
  post_id: string;
  reporter_id: string;
  reason: string;
  status: string;
  created_at: string;
  post_title: string | null;
  post_status: string | null;
};

type ReportsPayload = {
  reports?: AdminReport[];
  error?: string;
  details?: unknown;
};

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
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [authState, setAuthState] = useState<AdminAuthState>("checking");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reports, setReports] = useState<AdminReport[]>([]);

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

  useEffect(() => {
    if (authState !== "ready" || !session) return;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const payload = await adminFetch<ReportsPayload>("/api/admin/forum/reports?limit=120", {
          method: "GET",
          session,
        });
        setReports(payload.reports ?? []);
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
    };

    void load();
  }, [authState, session]);

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
          <h2>举报列表</h2>
          <p>查看帖子举报内容，并跳转到帖子执行隐藏、恢复或删除处理。</p>
        </div>
      </div>

      {error && authState === "ready" ? <div className="admin-error">{error}</div> : null}
      {loading ? <p className="community-meta admin-state-message">正在加载举报列表...</p> : null}

      {!loading && reports.length === 0 ? (
        <div className="community-empty">
          <strong>暂无举报</strong>
          <p>当前没有可处理的举报记录。</p>
        </div>
      ) : (
        <div className="community-list" style={{ marginTop: "0.8rem" }}>
          {reports.map((report) => {
            const badge = getStatusBadge(report.post_status);
            return (
              <article key={report.id} className="community-list-item" style={{ gap: "0.6rem" }}>
                <div className="admin-action-row">
                  <strong>{report.post_title ?? "(帖子已删除)"}</strong>
                  <span className={badge.className}>{badge.label}</span>
                </div>
                <span>post: {report.post_id}</span>
                <span>reporter: {report.reporter_id}</span>
                <span>举报原因：{report.reason}</span>
                <span>{new Date(report.created_at).toLocaleString("zh-CN")}</span>
                <div className="admin-action-row">
                  <a href={`/posts/${report.post_id}/`} className="admin-action-button">
                    查看帖子
                  </a>
                  <a href="/admin/forum/" className="admin-action-button">
                    去处理帖子
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
