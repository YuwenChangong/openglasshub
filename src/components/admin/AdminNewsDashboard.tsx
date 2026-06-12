import { useEffect, useMemo, useState } from "react";
import { AdminApiError, adminFetch } from "../../lib/admin-api-client";
import { useAdminSession } from "./useAdminSession";
import GlassConfirmDialog from "../common/GlassConfirmDialog";

type NewsStatus = "draft" | "published" | "archived";
type NewsCategory =
  | "industry"
  | "devices"
  | "ai_glasses"
  | "ar_glasses"
  | "developer"
  | "community"
  | "openglass";

type AdminNewsArticle = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  content: string;
  cover_image_url: string | null;
  category: NewsCategory;
  source_name: string | null;
  source_url: string | null;
  status: NewsStatus;
  author_id: string | null;
  pinned: boolean;
  featured: boolean;
  view_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type AdminNewsPayload = {
  ok?: boolean;
  articles?: AdminNewsArticle[];
  article?: AdminNewsArticle | null;
  error?: string;
};

type FormState = {
  id?: string;
  title: string;
  slug: string;
  category: NewsCategory;
  summary: string;
  content: string;
  cover_image_url: string;
  source_name: string;
  source_url: string;
  pinned: boolean;
  featured: boolean;
  status: NewsStatus;
  published_at: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  slug: "",
  category: "industry",
  summary: "",
  content: "",
  cover_image_url: "",
  source_name: "",
  source_url: "",
  pinned: false,
  featured: false,
  status: "draft",
  published_at: "",
};

const CATEGORY_OPTIONS: Array<{ value: NewsCategory; label: string }> = [
  { value: "industry", label: "推荐 / 行业" },
  { value: "devices", label: "设备" },
  { value: "ai_glasses", label: "AI 眼镜" },
  { value: "ar_glasses", label: "AR 眼镜" },
  { value: "developer", label: "开发者" },
  { value: "community", label: "社区" },
  { value: "openglass", label: "OpenGlass" },
];

const STATUS_OPTIONS: Array<{ value: "all" | NewsStatus; label: string }> = [
  { value: "all", label: "全部" },
  { value: "draft", label: "草稿" },
  { value: "published", label: "已发布" },
  { value: "archived", label: "已归档" },
];

const ADMIN_CATEGORY_OPTIONS: Array<{ value: "all" | NewsCategory; label: string }> = [
  { value: "all", label: "全部分类" },
  ...CATEGORY_OPTIONS,
];

function slugifyDraftTitle(title: string) {
  const nextSlug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  return nextSlug || "";
}

function toFormState(article?: AdminNewsArticle | null): FormState {
  if (!article) return { ...EMPTY_FORM };
  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    category: article.category,
    summary: article.summary ?? "",
    content: article.content ?? "",
    cover_image_url: article.cover_image_url ?? "",
    source_name: article.source_name ?? "",
    source_url: article.source_url ?? "",
    pinned: article.pinned,
    featured: article.featured,
    status: article.status,
    published_at: article.published_at ? article.published_at.slice(0, 16) : "",
  };
}

function statusLabel(status: NewsStatus) {
  if (status === "published") return "已发布";
  if (status === "archived") return "已归档";
  return "草稿";
}

function categoryLabel(category: NewsCategory) {
  return CATEGORY_OPTIONS.find((item) => item.value === category)?.label ?? category;
}

export default function AdminNewsDashboard() {
  const adminSession = useAdminSession();
  const [statusFilter, setStatusFilter] = useState<"all" | NewsStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | NewsCategory>("all");
  const [searchDraft, setSearchDraft] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [articles, setArticles] = useState<AdminNewsArticle[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const selectedArticle = useMemo(
    () => articles.find((article) => article.id === selectedId) ?? null,
    [articles, selectedId],
  );

  async function loadArticles() {
    if (!adminSession.session) return;
    setLoading(true);
    setError("");
    try {
      const payload = await adminFetch<AdminNewsPayload>(
        `/api/admin/news?status=${encodeURIComponent(statusFilter)}&category=${encodeURIComponent(categoryFilter)}&search=${encodeURIComponent(searchFilter)}&limit=120`,
        {
          method: "GET",
          session: adminSession.session,
        },
      );
      const nextArticles = payload.articles ?? [];
      setArticles(nextArticles);
      if (selectedId) {
        const nextSelected = nextArticles.find((item) => item.id === selectedId) ?? null;
        if (nextSelected) {
          setForm(toFormState(nextSelected));
        }
      }
    } catch (requestError) {
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
      setError(requestError instanceof Error ? requestError.message : "加载新闻列表失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (adminSession.state.status !== "ready" || !adminSession.session) return;
    void loadArticles();
  }, [adminSession.session, adminSession.state.status, statusFilter, categoryFilter, searchFilter]);

  function startNewArticle() {
    setSelectedId("");
    setForm({ ...EMPTY_FORM });
    setError("");
    setSuccess("");
  }

  function selectArticle(article: AdminNewsArticle) {
    setSelectedId(article.id);
    setForm(toFormState(article));
    setError("");
    setSuccess("");
  }

  function patchForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function applySearchFilter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchFilter(searchDraft.trim());
  }

  async function saveArticle(nextStatus?: NewsStatus) {
    if (!adminSession.session) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const body = {
        ...form,
        status: nextStatus ?? form.status,
        published_at: form.published_at ? new Date(form.published_at).toISOString() : null,
      };

      const payload = form.id
        ? await adminFetch<AdminNewsPayload>("/api/admin/news", {
            method: "PATCH",
            session: adminSession.session,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...body, id: form.id }),
          })
        : await adminFetch<AdminNewsPayload>("/api/admin/news", {
            method: "POST",
            session: adminSession.session,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });

      const article = payload.article ?? null;
      if (article) {
        setSelectedId(article.id);
        setForm(toFormState(article));
      }
      setSuccess(form.id ? "新闻已更新" : "新闻已创建");
      await loadArticles();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function deleteArticle() {
    if (!adminSession.session || !form.id) return;
    setDeleting(true);
    setError("");
    setSuccess("");
    try {
      await adminFetch(`/api/admin/news?id=${encodeURIComponent(form.id)}`, {
        method: "DELETE",
        session: adminSession.session,
      });
      setConfirmDeleteOpen(false);
      setSelectedId("");
      setForm({ ...EMPTY_FORM });
      setSuccess("新闻已删除");
      await loadArticles();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  if (adminSession.state.status === "checking") {
    return <div className="community-empty"><strong>{adminSession.state.message}</strong></div>;
  }

  if (adminSession.state.status === "signed_out" || adminSession.state.status === "forbidden" || adminSession.state.status === "error" || adminSession.state.status === "timeout") {
    return (
      <div className="community-empty admin-state-message admin-error">
        <strong>{adminSession.state.message}</strong>
        {"details" in adminSession.state && adminSession.state.details ? (
          <p className="admin-debug-note">{adminSession.state.details}</p>
        ) : null}
      </div>
    );
  }

  return (
    <section className="community-surface admin-news-dashboard">
      <div className="community-stream-head">
        <div>
          <h2>热点发布台</h2>
          <p>创建、发布、归档热点内容，公开页只会展示已发布文章。</p>
        </div>
        <div className="community-cta-row">
          <button type="button" className="community-button" onClick={startNewArticle}>
            新建热点
          </button>
        </div>
      </div>

      <div className="admin-user-line">
        当前管理员：{adminSession.me?.profile?.display_name || adminSession.me?.profile?.username || adminSession.me?.user_id} · 角色 {adminSession.me?.role}
      </div>

      {error ? <div className="admin-error">{error}</div> : null}
      {success ? <div className="admin-inline-success">{success}</div> : null}

      <div className="admin-news-toolbar">
        <div className="admin-news-toolbar__filters">
          <div className="admin-news-toolbar__group">
            <span className="admin-news-toolbar__label">状态</span>
            <div className="admin-news-toolbar__chips">
              {STATUS_OPTIONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={statusFilter === item.value ? "community-button" : "community-button--secondary"}
                  onClick={() => setStatusFilter(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <label className="community-form-field admin-news-toolbar__select">
            <span>分类</span>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as "all" | NewsCategory)}>
              {ADMIN_CATEGORY_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <form className="admin-news-toolbar__search" onSubmit={applySearchFilter}>
          <label className="community-form-field">
            <span>搜索</span>
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="标题或 slug"
            />
          </label>
          <div className="admin-news-toolbar__search-actions">
            <button type="submit" className="community-button">筛选</button>
            <button
              type="button"
              className="community-button--secondary"
              onClick={() => {
                setSearchDraft("");
                setSearchFilter("");
              }}
            >
              清空
            </button>
          </div>
        </form>
      </div>

      <div className="admin-news-dashboard__grid">
        <div className="admin-news-dashboard__list">
          <div className="admin-news-dashboard__list-head">
            <div>
              <strong>文章列表</strong>
              <p>按最近更新时间排序，可按状态、分类、标题或 slug 筛选。</p>
            </div>
            <span className="community-tag">{articles.length} 篇</span>
          </div>
          {loading ? <p className="community-meta">正在加载新闻列表...</p> : null}
          {articles.length === 0 && !loading ? (
            <div className="community-empty">
              <strong>暂无新闻</strong>
              <p>先创建第一条热点内容。</p>
            </div>
          ) : null}
          {articles.map((article) => (
            <button
              key={article.id}
              type="button"
              className={`admin-news-card${selectedId === article.id ? " is-active" : ""}`}
              onClick={() => selectArticle(article)}
            >
              <div className="admin-news-card__meta">
                <span className="community-tag">{categoryLabel(article.category)}</span>
                <span className={`admin-news-status-pill admin-news-status-pill--${article.status}`}>{statusLabel(article.status)}</span>
              </div>
              <strong>{article.title}</strong>
              {article.summary ? <p>{article.summary}</p> : null}
              <div className="community-inline-meta">
                <span>{article.published_at ? new Date(article.published_at).toLocaleString("zh-CN") : "未发布"}</span>
                <span>更新于 {new Date(article.updated_at).toLocaleString("zh-CN")}</span>
                <span>{article.view_count} 阅读</span>
                {article.featured ? <span>精选</span> : null}
                {article.pinned ? <span>置顶</span> : null}
              </div>
            </button>
          ))}
        </div>

        <form
          className="admin-news-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveArticle();
          }}
        >
          <div className="admin-news-form__head">
            <div>
              <strong>{form.id ? "编辑文章" : "新建文章"}</strong>
              <p>支持草稿、发布、归档和删除。公开页只显示已发布内容。</p>
            </div>
            <div className="admin-news-form__head-meta">
              <span className={`admin-news-status-pill admin-news-status-pill--${form.status}`}>{statusLabel(form.status)}</span>
              {selectedArticle?.published_at ? <span className="community-meta">发布于 {new Date(selectedArticle.published_at).toLocaleString("zh-CN")}</span> : null}
              {selectedArticle ? <span className="community-meta">更新于 {new Date(selectedArticle.updated_at).toLocaleString("zh-CN")}</span> : null}
            </div>
          </div>

          <div className="admin-news-form__grid">
            <label className="community-form-field">
              <span>标题</span>
              <input value={form.title} onChange={(event) => patchForm("title", event.target.value)} />
            </label>
            <label className="community-form-field">
              <span>Slug</span>
              <input value={form.slug} onChange={(event) => patchForm("slug", event.target.value)} placeholder="留空则按标题生成" />
            </label>
          </div>

          <div className="admin-news-form__helper">
            <span className="community-meta">
              {form.slug.trim() ? `当前 slug：${form.slug}` : `建议 slug：${slugifyDraftTitle(form.title) || "输入标题后自动生成"}`}
            </span>
            {!form.slug.trim() && form.title.trim() ? (
              <button
                type="button"
                className="community-action-button community-action-button--compact community-action-button--muted"
                onClick={() => patchForm("slug", slugifyDraftTitle(form.title))}
              >
                使用建议 slug
              </button>
            ) : null}
          </div>

          <div className="admin-news-form__grid">
            <label className="community-form-field">
              <span>分类</span>
              <select value={form.category} onChange={(event) => patchForm("category", event.target.value as NewsCategory)}>
                {CATEGORY_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="community-form-field">
              <span>状态</span>
              <select value={form.status} onChange={(event) => patchForm("status", event.target.value as NewsStatus)}>
                <option value="draft">草稿</option>
                <option value="published">已发布</option>
                <option value="archived">已归档</option>
              </select>
            </label>
          </div>

          <label className="community-form-field">
            <span>摘要</span>
            <textarea value={form.summary} onChange={(event) => patchForm("summary", event.target.value)} rows={4} />
          </label>

          <label className="community-form-field">
            <span>正文</span>
            <textarea value={form.content} onChange={(event) => patchForm("content", event.target.value)} rows={18} />
          </label>

          <div className="admin-news-form__grid">
            <label className="community-form-field">
              <span>封面图 URL</span>
              <input value={form.cover_image_url} onChange={(event) => patchForm("cover_image_url", event.target.value)} />
            </label>
            <label className="community-form-field">
              <span>发布时间</span>
              <input type="datetime-local" value={form.published_at} onChange={(event) => patchForm("published_at", event.target.value)} />
            </label>
          </div>

          <div className="admin-news-form__grid">
            <label className="community-form-field">
              <span>来源名称</span>
              <input value={form.source_name} onChange={(event) => patchForm("source_name", event.target.value)} />
            </label>
            <label className="community-form-field">
              <span>来源链接</span>
              <input value={form.source_url} onChange={(event) => patchForm("source_url", event.target.value)} />
            </label>
          </div>

          <div className="admin-news-form__checks">
            <label><input type="checkbox" checked={form.pinned} onChange={(event) => patchForm("pinned", event.target.checked)} /> 置顶</label>
            <label><input type="checkbox" checked={form.featured} onChange={(event) => patchForm("featured", event.target.checked)} /> 精选</label>
          </div>

          <div className="admin-news-form__actions">
            <button type="submit" className="community-button" disabled={saving}>
              {saving ? "保存中..." : form.id ? "保存修改" : "创建新闻"}
            </button>
            <button type="button" className="community-button--secondary" onClick={() => void saveArticle("draft")} disabled={saving}>
              保存草稿
            </button>
            <button type="button" className="community-button--secondary" onClick={() => void saveArticle("published")} disabled={saving}>
              发布
            </button>
            <button type="button" className="community-button--secondary" onClick={() => void saveArticle("archived")} disabled={saving || !form.id}>
              归档
            </button>
            <button type="button" className="community-button--secondary" onClick={() => setConfirmDeleteOpen(true)} disabled={!form.id || deleting}>
              删除
            </button>
          </div>

          {selectedArticle ? (
            <div className="community-inline-meta">
              <span>已选文章：{selectedArticle.title}</span>
              <span>浏览量：{selectedArticle.view_count}</span>
              <a href={`/news/${selectedArticle.slug}/`} target="_blank" rel="noreferrer" className="community-inline-link">
                预览公开页
              </a>
            </div>
          ) : null}
        </form>
      </div>

      <GlassConfirmDialog
        open={confirmDeleteOpen}
        title="删除热点内容"
        description="删除后将从后台和公开页移除这条新闻。"
        detail={form.title || "请确认是否删除当前文章。"}
        confirmLabel="确认删除"
        cancelLabel="取消"
        danger={true}
        loading={deleting}
        error={error}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => void deleteArticle()}
      />
    </section>
  );
}
