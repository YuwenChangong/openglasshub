import { useEffect, useMemo, useRef, useState } from "react";
import { AdminApiError, adminFetch } from "../../lib/admin-api-client";
import { uploadToPostMediaWithTus } from "../../lib/storage-tus";
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
  message?: string;
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

type SaveAction = "save" | "draft" | "publish" | "archive" | null;

const EMPTY_FORM: FormState = {
  title: "",
  slug: "",
  category: "industry",
  summary: "",
  content: "",
  cover_image_url: "",
  source_name: "OpenGlass Hub",
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
  const latinBase = title
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  if (latinBase) return latinBase;

  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `news-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
}

function normalizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeUrlDraft(value: string) {
  const text = value.trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(text)) {
    return `https://${text}`;
  }
  return text;
}

function isNewsStoragePath(value: string) {
  return value.startsWith("news-covers/") || value.startsWith("news-content/");
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
    source_name: article.source_name ?? "OpenGlass Hub",
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

function successLabel(action: SaveAction, fallbackStatus: NewsStatus) {
  if (action === "publish") return "已发布";
  if (action === "archive") return "已归档";
  if (action === "draft" || fallbackStatus === "draft") return "已保存草稿";
  return "已保存";
}

function bodyImageMarkdown(alt: string, url: string) {
  return `![${alt || "图片"}](${url})`;
}

function defaultImageAltText(fileName: string) {
  return fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim() || "图片";
}

export default function AdminNewsDashboard() {
  const adminSession = useAdminSession();
  const [statusFilter, setStatusFilter] = useState<"all" | NewsStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | NewsCategory>("all");
  const [searchDraft, setSearchDraft] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [articles, setArticles] = useState<AdminNewsArticle[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [loading, setLoading] = useState(false);
  const [saveAction, setSaveAction] = useState<SaveAction>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [slugEditedManually, setSlugEditedManually] = useState(false);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState("");
  const [coverPreviewBroken, setCoverPreviewBroken] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [contentUploading, setContentUploading] = useState(false);
  const [contentImagePanelOpen, setContentImagePanelOpen] = useState(false);
  const [contentImageUrl, setContentImageUrl] = useState("");
  const [contentImageAlt, setContentImageAlt] = useState("");
  const [contentImageError, setContentImageError] = useState("");

  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const contentInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
      setError(requestError instanceof Error ? requestError.message : "加载资讯列表失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (adminSession.state.status !== "ready" || !adminSession.session) return;
    void loadArticles();
  }, [adminSession.session, adminSession.state.status, statusFilter, categoryFilter, searchFilter]);

  useEffect(() => {
    if (!adminSession.supabase) return;
    const coverValue = form.cover_image_url.trim();
    setCoverPreviewBroken(false);

    if (!coverValue) {
      setCoverPreviewUrl("");
      return;
    }

    if (!isNewsStoragePath(coverValue)) {
      setCoverPreviewUrl(normalizeUrlDraft(coverValue));
      return;
    }

    let cancelled = false;
    void (async () => {
      const { data, error: signedError } = await adminSession.supabase!.storage
        .from("post-media")
        .createSignedUrl(coverValue, 60 * 60);

      if (cancelled) return;
      if (signedError || !data?.signedUrl) {
        setCoverPreviewUrl("");
        setCoverPreviewBroken(true);
        return;
      }

      setCoverPreviewUrl(data.signedUrl);
    })();

    return () => {
      cancelled = true;
    };
  }, [adminSession.supabase, form.cover_image_url]);

  function upsertLocalArticle(article: AdminNewsArticle) {
    setArticles((current) => {
      const index = current.findIndex((item) => item.id === article.id);
      if (index === -1) return [article, ...current];
      const next = [...current];
      next[index] = article;
      return next;
    });
  }

  function startNewArticle() {
    setSelectedId("");
    setForm({ ...EMPTY_FORM });
    setSlugEditedManually(false);
    setShowAdvanced(false);
    setError("");
    setSuccess("");
    setContentImagePanelOpen(false);
    setContentImageError("");
  }

  function selectArticle(article: AdminNewsArticle) {
    setSelectedId(article.id);
    setForm(toFormState(article));
    setSlugEditedManually(true);
    setError("");
    setSuccess("");
    setContentImagePanelOpen(false);
    setContentImageError("");
  }

  function patchForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function applySearchFilter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchFilter(searchDraft.trim());
  }

  function handleTitleChange(nextTitle: string) {
    setForm((current) => ({
      ...current,
      title: nextTitle,
      slug: slugEditedManually ? current.slug : slugifyDraftTitle(nextTitle),
    }));
  }

  function handleSlugChange(nextSlug: string) {
    setSlugEditedManually(true);
    patchForm("slug", nextSlug.toLowerCase());
  }

  function insertIntoContent(markdown: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      patchForm("content", `${form.content}${form.content.endsWith("\n") || !form.content ? "" : "\n"}${markdown}`);
      return;
    }

    const start = textarea.selectionStart ?? form.content.length;
    const end = textarea.selectionEnd ?? form.content.length;
    const nextValue = `${form.content.slice(0, start)}${markdown}${form.content.slice(end)}`;
    patchForm("content", nextValue);

    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + markdown.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  async function uploadNewsAsset(file: File, prefix: "news-covers" | "news-content") {
    if (!adminSession.me?.user_id || !adminSession.accessToken) {
      throw new Error("登录状态已失效，请重新登录");
    }

    const objectPath = `${prefix}/${adminSession.me.user_id}/${Date.now()}-${normalizeFileName(file.name)}`;
    await uploadToPostMediaWithTus({
      file,
      objectPath,
      accessToken: adminSession.accessToken,
    });
    return objectPath;
  }

  async function handleCoverUpload(file: File | null) {
    if (!file) return;
    setCoverUploading(true);
    setError("");
    setSuccess("");
    try {
      const objectPath = await uploadNewsAsset(file, "news-covers");
      patchForm("cover_image_url", objectPath);
      setSuccess("封面图已上传");
    } catch {
      setError("封面图上传失败，请稍后重试");
    } finally {
      setCoverUploading(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }

  async function handleContentImageUpload(file: File | null) {
    if (!file) return;
    setContentUploading(true);
    setContentImageError("");
    try {
      const objectPath = await uploadNewsAsset(file, "news-content");
      insertIntoContent(`${bodyImageMarkdown(defaultImageAltText(file.name), objectPath)}\n`);
      setSuccess("正文图片已插入");
    } catch {
      setContentImageError("正文图片上传失败，请稍后重试");
    } finally {
      setContentUploading(false);
      if (contentInputRef.current) contentInputRef.current.value = "";
    }
  }

  function insertImageFromUrl() {
    const normalizedUrl = normalizeUrlDraft(contentImageUrl);
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      setContentImageError("请输入有效的图片链接");
      return;
    }
    insertIntoContent(`${bodyImageMarkdown(contentImageAlt.trim() || "图片", normalizedUrl)}\n`);
    setContentImageUrl("");
    setContentImageAlt("");
    setContentImageError("");
    setContentImagePanelOpen(false);
  }

  async function saveArticle(nextStatus?: NewsStatus, action?: SaveAction) {
    if (!adminSession.session) return;
    const finalAction = action ?? "save";
    setSaveAction(finalAction);
    setError("");
    setSuccess("");

    try {
      const body = {
        ...form,
        source_url: normalizeUrlDraft(form.source_url),
        cover_image_url: form.cover_image_url.trim(),
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
        setSlugEditedManually(true);
        upsertLocalArticle(article);
      }

      setSuccess(payload.message || successLabel(finalAction, nextStatus ?? form.status));
      await loadArticles();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存失败");
    } finally {
      setSaveAction(null);
    }
  }

  async function deleteArticle() {
    if (!adminSession.session || !form.id) return;
    setDeleting(true);
    setError("");
    setSuccess("");
    try {
      const payload = await adminFetch<AdminNewsPayload>(`/api/admin/news?id=${encodeURIComponent(form.id)}`, {
        method: "DELETE",
        session: adminSession.session,
      });
      setConfirmDeleteOpen(false);
      setSelectedId("");
      setForm({ ...EMPTY_FORM });
      setSlugEditedManually(false);
      setSuccess(payload.message || "已删除");
      setArticles((current) => current.filter((item) => item.id !== form.id));
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
          <h2>资讯发布台</h2>
          <p>让管理员可以直接创建、插图、发布和归档资讯，不需要理解技术字段。</p>
        </div>
        <div className="community-cta-row">
          <button type="button" className="community-button" onClick={startNewArticle}>
            新建资讯
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

          {loading ? <p className="community-meta">正在加载资讯列表...</p> : null}
          {articles.length === 0 && !loading ? (
            <div className="community-empty">
              <strong>暂无资讯</strong>
              <p>先创建第一篇内容。</p>
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
            void saveArticle(undefined, "save");
          }}
        >
          <div className="admin-news-form__head">
            <div>
              <strong>{form.id ? "编辑资讯" : "新建资讯"}</strong>
              <p>标题、封面、正文、发布设置都集中在右侧，发布后会立即进入公开资讯流。</p>
            </div>
            <div className="admin-news-form__head-meta">
              <span className={`admin-news-status-pill admin-news-status-pill--${form.status}`}>{statusLabel(form.status)}</span>
              {selectedArticle?.published_at ? <span className="community-meta">发布于 {new Date(selectedArticle.published_at).toLocaleString("zh-CN")}</span> : null}
              {selectedArticle ? <span className="community-meta">更新于 {new Date(selectedArticle.updated_at).toLocaleString("zh-CN")}</span> : null}
            </div>
          </div>

          <section className="admin-news-form__section">
            <div className="admin-news-form__section-head">
              <div>
                <strong>基础信息</strong>
                <p>标题会自动生成文章链接预览，管理员不需要手动理解 slug。</p>
              </div>
              <button
                type="button"
                className="community-action-button community-action-button--compact community-action-button--muted"
                onClick={() => {
                  setSlugEditedManually(false);
                  patchForm("slug", slugifyDraftTitle(form.title));
                }}
              >
                根据标题生成
              </button>
            </div>

            <label className="community-form-field">
              <span>标题</span>
              <input value={form.title} onChange={(event) => handleTitleChange(event.target.value)} placeholder="输入资讯标题" />
            </label>

            <label className="community-form-field">
              <span>文章链接预览</span>
              <div className="admin-news-slug-preview">/news/{form.slug || slugifyDraftTitle(form.title) || "news-..."}/</div>
              <small className="community-meta">用于文章链接，可自动生成。</small>
            </label>

            <label className="community-form-field">
              <span>摘要</span>
              <textarea value={form.summary} onChange={(event) => patchForm("summary", event.target.value)} rows={4} placeholder="用于资讯卡片和详情页摘要" />
            </label>
          </section>

          <section className="admin-news-form__section">
            <div className="admin-news-form__section-head">
              <div>
                <strong>封面图</strong>
                <p>支持直接粘贴图片链接，也支持上传到站内存储。</p>
              </div>
              <button
                type="button"
                className="community-action-button community-action-button--compact community-action-button--muted"
                onClick={() => coverInputRef.current?.click()}
                disabled={coverUploading}
              >
                {coverUploading ? "上传中..." : "上传封面图"}
              </button>
            </div>

            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="admin-news-hidden-input"
              onChange={(event) => void handleCoverUpload(event.target.files?.[0] ?? null)}
            />

            <label className="community-form-field">
              <span>封面图链接</span>
              <input
                value={form.cover_image_url}
                onChange={(event) => patchForm("cover_image_url", event.target.value)}
                onBlur={(event) => patchForm("cover_image_url", normalizeUrlDraft(event.target.value))}
                placeholder="https://... 或已上传的封面路径"
              />
            </label>

            {coverPreviewUrl ? (
              <div className="admin-news-cover-preview">
                <img
                  src={coverPreviewUrl}
                  alt={form.title || "封面预览"}
                  onError={() => setCoverPreviewBroken(true)}
                />
              </div>
            ) : (
              <div className="community-media-placeholder">封面预览会显示在这里</div>
            )}
            {coverPreviewBroken ? <div className="comment-inline-error">封面图暂时无法预览，请检查链接或重新上传。</div> : null}
          </section>

          <section className="admin-news-form__section">
            <div className="admin-news-form__section-head">
              <div>
                <strong>正文内容</strong>
                <p>正文按 Markdown 轻量渲染，支持段落、标题、链接和图片。</p>
              </div>
              <div className="admin-news-toolbar__search-actions">
                <button
                  type="button"
                  className="community-action-button community-action-button--compact community-action-button--muted"
                  onClick={() => setContentImagePanelOpen((current) => !current)}
                >
                  插入图片链接
                </button>
                <button
                  type="button"
                  className="community-action-button community-action-button--compact community-action-button--muted"
                  onClick={() => contentInputRef.current?.click()}
                  disabled={contentUploading}
                >
                  {contentUploading ? "上传中..." : "上传图片"}
                </button>
              </div>
            </div>

            <input
              ref={contentInputRef}
              type="file"
              accept="image/*"
              className="admin-news-hidden-input"
              onChange={(event) => void handleContentImageUpload(event.target.files?.[0] ?? null)}
            />

            {contentImagePanelOpen ? (
              <div className="admin-news-inline-panel">
                <label className="community-form-field">
                  <span>图片链接</span>
                  <input
                    value={contentImageUrl}
                    onChange={(event) => setContentImageUrl(event.target.value)}
                    onBlur={(event) => setContentImageUrl(normalizeUrlDraft(event.target.value))}
                    placeholder="https://..."
                  />
                </label>
                <label className="community-form-field">
                  <span>图片说明</span>
                  <input
                    value={contentImageAlt}
                    onChange={(event) => setContentImageAlt(event.target.value)}
                    placeholder="图片说明"
                  />
                </label>
                <div className="admin-news-inline-panel__actions">
                  <button type="button" className="community-button" onClick={insertImageFromUrl}>
                    插入到正文
                  </button>
                  <button
                    type="button"
                    className="community-button--secondary"
                    onClick={() => {
                      setContentImagePanelOpen(false);
                      setContentImageError("");
                    }}
                  >
                    取消
                  </button>
                </div>
                {contentImageError ? <div className="comment-inline-error">{contentImageError}</div> : null}
              </div>
            ) : null}

            <label className="community-form-field">
              <span>正文</span>
              <textarea
                ref={textareaRef}
                value={form.content}
                onChange={(event) => patchForm("content", event.target.value)}
                rows={18}
                placeholder="# 标题&#10;&#10;正文段落...&#10;&#10;![图片](https://...)"
              />
            </label>
          </section>

          <section className="admin-news-form__section">
            <div className="admin-news-form__section-head">
              <div>
                <strong>发布设置</strong>
                <p>留空发布时间时，点击发布会自动使用当前时间。</p>
              </div>
              <button
                type="button"
                className="community-action-button community-action-button--compact community-action-button--muted"
                onClick={() => setShowAdvanced((current) => !current)}
              >
                {showAdvanced ? "收起高级设置" : "高级设置"}
              </button>
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

            <div className="admin-news-form__checks admin-news-form__checks--stacked">
              <label>
                <input type="checkbox" checked={form.pinned} onChange={(event) => patchForm("pinned", event.target.checked)} />
                <span>
                  <strong>置顶到资讯列表前面</strong>
                  <small>已发布后会优先出现在资讯列表前部。</small>
                </span>
              </label>
              <label>
                <input type="checkbox" checked={form.featured} onChange={(event) => patchForm("featured", event.target.checked)} />
                <span>
                  <strong>设为顶部精选头条</strong>
                  <small>最新的精选文章会显示在 `/news/` 顶部大卡位。</small>
                </span>
              </label>
            </div>

            {showAdvanced ? (
              <div className="admin-news-form__advanced">
                <label className="community-form-field">
                  <span>文章链接 slug</span>
                  <input
                    value={form.slug}
                    onChange={(event) => handleSlugChange(event.target.value)}
                    placeholder="留空则按标题自动生成"
                  />
                  <small className="community-meta">只允许小写字母、数字和连字符。</small>
                </label>

                <div className="admin-news-form__advanced-row">
                  <label className="community-form-field">
                    <span>自定义发布时间</span>
                    <input
                      type="datetime-local"
                      value={form.published_at}
                      onChange={(event) => patchForm("published_at", event.target.value)}
                    />
                    <small className="community-meta">留空则发布时间为现在。</small>
                  </label>

                  <div className="admin-news-form__helper">
                    <button
                      type="button"
                      className="community-action-button community-action-button--compact community-action-button--muted"
                      onClick={() => patchForm("published_at", "")}
                    >
                      清空时间
                    </button>
                    <button
                      type="button"
                      className="community-action-button community-action-button--compact community-action-button--muted"
                      onClick={() => {
                        setSlugEditedManually(false);
                        patchForm("slug", slugifyDraftTitle(form.title));
                      }}
                    >
                      重新生成链接
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          <section className="admin-news-form__section">
            <div className="admin-news-form__section-head">
              <div>
                <strong>来源信息</strong>
                <p>来源名称和来源链接都可选；OpenGlass 原创内容可直接保留默认来源名。</p>
              </div>
            </div>

            <div className="admin-news-form__grid">
              <label className="community-form-field">
                <span>来源名称</span>
                <input value={form.source_name} onChange={(event) => patchForm("source_name", event.target.value)} placeholder="OpenGlass Hub" />
              </label>
              <label className="community-form-field">
                <span>来源链接</span>
                <input
                  value={form.source_url}
                  onChange={(event) => patchForm("source_url", event.target.value)}
                  onBlur={(event) => patchForm("source_url", normalizeUrlDraft(event.target.value))}
                  placeholder="https://..."
                />
              </label>
            </div>
          </section>

          <div className="admin-news-form__actions">
            <button type="submit" className="community-button" disabled={saveAction !== null}>
              {saveAction === "save" ? "保存中..." : "保存修改"}
            </button>
            <button type="button" className="community-button--secondary" onClick={() => void saveArticle("draft", "draft")} disabled={saveAction !== null}>
              {saveAction === "draft" ? "保存中..." : "保存草稿"}
            </button>
            <button type="button" className="community-button--secondary" onClick={() => void saveArticle("published", "publish")} disabled={saveAction !== null}>
              {saveAction === "publish" ? "发布中..." : "发布"}
            </button>
            <button type="button" className="community-button--secondary" onClick={() => void saveArticle("archived", "archive")} disabled={saveAction !== null || !form.id}>
              {saveAction === "archive" ? "归档中..." : "归档"}
            </button>
            <button type="button" className="community-button--secondary" onClick={() => setConfirmDeleteOpen(true)} disabled={!form.id || deleting}>
              {deleting ? "删除中..." : "删除"}
            </button>
            {form.slug ? (
              <a href={`/news/${form.slug}/`} target="_blank" rel="noreferrer" className="community-action-button">
                预览
              </a>
            ) : null}
          </div>
        </form>
      </div>

      <GlassConfirmDialog
        open={confirmDeleteOpen}
        title="删除资讯"
        description="删除后这篇资讯会从后台列表和公开页移除。"
        detail={form.title || "请确认是否删除当前资讯。"}
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
