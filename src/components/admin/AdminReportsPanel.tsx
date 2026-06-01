import { useEffect, useMemo, useState } from "react";
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

export default function AdminReportsPanel() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reports, setReports] = useState<AdminReport[]>([]);

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

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/admin/forum/reports?limit=120", {
          headers: { authorization: `Bearer ${token}` },
        });
        const payload = (await response.json().catch(() => null)) as
          | { error?: string; reports?: AdminReport[] }
          | null;
        if (!response.ok) throw new Error(payload?.error ?? `加载失败 (${response.status})`);
        setReports(payload?.reports ?? []);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "加载失败");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [token]);

  if (!token) {
    return <div className="community-empty"><strong>请先登录</strong><p>管理员页面需要登录后访问。</p></div>;
  }

  return (
    <section className="community-surface">
      <div className="community-stream-head">
        <div>
          <h2>举报列表</h2>
          <p>查看帖子举报内容，并跳转到帖子执行隐藏/删除处理。</p>
        </div>
      </div>

      {error ? <div className="inline-error">{error}</div> : null}
      {loading ? <p className="community-meta">加载中...</p> : null}

      {!loading && reports.length === 0 ? (
        <div className="community-empty">
          <strong>暂无举报</strong>
          <p>当前没有可处理的举报记录。</p>
        </div>
      ) : (
        <div className="community-list" style={{ marginTop: "0.8rem" }}>
          {reports.map((report) => (
            <article key={report.id} className="community-list-item" style={{ gap: "0.6rem" }}>
              <strong>{report.post_title ?? "(帖子已删除)"}</strong>
              <span>post: {report.post_id} · status: {report.post_status ?? "-"}</span>
              <span>reporter: {report.reporter_id}</span>
              <span>{report.reason}</span>
              <span>{new Date(report.created_at).toLocaleString("zh-CN")}</span>
              <div className="community-cta-row">
                <a href={`/posts/${report.post_id}/`} className="community-button--secondary">查看帖子</a>
                <a href="/admin/forum/" className="community-button">去处理</a>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
