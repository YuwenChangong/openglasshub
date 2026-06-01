import { useEffect, useMemo, useState } from "react";
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
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<AdminMedia[]>([]);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setToken(data.session?.access_token ?? null);
    };
    void init();
    const { data: listener } = supabase.auth.onAuthStateChange(async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setToken(data.session?.access_token ?? null);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  async function loadMedia(currentToken: string, currentFilter: Filter) {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "120" });
      if (currentFilter === "video") query.set("kind", "video");
      if (currentFilter === "large") query.set("large", "1");
      if (currentFilter === "unbound") query.set("unbound", "1");
      if (currentFilter === "recent") query.set("recent", "24h");

      const response = await fetch(`/api/admin/forum/media?${query.toString()}`, {
        headers: { authorization: `Bearer ${currentToken}` },
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; media?: AdminMedia[] }
        | null;
      if (!response.ok) throw new Error(payload?.error ?? `加载失败 (${response.status})`);
      setItems(payload?.media ?? []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    void loadMedia(token, filter);
  }, [token, filter]);

  async function removeMedia(id: string) {
    if (!token) return;
    setActionLoadingId(id);
    setError("");
    try {
      const response = await fetch(`/api/admin/forum/media?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; details?: unknown }
        | null;
      if (!response.ok) {
        throw new Error(
          `${payload?.error ?? `删除失败 (${response.status})`}${payload?.details ? ` ${JSON.stringify(payload.details)}` : ""}`,
        );
      }
      await loadMedia(token, filter);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除失败");
    } finally {
      setActionLoadingId(null);
    }
  }

  if (!token) {
    return <div className="community-empty"><strong>请先登录</strong><p>管理员页面需要登录后访问。</p></div>;
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
            ["recent", "24h"],
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

      {error ? <div className="inline-error">{error}</div> : null}
      {loading ? <p className="community-meta">加载中...</p> : null}

      {!loading && items.length === 0 ? (
        <div className="community-empty">
          <strong>暂无媒体</strong>
          <p>当前筛选条件下没有媒体记录。</p>
        </div>
      ) : (
        <div className="community-list" style={{ marginTop: "0.8rem" }}>
          {items.map((item) => (
            <article key={item.id} className="community-list-item" style={{ gap: "0.6rem" }}>
              <strong>{item.kind.toUpperCase()} · {bytesLabel(item.size_bytes)}</strong>
              <span>mime: {item.mime_type ?? "-"}</span>
              <span>post: {item.post_id ?? "(unbound)"} · status: {item.post_status ?? "-"}</span>
              <span>user: {item.user_id ?? "-"}</span>
              <span>path: {item.storage_path ?? "-"}</span>
              {item.url ? <span>url: {item.url}</span> : null}
              <span>{new Date(item.created_at).toLocaleString("zh-CN")}</span>
              <div className="community-cta-row">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className="community-button--secondary">打开媒体</a>
                ) : null}
                <button
                  type="button"
                  className="community-button"
                  onClick={() => removeMedia(item.id)}
                  disabled={actionLoadingId === item.id}
                >
                  删除媒体
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
