import { useEffect, useMemo, useState } from "react";
import { AdminApiError, adminFetch } from "../../lib/admin-api-client";
import { useAdminSession } from "./useAdminSession";

type ReportTargetType = "post" | "comment" | "circle" | "user";
type ReportStatus = "open" | "reviewing" | "actioned" | "dismissed";
type ReportPriority = "low" | "normal" | "high";
type ReportReasonCode =
  | "spam"
  | "harassment"
  | "hate"
  | "sexual"
  | "violence"
  | "illegal"
  | "off_platform_contact"
  | "misinformation"
  | "privacy"
  | "other";

type ProfilePreview = {
  id: string;
  display_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  role?: string | null;
};

type AdminReportQueueItem = {
  id: string;
  reporter_id: string;
  reporter_profile: ProfilePreview | null;
  target_type: ReportTargetType;
  target_id: string;
  reason: string;
  reason_code: ReportReasonCode;
  reason_text: string | null;
  status: ReportStatus;
  priority: ReportPriority;
  assigned_to: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string | null;
  open_count_for_target: number;
  target:
    | {
        target_type: "post";
        target_id: string;
        title: string | null;
        excerpt: string;
        status: string | null;
        moderation_status: string | null;
        author_id: string | null;
        author_profile: ProfilePreview | null;
        circle: { id: string; name: string | null; slug: string | null } | null;
      }
    | {
        target_type: "comment";
        target_id: string;
        title: string | null;
        excerpt: string;
        status: string | null;
        moderation_status: string | null;
        author_id: string | null;
        author_profile: ProfilePreview | null;
        post: { id: string; title: string | null; status: string | null } | null;
        circle: { id: string; name: string | null; slug: string | null } | null;
      }
    | {
        target_type: "circle";
        target_id: string;
        title: string | null;
        excerpt: string;
        status: string | null;
        moderation_status: null;
        author_id: string | null;
        author_profile: ProfilePreview | null;
        circle: { id: string; name: string | null; slug: string | null } | null;
      }
    | {
        target_type: "user";
        target_id: string;
        title: string | null;
        excerpt: string;
        status: string | null;
        moderation_status: null;
        author_id: string | null;
        author_profile: ProfilePreview | null;
      }
    | null;
};

type ReportEventRecord = {
  id: string;
  report_id: string;
  actor_id: string | null;
  actor_profile: ProfilePreview | null;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type ReportsPayload = {
  reports?: AdminReportQueueItem[];
};

type ReportDetailPayload = {
  report: AdminReportQueueItem;
  events: ReportEventRecord[];
};

type ActionPayload = {
  ok?: boolean;
  report?: AdminReportQueueItem;
  events?: ReportEventRecord[];
  error?: string;
};

type FilterValue = "all" | string;
type DataState = "idle" | "loading" | "ready" | "error";

const STATUS_OPTIONS: Array<{ value: FilterValue; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "open", label: "待处理" },
  { value: "reviewing", label: "处理中" },
  { value: "actioned", label: "已处理" },
  { value: "dismissed", label: "已驳回" },
];

const TARGET_OPTIONS: Array<{ value: FilterValue; label: string }> = [
  { value: "all", label: "全部对象" },
  { value: "post", label: "帖子" },
  { value: "comment", label: "评论" },
  { value: "circle", label: "圈子" },
  { value: "user", label: "用户" },
];

const PRIORITY_OPTIONS: Array<{ value: FilterValue; label: string }> = [
  { value: "all", label: "全部优先级" },
  { value: "low", label: "低" },
  { value: "normal", label: "普通" },
  { value: "high", label: "高" },
];

const REASON_OPTIONS: Array<{ value: FilterValue; label: string }> = [
  { value: "all", label: "全部原因" },
  { value: "spam", label: "垃圾广告" },
  { value: "harassment", label: "骚扰或攻击" },
  { value: "hate", label: "仇恨内容" },
  { value: "sexual", label: "性相关违规" },
  { value: "violence", label: "暴力或威胁" },
  { value: "illegal", label: "违法内容" },
  { value: "off_platform_contact", label: "站外引流" },
  { value: "misinformation", label: "虚假或误导信息" },
  { value: "privacy", label: "隐私泄露" },
  { value: "other", label: "其他" },
];

function profileLabel(profile: ProfilePreview | null, fallback = "未知用户") {
  return profile?.display_name || profile?.username || fallback;
}

function shortId(id: string | null | undefined) {
  if (!id) return "-";
  return `${id.slice(0, 8)}...`;
}

function targetLabel(report: AdminReportQueueItem) {
  switch (report.target_type) {
    case "post":
      return "帖子";
    case "comment":
      return "评论";
    case "circle":
      return "圈子";
    case "user":
      return "用户";
    default:
      return report.target_type;
  }
}

function statusLabel(status: string | null) {
  switch (status) {
    case "open":
      return "待处理";
    case "reviewing":
      return "处理中";
    case "actioned":
      return "已处理";
    case "dismissed":
      return "已驳回";
    case "published":
      return "公开";
    case "pending":
      return "待审核";
    case "deleted":
      return "已删除";
    case "hidden":
      return "已隐藏";
    default:
      return status ?? "未知";
  }
}

function targetLink(report: AdminReportQueueItem) {
  if (!report.target) return null;
  switch (report.target.target_type) {
    case "post":
      return `/posts/${report.target.target_id}/`;
    case "comment":
      return report.target.post?.id ? `/posts/${report.target.post.id}/#comment-${report.target.target_id}` : null;
    case "circle":
      return report.target.circle?.slug ? `/circles/${report.target.circle.slug}/` : null;
    case "user":
      return report.target.author_profile?.username ? `/u/${encodeURIComponent(report.target.author_profile.username)}/` : null;
    default:
      return null;
  }
}

function isHideSupported(report: AdminReportQueueItem | null) {
  return report?.target_type === "post" || report?.target_type === "comment" || report?.target_type === "circle";
}

function hasTargetUser(report: AdminReportQueueItem | null) {
  return Boolean(
    report && (report.target_type === "user" ? report.target_id : report.target?.author_id),
  );
}

export default function AdminReportsPanel() {
  const adminSession = useAdminSession();
  const [dataState, setDataState] = useState<DataState>("idle");
  const [error, setError] = useState("");
  const [reports, setReports] = useState<AdminReportQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<ReportDetailPayload | null>(null);
  const [note, setNote] = useState("");
  const [until, setUntil] = useState("");
  const [rowMessage, setRowMessage] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    status: "open" as FilterValue,
    target_type: "all" as FilterValue,
    reason_code: "all" as FilterValue,
    priority: "all" as FilterValue,
  });

  const selectedReport = detail?.report ?? reports.find((report) => report.id === selectedId) ?? null;

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", "120");
    if (filters.status !== "all") params.set("status", filters.status);
    if (filters.target_type !== "all") params.set("target_type", filters.target_type);
    if (filters.reason_code !== "all") params.set("reason_code", filters.reason_code);
    if (filters.priority !== "all") params.set("priority", filters.priority);
    return params.toString();
  }, [filters]);

  useEffect(() => {
    if (adminSession.state.status !== "ready" || !adminSession.session) return;
    let cancelled = false;

    async function loadReports() {
      setDataState("loading");
      setError("");
      try {
        const payload = await adminFetch<ReportsPayload>(`/api/admin/reports?${queryString}`, {
          method: "GET",
          session: adminSession.session,
        });
        if (cancelled) return;
        const nextReports = payload.reports ?? [];
        setReports(nextReports);
        setSelectedId((current) => {
          if (current && nextReports.some((report) => report.id === current)) return current;
          return nextReports[0]?.id ?? null;
        });
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
    }

    void loadReports();
    return () => {
      cancelled = true;
    };
  }, [adminSession, queryString]);

  useEffect(() => {
    if (!selectedId || adminSession.state.status !== "ready" || !adminSession.session) {
      setDetail(null);
      return;
    }
    let cancelled = false;

    async function loadDetail() {
      setDetailLoading(true);
      setRowMessage("");
      try {
        const payload = await adminFetch<ReportDetailPayload>(`/api/admin/reports/${selectedId}`, {
          method: "GET",
          session: adminSession.session,
        });
        if (!cancelled) setDetail(payload);
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "加载举报详情失败");
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [adminSession.session, adminSession.state.status, selectedId]);

  async function runAction(action: string) {
    if (!selectedReport || !adminSession.session) return;
    setActionLoading(action);
    setError("");
    setRowMessage("");
    try {
      const payload = await adminFetch<ActionPayload>(`/api/admin/reports/${selectedReport.id}/action`, {
        method: "POST",
        session: adminSession.session,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          note: note.trim() || null,
          until: until.trim() || null,
        }),
      });
      setRowMessage("操作已更新。");
      if (payload.report) {
        setReports((current) =>
          current.map((report) => (report.id === payload.report?.id ? payload.report : report)),
        );
      }
      if (payload.report && payload.events) {
        setDetail({ report: payload.report, events: payload.events });
      }
      if (action !== "reviewing") {
        setNote("");
        setUntil("");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "操作失败");
    } finally {
      setActionLoading(null);
    }
  }

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
          <h2>举报队列</h2>
          <p>查看举报详情，联动隐藏内容和用户安全动作，不暴露 reporter 邮箱。</p>
        </div>
      </div>

      <div className="admin-user-line">
        当前管理员：{adminSession.me?.profile?.display_name || adminSession.me?.profile?.username || shortId(adminSession.me?.user_id)} · 角色 {adminSession.me?.role}
      </div>

      <div className="admin-reports-filters">
        <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={filters.target_type} onChange={(event) => setFilters((current) => ({ ...current, target_type: event.target.value }))}>
          {TARGET_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={filters.reason_code} onChange={(event) => setFilters((current) => ({ ...current, reason_code: event.target.value }))}>
          {REASON_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={filters.priority} onChange={(event) => setFilters((current) => ({ ...current, priority: event.target.value }))}>
          {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      {error ? <div className="admin-error">{error}</div> : null}
      {rowMessage ? <div className="admin-inline-success">{rowMessage}</div> : null}
      {dataState === "loading" ? <p className="community-meta admin-state-message">正在加载举报队列...</p> : null}

      {dataState === "ready" && reports.length === 0 ? (
        <div className="community-empty">
          <strong>暂无举报</strong>
          <p>当前没有可处理的举报记录。</p>
        </div>
      ) : null}

      {reports.length > 0 ? (
        <div className="admin-reports-layout">
          <div className="admin-reports-list">
            {reports.map((report) => {
              const active = report.id === selectedId;
              return (
                <button
                  key={report.id}
                  type="button"
                  className={`community-list-item admin-report-card admin-report-card--selectable${active ? " is-active" : ""}`}
                  onClick={() => setSelectedId(report.id)}
                >
                  <div className="admin-action-row">
                    <strong>{report.target?.title || `${targetLabel(report)} ${shortId(report.target_id)}`}</strong>
                    <span className="admin-status-badge">{statusLabel(report.status)}</span>
                  </div>
                  <div className="admin-report-target">
                    <span>{targetLabel(report)} · {profileLabel(report.reporter_profile, "匿名举报者")} · {new Date(report.created_at).toLocaleString("zh-CN")}</span>
                    <p className="admin-post-excerpt">{report.reason}</p>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="admin-reports-detail community-list-item">
            {detailLoading ? (
              <p className="community-meta">正在加载举报详情...</p>
            ) : !selectedReport ? (
              <p className="community-meta">选择一条举报查看详情。</p>
            ) : (
              <>
                <div className="admin-action-row">
                  <div>
                    <strong>{selectedReport.target?.title || `${targetLabel(selectedReport)} ${shortId(selectedReport.target_id)}`}</strong>
                    <p className="community-meta" style={{ marginTop: "0.35rem" }}>
                      {targetLabel(selectedReport)} · 举报状态 {statusLabel(selectedReport.status)} · 打开举报 {selectedReport.open_count_for_target}
                    </p>
                  </div>
                  {targetLink(selectedReport) ? (
                    <a href={targetLink(selectedReport) ?? "#"} className="admin-action-button">
                      查看目标
                    </a>
                  ) : null}
                </div>

                <div className="admin-meta-grid">
                  <span>举报人：{profileLabel(selectedReport.reporter_profile)} <code>{shortId(selectedReport.reporter_id)}</code></span>
                  <span>原因分类：{REASON_OPTIONS.find((option) => option.value === selectedReport.reason_code)?.label ?? selectedReport.reason_code}</span>
                  <span>优先级：{selectedReport.priority}</span>
                  <span>内容作者：{profileLabel(selectedReport.target?.author_profile ?? null)} <code>{shortId(selectedReport.target?.author_id ?? null)}</code></span>
                </div>

                <div className="admin-report-target">
                  <span>举报说明</span>
                  <p className="admin-post-excerpt">{selectedReport.reason_text || selectedReport.reason}</p>
                  {selectedReport.target?.excerpt ? (
                    <>
                      <span>目标摘要</span>
                      <p className="admin-post-excerpt">{selectedReport.target.excerpt}</p>
                    </>
                  ) : null}
                </div>

                <label className="admin-note-field">
                  <span className="community-meta">处理备注</span>
                  <textarea
                    className="glass-textarea"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="记录处理原因、备注或用户安全说明"
                    maxLength={1000}
                  />
                </label>

                <label className="admin-note-field">
                  <span className="community-meta">暂停到期时间（仅 suspend）</span>
                  <input
                    type="datetime-local"
                    className="community-field"
                    value={until}
                    onChange={(event) => setUntil(event.target.value)}
                  />
                </label>

                <div className="admin-inline-actions">
                  <button type="button" className="admin-action-button" disabled={actionLoading !== null} onClick={() => void runAction("reviewing")}>
                    {actionLoading === "reviewing" ? "处理中..." : "标记处理中"}
                  </button>
                  <button type="button" className="admin-action-button" disabled={actionLoading !== null} onClick={() => void runAction("dismiss")}>
                    {actionLoading === "dismiss" ? "处理中..." : "驳回举报"}
                  </button>
                  {isHideSupported(selectedReport) ? (
                    <button type="button" className="admin-action-button" disabled={actionLoading !== null} onClick={() => void runAction("hide_target")}>
                      {actionLoading === "hide_target" ? "处理中..." : "隐藏内容"}
                    </button>
                  ) : null}
                  {selectedReport?.target_type !== "circle" && selectedReport?.target_type !== "user" ? (
                    <button type="button" className="admin-action-button" disabled={actionLoading !== null} onClick={() => void runAction("reject_target")}>
                      {actionLoading === "reject_target" ? "处理中..." : "拒绝内容"}
                    </button>
                  ) : null}
                  {hasTargetUser(selectedReport) ? (
                    <>
                      <button type="button" className="admin-action-button" disabled={actionLoading !== null} onClick={() => void runAction("warn_user")}>
                        {actionLoading === "warn_user" ? "处理中..." : "警告用户"}
                      </button>
                      <button type="button" className="admin-action-button" disabled={actionLoading !== null} onClick={() => void runAction("suspend_user")}>
                        {actionLoading === "suspend_user" ? "处理中..." : "暂停用户"}
                      </button>
                      <button type="button" className="admin-action-button admin-action-danger" disabled={actionLoading !== null} onClick={() => void runAction("ban_user")}>
                        {actionLoading === "ban_user" ? "处理中..." : "封禁用户"}
                      </button>
                    </>
                  ) : null}
                </div>

                <div className="admin-report-events">
                  <h3>处理记录</h3>
                  {detail?.events?.length ? (
                    detail.events.map((event) => (
                      <div key={event.id} className="admin-report-event">
                        <div className="admin-action-row">
                          <strong>{event.event_type}</strong>
                          <span className="community-meta">{new Date(event.created_at).toLocaleString("zh-CN")}</span>
                        </div>
                        <p className="community-meta">
                          操作人：{profileLabel(event.actor_profile)} {event.actor_id ? <code>{shortId(event.actor_id)}</code> : null}
                        </p>
                        {Object.keys(event.metadata ?? {}).length > 0 ? (
                          <pre className="admin-report-event__meta">{JSON.stringify(event.metadata, null, 2)}</pre>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="community-meta">暂无处理记录。</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
