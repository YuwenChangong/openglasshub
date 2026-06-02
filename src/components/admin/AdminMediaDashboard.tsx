import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AdminApiError, adminFetch, type AdminAuthState } from "../../lib/admin-api-client";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

type AdminMedia = {
  id: string;
  post_id: string | null;
  user_id: string | null;
  kind: string;
  size_bytes: number | null;
  mime_type: string | null;
  storage_path: string | null;
  url: string | null;
  created_at: string;
  is_bound_to_post: boolean;
  post_status: string | null;
};

type Filter = "all" | "video" | "large" | "unbound" | "recent";

type MediaPayload = {
  media?: AdminMedia[];
  error?: string;
  details?: unknown;
};

type MediaDeletePayload = {
  ok?: boolean;
  id?: string;
  warnings?: unknown;
  error?: string;
  details?: unknown;
};

function bytesLabel(bytes: number | null): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let current = value;
  let idx = 0;
  while (current >= 1024 && idx < units.length - 1) {
    current /= 1024;
    idx += 1;
  }
  return `${current.toFixed(current >= 10 ? 0 : 1)} ${units[idx]}`;
}

export default function AdminMediaDashboard() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [authState, setAuthState] = useState<AdminAuthState>("checking");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<AdminMedia[]>([]);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [rowSuccess, setRowSuccess] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState("");

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

  async function loadMedia(currentSession: Session, currentFilter: Filter) {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "120" });
      if (currentFilter === "video") query.set("kind", "video");
      if (currentFilter === "large") query.set("large", "1");
      if (currentFilter === "unbound") query.set("unbound", "1");
      if (currentFilter === "recent") query.set("recent", "24h");

      const payload = await adminFetch<MediaPayload>(`/api/admin/forum/media?${query.toString()}`, {
        method: "GET",
        session: currentSession,
      });
      setItems(payload.media ?? []);
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
    void loadMedia(session, filter);
  }, [authState, session, filter]);

  async function removeMedia(id: string) {
    if (!session) return;
    setActionLoadingId(id);
    setError("");
    setSuccessMessage("");
    setRowSuccess((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setRowError((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

    try {
      const payload = await adminFetch<MediaDeletePayload>(`/api/admin/forum/media?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        session,
      });

      setItems((current) => current.filter((item) => item.id !== id));
      setSuccessMessage("媒体已删除并完成存储清理");
      setRowSuccess((current) => ({
        ...current,
        [id]: payload.warnings ? `已删除，带警告：${JSON.stringify(payload.warnings)}` : "已删除媒体",
      }));
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "删除失败";
      setRowError((current) => ({ ...current, [id]: message }));
      if (requestError instanceof AdminApiError) {
        if (requestError.status === 401) {
          setAuthState("signed_out");
        } else if (requestError.status === 403) {
          setAuthState("forbidden");
        }
      }
    } finally {
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
          <h2>媒体审计</h2>
          <p>筛选视频、大文件、未绑定媒体，并执行单条删除。</p>
        </div>
        <div className="community-cta-row">
          {[
            ["all", "全部"],
            ["video", "视频"],
            ["large", "大文件"],
            ["unbound", "未绑定"],
            ["recent", "最近 24h"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "community-button" : "community-button--secondary"}
              onClick={() => setFilter(value as Filter)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && authState === "ready" ? <div className="admin-error">{error}</div> : null}
      {successMessage ? <div className="admin-inline-success">{successMessage}</div> : null}
      {loading ? <p className="community-meta admin-state-message">正在加载媒体列表...</p> : null}

      {!loading && items.length === 0 ? (
        <div className="community-empty">
          <strong>暂无媒体</strong>
          <p>当前筛选条件下没有媒体记录。</p>
        </div>
      ) : (
        <div className="community-list" style={{ marginTop: "0.8rem" }}>
          {items.map((item) => (
            <article key={item.id} className="community-list-item" style={{ gap: "0.6rem" }}>
              <div className="admin-action-row">
                <strong>
                  {item.kind.toUpperCase()} · {bytesLabel(item.size_bytes)}
                </strong>
                {!item.is_bound_to_post ? (
                  <span className="admin-status-badge admin-status-hidden">未绑定</span>
                ) : null}
              </div>
              <span>mime: {item.mime_type ?? "-"}</span>
              <span>post: {item.post_id ?? "(unbound)"} · status: {item.post_status ?? "-"}</span>
              <span>user: {item.user_id ?? "-"}</span>
              <span>path: {item.storage_path ?? "-"}</span>
              {item.url ? <span>url: {item.url}</span> : null}
              <span>{new Date(item.created_at).toLocaleString("zh-CN")}</span>

              {rowSuccess[item.id] ? <div className="admin-inline-success">{rowSuccess[item.id]}</div> : null}
              {rowError[item.id] ? <div className="admin-error">{rowError[item.id]}</div> : null}

              <div className="admin-action-row">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className="admin-action-button">
                    打开媒体
                  </a>
                ) : null}
                <button
                  type="button"
                  className="admin-action-button admin-action-danger"
                  onClick={() => removeMedia(item.id)}
                  disabled={actionLoadingId === item.id}
                >
                  {actionLoadingId === item.id ? "处理中..." : "删除媒体"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
