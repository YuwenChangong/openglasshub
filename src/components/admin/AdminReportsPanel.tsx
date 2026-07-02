import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { AdminApiError, adminFetch } from "../../lib/admin-api-client";
import GlassConfirmDialog from "../common/GlassConfirmDialog";
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
type ReportAdminAction =
  | "dismiss"
  | "reviewing"
  | "hide_target"
  | "reject_target"
  | "warn_user"
  | "suspend_user"
  | "ban_user";

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
type ConfirmState = {
  action: ReportAdminAction;
  reportId: string;
};
type ActionGroupKey = "low" | "content" | "safety";

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

const ACTION_GROUP_LABELS: Record<ActionGroupKey, { title: string; description: string }> = {
  low: {
    title: "低风险处理",
    description: "用于接手工单或在确认无问题后结束举报。",
  },
  content: {
    title: "内容处理",
    description: "直接改变目标内容的公开可见性，请谨慎确认。",
  },
  safety: {
    title: "用户安全动作",
    description: "会影响目标用户的发言或账号状态，属于高风险动作。",
  },
};

const ACTION_CONFIG: Record<
  ReportAdminAction,
  {
    label: string;
    shortLabel: string;
    description: string;
    confirmTitle: string;
    confirmDescription: string;
    confirmLabel: string;
    loadingLabel: string;
    danger?: boolean;
    group: ActionGroupKey;
    reversible: string;
  }
> = {
  reviewing: {
    label: "标记处理中",
    shortLabel: "处理中",
    description: "把举报标记为处理中并登记当前管理员。",
    confirmTitle: "确认接手这条举报",
    confirmDescription: "该操作会把举报状态改为“处理中”，便于团队知道已经有人在跟进。",
    confirmLabel: "确认标记处理中",
    loadingLabel: "正在更新状态...",
    group: "low",
    reversible: "可再改为驳回或已处理。",
  },
  dismiss: {
    label: "驳回举报",
    shortLabel: "驳回",
    description: "举报会被标记为已驳回，建议补充备注说明原因。",
    confirmTitle: "确认驳回这条举报",
    confirmDescription: "驳回后这条举报会从待处理流程中移出，但审计事件仍会保留。",
    confirmLabel: "确认驳回举报",
    loadingLabel: "正在驳回举报...",
    group: "low",
    reversible: "可通过后续治理记录补充说明，但举报状态会结束。",
  },
  hide_target: {
    label: "隐藏内容",
    shortLabel: "隐藏",
    description: "让目标内容或圈子从公开视图中隐藏。",
    confirmTitle: "确认隐藏目标内容",
    confirmDescription: "该操作会影响公开可见性，适合已经确认需要下线但仍保留记录的对象。",
    confirmLabel: "确认隐藏目标",
    loadingLabel: "正在隐藏目标...",
    danger: true,
    group: "content",
    reversible: "通常可通过后续管理操作恢复，但本次举报会记为已处理。",
  },
  reject_target: {
    label: "拒绝目标",
    shortLabel: "拒绝",
    description: "对帖子或评论执行更强的内容拒绝处理。",
    confirmTitle: "确认拒绝这条内容",
    confirmDescription: "拒绝会将该内容视为违规处理，比普通隐藏更强，建议备注具体原因。",
    confirmLabel: "确认拒绝内容",
    loadingLabel: "正在拒绝内容...",
    danger: true,
    group: "content",
    reversible: "通常不可由普通前台流程恢复，请谨慎操作。",
  },
  warn_user: {
    label: "警告用户",
    shortLabel: "警告",
    description: "给目标用户添加警告，不直接封禁账号。",
    confirmTitle: "确认警告目标用户",
    confirmDescription: "警告会进入用户安全记录，适合轻度但已确认的问题行为。",
    confirmLabel: "确认警告用户",
    loadingLabel: "正在警告用户...",
    group: "safety",
    reversible: "如后台支持，可通过用户安全面板清除警告。",
  },
  suspend_user: {
    label: "暂停用户",
    shortLabel: "暂停",
    description: "临时暂停目标用户发言，需要填写暂停到期时间。",
    confirmTitle: "确认暂停目标用户",
    confirmDescription: "暂停会直接限制发帖和互动，请确保到期时间与处理备注完整。",
    confirmLabel: "确认暂停用户",
    loadingLabel: "正在暂停用户...",
    danger: true,
    group: "safety",
    reversible: "到期后可自动结束，也可由管理员后续解除。",
  },
  ban_user: {
    label: "封禁用户",
    shortLabel: "封禁",
    description: "高风险动作，会直接改变目标用户账号状态。",
    confirmTitle: "确认封禁目标用户",
    confirmDescription: "封禁是最高风险动作之一，请确认目标、证据和备注都准确无误。",
    confirmLabel: "确认封禁用户",
    loadingLabel: "正在封禁用户...",
    danger: true,
    group: "safety",
    reversible: "只能由后续管理员治理动作解除，请谨慎操作。",
  },
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  open: "admin-pill admin-pill--status-open",
  reviewing: "admin-pill admin-pill--status-reviewing",
  actioned: "admin-pill admin-pill--status-actioned",
  dismissed: "admin-pill admin-pill--status-dismissed",
  published: "admin-pill admin-status-published",
  pending: "admin-pill admin-status-pending",
  hidden: "admin-pill admin-status-hidden",
  deleted: "admin-pill admin-status-deleted",
  rejected: "admin-pill admin-status-deleted",
  hidden_by_admin: "admin-pill admin-status-hidden",
  active: "admin-pill admin-pill--target-active",
};

const PRIORITY_CLASS: Record<ReportPriority, string> = {
  low: "admin-pill admin-pill--priority-low",
  normal: "admin-pill admin-pill--priority-normal",
  high: "admin-pill admin-pill--priority-high",
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function profileLabel(profile: ProfilePreview | null, fallback = "未知用户") {
  return profile?.display_name || profile?.username || fallback;
}

function shortId(id: string | null | undefined) {
  if (!id) return "-";
  return `${id.slice(0, 8)}...`;
}

function targetLabel(report: Pick<AdminReportQueueItem, "target_type">) {
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
    case "rejected":
      return "已拒绝";
    case "hidden_by_admin":
      return "管理员隐藏";
    case "active":
      return "正常";
    default:
      return status ?? "未知";
  }
}

function priorityLabel(priority: ReportPriority) {
  switch (priority) {
    case "low":
      return "低";
    case "high":
      return "高";
    default:
      return "普通";
  }
}

function reasonLabel(reasonCode: ReportReasonCode) {
  return REASON_OPTIONS.find((option) => option.value === reasonCode)?.label ?? reasonCode;
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

function isRejectSupported(report: AdminReportQueueItem | null) {
  return report?.target_type === "post" || report?.target_type === "comment";
}

function hasTargetUser(report: AdminReportQueueItem | null) {
  return Boolean(report && (report.target_type === "user" ? report.target_id : report.target?.author_id));
}

function getActionTargetUserId(report: AdminReportQueueItem | null) {
  if (!report) return null;
  return report.target_type === "user" ? report.target_id : report.target?.author_id ?? null;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getLatestActivity(report: AdminReportQueueItem) {
  return report.updated_at || report.resolved_at || report.created_at;
}

function getTargetStateBadges(report: AdminReportQueueItem) {
  const statuses: Array<{ label: string; className: string }> = [];
  if (report.target?.status) {
    statuses.push({
      label: statusLabel(report.target.status),
      className: STATUS_BADGE_CLASS[report.target.status] ?? "admin-pill",
    });
  }
  if (report.target?.moderation_status) {
    statuses.push({
      label: statusLabel(report.target.moderation_status),
      className: STATUS_BADGE_CLASS[report.target.moderation_status] ?? "admin-pill",
    });
  }
  if (!report.target) {
    statuses.push({
      label: "目标不可用",
      className: "admin-pill admin-pill--missing",
    });
  }
  return statuses;
}

function getActionErrorMessage(error: unknown) {
  if (!(error instanceof AdminApiError)) {
    return error instanceof Error ? error.message : "操作失败，请稍后再试。";
  }

  switch (error.message) {
    case "REPORT_TARGET_NOT_FOUND":
      return "目标内容已不可用，无法继续执行该操作。";
    case "REPORT_TARGET_USER_UNAVAILABLE":
      return "无法定位关联用户，暂时不能执行用户安全动作。";
    case "USER_SAFETY_SELF_ACTION_FORBIDDEN":
      return "不能对自己的账号执行用户安全动作。";
    case "REASON_REQUIRED":
      return "请先填写处理备注，再执行暂停或封禁。";
    case "INVALID_SUSPEND_UNTIL":
      return "暂停到期时间格式无效，请重新选择。";
    case "SUSPEND_UNTIL_REQUIRED":
      return "暂停用户前需要填写到期时间。";
    case "SUSPEND_UNTIL_MUST_BE_FUTURE":
      return "暂停到期时间必须晚于当前时间。";
    case "USER_ALREADY_SUSPENDED":
      return "该用户已经处于暂停状态。";
    case "USER_ALREADY_BANNED":
      return "该用户已经被封禁。";
    case "USER_SAFETY_ACTION_CONFLICT":
      return "当前用户状态与该动作冲突，请先查看用户安全状态。";
    case "REPORT_REJECT_UNSUPPORTED_FOR_CIRCLE":
      return "圈子举报暂不支持“拒绝内容”，可改用隐藏目标。";
    case "REPORT_HIDE_UNSUPPORTED_FOR_USER":
      return "用户举报不支持隐藏目标，请改用用户安全动作。";
    case "REPORT_NOT_FOUND":
      return "这条举报已不存在或暂时不可用。";
    default:
      return error.message || "操作失败，请稍后再试。";
  }
}

function getReportSearchText(report: AdminReportQueueItem) {
  return [
    report.id,
    report.target_id,
    report.reason,
    report.reason_text ?? "",
    targetLabel(report),
    reasonLabel(report.reason_code),
    profileLabel(report.reporter_profile, ""),
    profileLabel(report.target?.author_profile ?? null, ""),
    report.target?.title ?? "",
    report.target?.excerpt ?? "",
    report.target?.circle?.name ?? "",
    report.target?.post?.title ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function summarizeEvent(event: ReportEventRecord) {
  const action = typeof event.metadata.action === "string" ? event.metadata.action : null;

  switch (event.event_type) {
    case "created":
      return {
        title: "举报已创建",
        lines: [
          `原因分类：${typeof event.metadata.reason_code === "string" ? reasonLabel(event.metadata.reason_code as ReportReasonCode) : "未记录"}`,
        ],
      };
    case "reviewing":
      return {
        title: "标记为处理中",
        lines: typeof event.metadata.note === "string" && event.metadata.note.trim()
          ? [`备注：${event.metadata.note}`]
          : ["管理员已接手处理。"],
      };
    case "dismissed":
      return {
        title: "举报已驳回",
        lines: typeof event.metadata.note === "string" && event.metadata.note.trim()
          ? [`备注：${event.metadata.note}`]
          : ["未记录额外说明。"],
      };
    case "hide_target":
      return {
        title: "目标已隐藏",
        lines: [
          `处理对象：${targetLabel({ target_type: typeof event.metadata.target_type === "string" ? (event.metadata.target_type as ReportTargetType) : "post" })}`,
          typeof event.metadata.note === "string" && event.metadata.note.trim() ? `备注：${event.metadata.note}` : "目标已从公开视图中隐藏。",
        ],
      };
    case "warn_user":
      return {
        title: "已警告目标用户",
        lines: typeof event.metadata.note === "string" && event.metadata.note.trim()
          ? [`备注：${event.metadata.note}`]
          : ["用户安全系统已记录警告。"],
      };
    case "suspend_user":
      return {
        title: "已暂停目标用户",
        lines: typeof event.metadata.note === "string" && event.metadata.note.trim()
          ? [`备注：${event.metadata.note}`]
          : ["用户已被临时暂停。"],
      };
    case "ban_user":
      return {
        title: "已封禁目标用户",
        lines: typeof event.metadata.note === "string" && event.metadata.note.trim()
          ? [`备注：${event.metadata.note}`]
          : ["用户已被封禁。"],
      };
    case "actioned":
      return {
        title: action === "reject_target" ? "目标已拒绝" : "举报已处理",
        lines: typeof event.metadata.note === "string" && event.metadata.note.trim()
          ? [`备注：${event.metadata.note}`]
          : [action === "reject_target" ? "目标内容已按违规处理。" : "管理员已完成处理。"],
      };
    default: {
      const lines: string[] = [];
      for (const [key, value] of Object.entries(event.metadata ?? {})) {
        if (value == null || value === "") continue;
        if (typeof value === "object") continue;
        lines.push(`${key}: ${String(value)}`);
      }
      return {
        title: event.event_type,
        lines: lines.length > 0 ? lines.slice(0, 3) : ["无额外摘要。"],
      };
    }
  }
}

function buildActionDetail(report: AdminReportQueueItem, action: ReportAdminAction, note: string, until: string) {
  const config = ACTION_CONFIG[action];
  const targetUserId = getActionTargetUserId(report);
  const lines = [
    `举报对象：${targetLabel(report)} · ${report.target?.title || shortId(report.target_id)}`,
    `举报编号：${shortId(report.id)}`,
    `当前状态：${statusLabel(report.status)}`,
    `动作影响：${config.description}`,
    `可逆性：${config.reversible}`,
  ];

  if (targetUserId && config.group === "safety") {
    lines.push(`目标用户：${profileLabel(report.target?.author_profile ?? report.reporter_profile, "社区用户")} · ${shortId(targetUserId)}`);
  }
  if (note.trim()) {
    lines.push(`处理备注：${note.trim()}`);
  }
  if (action === "suspend_user" && until.trim()) {
    lines.push(`暂停到期：${until.trim()}`);
  }

  return lines.join("\n");
}

function buildActionSuccessMessage(action: ReportAdminAction) {
  switch (action) {
    case "reviewing":
      return "举报已标记为处理中。";
    case "dismiss":
      return "举报已驳回。";
    case "hide_target":
      return "目标已隐藏，举报已更新。";
    case "reject_target":
      return "目标已拒绝，举报已更新。";
    case "warn_user":
      return "用户警告已记录。";
    case "suspend_user":
      return "用户已暂停。";
    case "ban_user":
      return "用户已封禁。";
    default:
      return "操作已更新。";
  }
}

function getFilteredEmptyMessage(searchQuery: string, filters: Record<string, FilterValue>) {
  if (searchQuery.trim()) {
    return "当前搜索没有匹配结果，请尝试缩短关键词或清空筛选。";
  }
  if (Object.values(filters).some((value) => value !== "all")) {
    return "当前筛选条件下没有匹配的举报。";
  }
  return "当前没有可处理的举报记录。";
}

export default function AdminReportsPanel() {
  const adminSession = useAdminSession();
  const [dataState, setDataState] = useState<DataState>("idle");
  const [error, setError] = useState("");
  const [reports, setReports] = useState<AdminReportQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailMissing, setDetailMissing] = useState(false);
  const [detail, setDetail] = useState<ReportDetailPayload | null>(null);
  const [note, setNote] = useState("");
  const [until, setUntil] = useState("");
  const [rowMessage, setRowMessage] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [actionLoading, setActionLoading] = useState<ReportAdminAction | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
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

  const filteredReports = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase();
    if (!query) return reports;
    return reports.filter((report) => getReportSearchText(report).includes(query));
  }, [deferredSearchQuery, reports]);

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onClear: () => void }> = [];
    if (filters.status !== "all") {
      chips.push({
        key: "status",
        label: `状态：${STATUS_OPTIONS.find((option) => option.value === filters.status)?.label ?? filters.status}`,
        onClear: () => setFilters((current) => ({ ...current, status: "all" })),
      });
    }
    if (filters.target_type !== "all") {
      chips.push({
        key: "target_type",
        label: `对象：${TARGET_OPTIONS.find((option) => option.value === filters.target_type)?.label ?? filters.target_type}`,
        onClear: () => setFilters((current) => ({ ...current, target_type: "all" })),
      });
    }
    if (filters.reason_code !== "all") {
      chips.push({
        key: "reason_code",
        label: `原因：${REASON_OPTIONS.find((option) => option.value === filters.reason_code)?.label ?? filters.reason_code}`,
        onClear: () => setFilters((current) => ({ ...current, reason_code: "all" })),
      });
    }
    if (filters.priority !== "all") {
      chips.push({
        key: "priority",
        label: `优先级：${PRIORITY_OPTIONS.find((option) => option.value === filters.priority)?.label ?? filters.priority}`,
        onClear: () => setFilters((current) => ({ ...current, priority: "all" })),
      });
    }
    if (searchQuery.trim()) {
      chips.push({
        key: "search",
        label: `搜索：${searchQuery.trim()}`,
        onClear: () => setSearchQuery(""),
      });
    }
    return chips;
  }, [filters, searchQuery]);

  const queueSummary = useMemo(() => {
    return {
      total: filteredReports.length,
      open: filteredReports.filter((report) => report.status === "open").length,
      reviewing: filteredReports.filter((report) => report.status === "reviewing").length,
      highPriority: filteredReports.filter((report) => report.priority === "high").length,
    };
  }, [filteredReports]);

  useEffect(() => {
    if (adminSession.state.status !== "ready" || !adminSession.session) return;
    let cancelled = false;

    async function loadReports() {
      const showFullLoadingState = reports.length === 0 && dataState !== "ready";
      if (showFullLoadingState) {
        setDataState("loading");
      } else {
        setIsRefreshing(true);
      }
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
        setDataState(showFullLoadingState ? "error" : "ready");
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    }

    void loadReports();
    return () => {
      cancelled = true;
    };
  }, [adminSession, queryString, refreshNonce]);

  useEffect(() => {
    if (!selectedId || adminSession.state.status !== "ready" || !adminSession.session) {
      setDetail(null);
      setDetailMissing(false);
      return;
    }
    let cancelled = false;

    async function loadDetail() {
      setDetailLoading(true);
      setDetailMissing(false);
      try {
        const payload = await adminFetch<ReportDetailPayload>(`/api/admin/reports/${selectedId}`, {
          method: "GET",
          session: adminSession.session,
        });
        if (!cancelled) {
          setDetail(payload);
          setError("");
        }
      } catch (requestError) {
        if (!cancelled) {
          if (requestError instanceof AdminApiError && requestError.status === 404) {
            setDetail(null);
            setDetailMissing(true);
            setError("");
            return;
          }
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

  useEffect(() => {
    if (filteredReports.length === 0) return;
    if (selectedId && filteredReports.some((report) => report.id === selectedId)) return;
    setSelectedId(filteredReports[0]?.id ?? null);
  }, [filteredReports, selectedId]);

  function clearFilters() {
    setFilters({
      status: "all",
      target_type: "all",
      reason_code: "all",
      priority: "all",
    });
    setSearchQuery("");
  }

  async function runAction(action: ReportAdminAction) {
    if (!selectedReport || !adminSession.session) return;
    setActionLoading(action);
    setError("");
    setDialogError("");
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

      if (payload.report) {
        setReports((current) =>
          current.map((report) => (report.id === payload.report?.id ? payload.report : report)),
        );
      }
      if (payload.report && payload.events) {
        setDetail({ report: payload.report, events: payload.events });
      }

      setRowMessage(buildActionSuccessMessage(action));
      setDialogError("");
      setConfirmState(null);
      if (action !== "reviewing") {
        setNote("");
        setUntil("");
      }
      setRefreshNonce((current) => current + 1);
    } catch (requestError) {
      const nextError = getActionErrorMessage(requestError);
      if (confirmState?.action === action) {
        setDialogError(nextError);
      } else {
        setError(nextError);
      }
    } finally {
      setActionLoading(null);
    }
  }

  function requestAction(action: ReportAdminAction) {
    if (!selectedReport) return;
    setError("");
    setDialogError("");
    setRowMessage("");
    setConfirmState({ action, reportId: selectedReport.id });
  }

  const confirmReport =
    confirmState?.reportId === selectedReport?.id
      ? selectedReport
      : reports.find((report) => report.id === confirmState?.reportId) ?? null;
  const confirmConfig = confirmState ? ACTION_CONFIG[confirmState.action] : null;

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
          <p>更快扫描举报状态、目标对象和处理历史，同时继续保护 reporter 隐私与后台安全边界。</p>
        </div>
      </div>

      <div className="admin-user-line">
        当前管理员：{adminSession.me?.profile?.display_name || adminSession.me?.profile?.username || shortId(adminSession.me?.user_id)} · 角色 {adminSession.me?.role}
      </div>

      <div className="admin-reports-overview">
        <div className="admin-reports-overview__card">
          <span>当前结果</span>
          <strong>{queueSummary.total}</strong>
          <p>筛选和搜索后的举报数量</p>
        </div>
        <div className="admin-reports-overview__card">
          <span>待处理</span>
          <strong>{queueSummary.open}</strong>
          <p>仍需人工开始处理</p>
        </div>
        <div className="admin-reports-overview__card">
          <span>处理中</span>
          <strong>{queueSummary.reviewing}</strong>
          <p>已经有管理员接手</p>
        </div>
        <div className="admin-reports-overview__card">
          <span>高优先级</span>
          <strong>{queueSummary.highPriority}</strong>
          <p>建议优先查看的工单</p>
        </div>
      </div>

      <div className="admin-reports-toolbar">
        <label className="admin-search-field">
          <span className="community-meta">本地搜索</span>
          <input
            type="search"
            className="community-field"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索举报标题、摘要、原因、对象 ID"
          />
        </label>

        <div className="admin-reports-filters" role="group" aria-label="举报筛选">
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
          <button type="button" className="admin-action-button admin-action-button--quiet" onClick={clearFilters}>
            清空筛选
          </button>
        </div>
      </div>

      {activeFilterChips.length > 0 ? (
        <div className="admin-filter-chips" aria-label="当前筛选条件">
          {activeFilterChips.map((chip) => (
            <button key={chip.key} type="button" className="admin-filter-chip" onClick={chip.onClear}>
              {chip.label} · 清除
            </button>
          ))}
        </div>
      ) : null}

      {error ? <div className="admin-error">{error}</div> : null}
      {rowMessage ? <div className="admin-inline-success">{rowMessage}</div> : null}
      {isRefreshing && reports.length > 0 ? <p className="community-meta admin-state-message">正在刷新当前队列...</p> : null}

      {dataState === "loading" && reports.length === 0 ? (
        <div className="admin-reports-loading">
          <p className="community-meta admin-state-message">正在加载举报队列...</p>
          <div className="admin-reports-loading__grid">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="admin-report-skeleton" aria-hidden="true" />
            ))}
          </div>
        </div>
      ) : null}

      {dataState === "ready" && filteredReports.length === 0 ? (
        <div className="community-empty">
          <strong>{reports.length === 0 ? "暂无举报" : "没有匹配结果"}</strong>
          <p>{getFilteredEmptyMessage(searchQuery, filters)}</p>
        </div>
      ) : null}

      {filteredReports.length > 0 ? (
        <div className="admin-reports-layout">
          <div className="admin-reports-list" aria-label="举报列表">
            {filteredReports.map((report) => {
              const active = report.id === selectedId;
              const duplicateCount = Math.max(report.open_count_for_target - 1, 0);
              return (
                <button
                  key={report.id}
                  type="button"
                  className={cx(
                    "community-list-item admin-report-card admin-report-card--selectable",
                    active && "is-active",
                  )}
                  onClick={() => {
                    setSelectedId(report.id);
                    setError("");
                    setRowMessage("");
                  }}
                  aria-pressed={active}
                >
                  <div className="admin-action-row admin-action-row--spread">
                    <strong>{report.target?.title || `${targetLabel(report)} ${shortId(report.target_id)}`}</strong>
                    <div className="admin-report-card__badges">
                      <span className={STATUS_BADGE_CLASS[report.status] ?? "admin-pill"}>{statusLabel(report.status)}</span>
                      <span className={PRIORITY_CLASS[report.priority]}>{priorityLabel(report.priority)}</span>
                    </div>
                  </div>

                  <div className="admin-report-card__meta">
                    <span className="admin-pill admin-pill--target">{targetLabel(report)}</span>
                    <span className="admin-pill admin-pill--reason">{reasonLabel(report.reason_code)}</span>
                    {getTargetStateBadges(report).map((badge, index) => (
                      <span key={`${badge.label}-${index}`} className={badge.className}>{badge.label}</span>
                    ))}
                  </div>

                  <div className="admin-report-target">
                    <span>
                      举报人：{profileLabel(report.reporter_profile, "匿名举报者")} · 创建于 {formatDateTime(report.created_at)}
                    </span>
                    <p className="admin-post-excerpt">{report.target?.excerpt || report.reason_text || report.reason}</p>
                  </div>

                  <div className="admin-report-card__footer">
                    <span>目标作者：{profileLabel(report.target?.author_profile ?? null, "未记录")}</span>
                    <span>最后活动：{formatDateTime(getLatestActivity(report))}</span>
                    <span>{duplicateCount > 0 ? `同目标待处理 ${report.open_count_for_target} 条` : "当前为该目标唯一待处理举报"}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="admin-reports-detail community-list-item">
            {detailLoading ? (
              <p className="community-meta">正在加载举报详情...</p>
            ) : !selectedReport && detailMissing ? (
              <div className="community-empty admin-report-empty-detail">
                <strong>举报已不可用</strong>
                <p>这条举报可能已被删除或暂时无法读取，请返回列表选择其他记录。</p>
              </div>
            ) : !selectedReport ? (
              <p className="community-meta">选择一条举报查看详情。</p>
            ) : (
              <>
                <div className="admin-action-row admin-action-row--spread">
                  <div>
                    <strong>{selectedReport.target?.title || `${targetLabel(selectedReport)} ${shortId(selectedReport.target_id)}`}</strong>
                    <p className="community-meta admin-detail-subtitle">
                      {targetLabel(selectedReport)} · 举报状态 {statusLabel(selectedReport.status)} · 待处理同目标举报 {selectedReport.open_count_for_target}
                    </p>
                  </div>
                  <div className="admin-inline-actions">
                    {targetLink(selectedReport) ? (
                      <a href={targetLink(selectedReport) ?? "#"} className="admin-action-button">
                        查看目标
                      </a>
                    ) : (
                      <span className="admin-action-button" aria-disabled="true">目标不可访问</span>
                    )}
                  </div>
                </div>

                <div className="admin-detail-panels">
                  <section className="admin-detail-panel">
                    <h3>举报信息</h3>
                    <div className="admin-meta-grid">
                      <span>举报编号：<code>{shortId(selectedReport.id)}</code></span>
                      <span>举报人：{profileLabel(selectedReport.reporter_profile)} <code>{shortId(selectedReport.reporter_id)}</code></span>
                      <span>原因分类：{reasonLabel(selectedReport.reason_code)}</span>
                      <span>优先级：{priorityLabel(selectedReport.priority)}</span>
                      <span>创建时间：{formatDateTime(selectedReport.created_at)}</span>
                      <span>最后活动：{formatDateTime(getLatestActivity(selectedReport))}</span>
                    </div>
                  </section>

                  <section className="admin-detail-panel">
                    <h3>目标概览</h3>
                    <div className="admin-meta-grid">
                      <span>对象类型：{targetLabel(selectedReport)}</span>
                      <span>目标 ID：<code>{shortId(selectedReport.target_id)}</code></span>
                      <span>内容作者：{profileLabel(selectedReport.target?.author_profile ?? null)} <code>{shortId(selectedReport.target?.author_id ?? null)}</code></span>
                      <span>当前可见状态：{getTargetStateBadges(selectedReport).map((badge) => badge.label).join(" / ") || "未记录"}</span>
                      <span>指派管理员：<code>{shortId(selectedReport.assigned_to)}</code></span>
                      <span>解决人：<code>{shortId(selectedReport.resolved_by)}</code></span>
                    </div>
                    <div className="admin-report-target">
                      <span>目标摘要</span>
                      <p className="admin-post-excerpt">{selectedReport.target?.excerpt || "没有可显示的目标摘要。"}</p>
                    </div>
                  </section>

                  <section className="admin-detail-panel">
                    <h3>举报说明</h3>
                    <div className="admin-report-target">
                      <span>举报理由</span>
                      <p className="admin-post-excerpt">{selectedReport.reason_text || selectedReport.reason}</p>
                      <span>处理备注</span>
                      <p className="admin-post-excerpt">{selectedReport.resolution_note || "暂未记录处理备注。"}</p>
                      <span>处理完成时间</span>
                      <p className="admin-post-excerpt">{selectedReport.resolved_at ? formatDateTime(selectedReport.resolved_at) : "尚未结案"}</p>
                    </div>
                  </section>
                </div>

                <section className="admin-detail-panel">
                  <h3>处理输入</h3>
                  <p className="community-meta">高风险动作建议填写处理备注。暂停用户时必须提供到期时间。</p>
                  <label className="admin-note-field">
                    <span className="community-meta">处理备注</span>
                    <textarea
                      className="glass-textarea"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="记录处理原因、证据摘要或用户安全说明"
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
                </section>

                <section className="admin-detail-panel">
                  <h3>处理动作</h3>
                  <div className="admin-action-groups">
                    <div className="admin-action-group">
                      <div>
                        <strong>{ACTION_GROUP_LABELS.low.title}</strong>
                        <p className="community-meta">{ACTION_GROUP_LABELS.low.description}</p>
                      </div>
                      <div className="admin-inline-actions">
                        {(["reviewing", "dismiss"] as ReportAdminAction[]).map((action) => (
                          <button
                            key={action}
                            type="button"
                            className="admin-action-button"
                            disabled={actionLoading !== null}
                            onClick={() => requestAction(action)}
                          >
                            {actionLoading === action ? ACTION_CONFIG[action].loadingLabel : ACTION_CONFIG[action].label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {(isHideSupported(selectedReport) || isRejectSupported(selectedReport)) ? (
                      <div className="admin-action-group">
                        <div>
                          <strong>{ACTION_GROUP_LABELS.content.title}</strong>
                          <p className="community-meta">{ACTION_GROUP_LABELS.content.description}</p>
                        </div>
                        <div className="admin-inline-actions">
                          {isHideSupported(selectedReport) ? (
                            <button
                              type="button"
                              className="admin-action-button"
                              disabled={actionLoading !== null}
                              onClick={() => requestAction("hide_target")}
                            >
                              {actionLoading === "hide_target" ? ACTION_CONFIG.hide_target.loadingLabel : ACTION_CONFIG.hide_target.label}
                            </button>
                          ) : null}
                          {isRejectSupported(selectedReport) ? (
                            <button
                              type="button"
                              className="admin-action-button"
                              disabled={actionLoading !== null}
                              onClick={() => requestAction("reject_target")}
                            >
                              {actionLoading === "reject_target" ? ACTION_CONFIG.reject_target.loadingLabel : ACTION_CONFIG.reject_target.label}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {hasTargetUser(selectedReport) ? (
                      <div className="admin-action-group admin-action-group--danger">
                        <div>
                          <strong>{ACTION_GROUP_LABELS.safety.title}</strong>
                          <p className="community-meta">{ACTION_GROUP_LABELS.safety.description}</p>
                        </div>
                        <div className="admin-inline-actions">
                          {(["warn_user", "suspend_user", "ban_user"] as ReportAdminAction[]).map((action) => (
                            <button
                              key={action}
                              type="button"
                              className={cx(
                                "admin-action-button",
                                ACTION_CONFIG[action].danger && "admin-action-danger",
                              )}
                              disabled={actionLoading !== null}
                              onClick={() => requestAction(action)}
                            >
                              {actionLoading === action ? ACTION_CONFIG[action].loadingLabel : ACTION_CONFIG[action].label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>

                <div className="admin-report-events">
                  <h3>处理时间线</h3>
                  {detail?.events?.length ? (
                    detail.events.map((event) => {
                      const summary = summarizeEvent(event);
                      return (
                        <div key={event.id} className="admin-report-event">
                          <div className="admin-action-row admin-action-row--spread">
                            <strong>{summary.title}</strong>
                            <span className="community-meta">{formatDateTime(event.created_at)}</span>
                          </div>
                          <p className="community-meta">
                            操作人：{profileLabel(event.actor_profile)} {event.actor_id ? <code>{shortId(event.actor_id)}</code> : null}
                          </p>
                          <ul className="admin-event-lines">
                            {summary.lines.map((line, index) => <li key={`${event.id}-${index}`}>{line}</li>)}
                          </ul>
                        </div>
                      );
                    })
                  ) : (
                    <p className="community-meta">暂无处理记录。</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      <GlassConfirmDialog
        open={!!confirmState && !!confirmReport && !!confirmConfig}
        title={confirmConfig?.confirmTitle ?? "确认操作"}
        description={confirmConfig?.confirmDescription ?? "请确认后继续。"}
        detail={confirmReport && confirmState ? buildActionDetail(confirmReport, confirmState.action, note, until) : ""}
        confirmLabel={confirmConfig?.confirmLabel ?? "确认"}
        cancelLabel="取消"
        danger={confirmConfig?.danger ?? false}
        loading={!!confirmState && actionLoading === confirmState.action}
        loadingLabel={confirmConfig?.loadingLabel ?? "处理中..."}
        error={dialogError}
        onCancel={() => {
          if (actionLoading) return;
          setConfirmState(null);
          setDialogError("");
        }}
        onConfirm={() => {
          if (!confirmState) return;
          void runAction(confirmState.action);
        }}
      />
    </section>
  );
}
