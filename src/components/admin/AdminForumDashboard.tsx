import { useEffect, useMemo, useState } from "react";
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

export default function AdminForumDashboard() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [posts, setPosts] = useState<AdminPost[]>([]);
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

  async function loadPosts(currentToken: string, currentStatus: string) {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ status: currentStatus, limit: "80" });
      const response = await fetch(`/api/admin/forum/posts?${query.toString()}`, {
        headers: { authorization: `Bearer ${currentToken}` },
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; posts?: AdminPost[] }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? `加载失败 (${response.status})`);
      }
      setPosts(payload?.posts ?? []);
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
    void loadPosts(token, statusFilter);
  }, [token, statusFilter]);

  async function mutatePost(postId: string, action: "hide" | "restore" | "delete") {
    if (!token) return;
    setActionLoadingId(postId);
    setError("");
    try {
      const response =
        action === "delete"
          ? await fetch(`/api/admin/forum/posts?id=${encodeURIComponent(postId)}`, {
              method: "DELETE",
              headers: { authorization: `Bearer ${token}` },
            })
          : await fetch("/api/admin/forum/posts", {
              method: "PATCH",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ id: postId, action }),
            });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; details?: unknown }
        | null;

      if (!response.ok) {
        const detailText = payload?.details ? ` ${JSON.stringify(payload.details)}` : "";
        throw new Error(`${payload?.error ?? `操作失败 (${response.status})`}${detailText}`);
      }
      await loadPosts(token, statusFilter);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "操作失败");
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
          <h2>管理员帖子治理</h2>
          <p>查看帖子状态、举报量和媒体体积，并执行隐藏/恢复/删除。</p>
        </div>
        <div className="community-cta-row">
          {[
            { key: "all", label: "全部" },
            { key: "published", label: "公开" },
            { key: "hidden", label: "隐藏" },
            { key: "deleted", label: "删除" },
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

      {error ? <div className="inline-error">{error}</div> : null}
      {loading ? <p className="community-meta">加载中...</p> : null}

      {!loading && posts.length === 0 ? (
        <div className="community-empty">
          <strong>暂无帖子</strong>
          <p>当前筛选条件下没有可治理的帖子。</p>
        </div>
      ) : (
        <div className="community-list" style={{ marginTop: "0.8rem" }}>
          {posts.map((post) => {
            const loadingThis = actionLoadingId === post.id;
            return (
              <article key={post.id} className="community-list-item" style={{ gap: "0.65rem" }}>
                <strong>{post.title}</strong>
                <span>
                  状态 {post.status} · 圈子 {post.circle_name ?? "-"} · 作者 {post.author_name ?? post.author_id}
                </span>
                <span>
                  媒体 {post.media_count}（视频 {post.video_count}）· 总大小 {bytesLabel(post.media_total_bytes)} · 举报 {post.report_count}
                </span>
                <span>{new Date(post.created_at).toLocaleString("zh-CN")}</span>
                <div className="community-cta-row">
                  <a href={`/posts/${post.id}/`} className="community-button--secondary">查看帖子</a>
                  <button
                    type="button"
                    className="community-button--secondary"
                    onClick={() => mutatePost(post.id, "hide")}
                    disabled={loadingThis || post.status === "hidden"}
                  >
                    隐藏
                  </button>
                  <button
                    type="button"
                    className="community-button--secondary"
                    onClick={() => mutatePost(post.id, "restore")}
                    disabled={loadingThis || post.status === "published"}
                  >
                    恢复
                  </button>
                  <button
                    type="button"
                    className="community-button"
                    onClick={() => mutatePost(post.id, "delete")}
                    disabled={loadingThis}
                  >
                    删除
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
