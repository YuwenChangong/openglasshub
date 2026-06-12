import type { APIRoute } from "astro";
import {
  jsonResponse,
  requireModerator,
  type RuntimeEnv,
} from "../../../lib/server/admin-auth";
import {
  getAdminNewsArticleBySlug,
  isValidNewsSlug,
  listAdminNewsArticles,
  slugifyNewsTitle,
  type NewsCategoryKey,
  type NewsStatus,
} from "../../../lib/news";

export const prerender = false;

type NewsPayload = {
  id?: string;
  slug?: string;
  title?: string;
  summary?: string;
  content?: string;
  cover_image_url?: string | null;
  category?: NewsCategoryKey;
  source_name?: string | null;
  source_url?: string | null;
  status?: NewsStatus;
  pinned?: boolean;
  featured?: boolean;
  published_at?: string | null;
};

const ALLOWED_CATEGORIES = new Set<NewsCategoryKey>([
  "industry",
  "devices",
  "ai_glasses",
  "ar_glasses",
  "developer",
  "community",
  "openglass",
]);

const ALLOWED_STATUSES = new Set<NewsStatus>(["draft", "published", "archived"]);

function coerceUrl(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function validatePayload(payload: NewsPayload) {
  const title = String(payload.title ?? "").trim();
  const summary = String(payload.summary ?? "").trim();
  const content = String(payload.content ?? "").trim();
  const category = String(payload.category ?? "").trim() as NewsCategoryKey;
  const status = String(payload.status ?? "").trim() as NewsStatus;
  const slug = String(payload.slug ?? "").trim().toLowerCase();

  if (!title || title.length < 4 || title.length > 180) {
    return { ok: false as const, error: "标题长度需为 4-180 字" };
  }
  if (!ALLOWED_CATEGORIES.has(category)) {
    return { ok: false as const, error: "无效分类" };
  }
  if (!ALLOWED_STATUSES.has(status)) {
    return { ok: false as const, error: "无效状态" };
  }
  if (summary.length > 280) {
    return { ok: false as const, error: "摘要不能超过 280 字" };
  }
  if (content.length > 50000) {
    return { ok: false as const, error: "正文不能超过 50000 字" };
  }

  const nextSlug = slug || slugifyNewsTitle(title);
  if (!isValidNewsSlug(nextSlug)) {
    return { ok: false as const, error: "Slug 只能包含小写字母、数字和连字符" };
  }

  const sourceUrl = payload.source_url ? coerceUrl(payload.source_url) : null;
  if (payload.source_url && !sourceUrl) {
    return { ok: false as const, error: "来源链接无效" };
  }

  const coverImageUrl = payload.cover_image_url ? coerceUrl(payload.cover_image_url) : null;
  if (payload.cover_image_url && !coverImageUrl) {
    return { ok: false as const, error: "封面链接无效" };
  }

  return {
    ok: true as const,
    value: {
      slug: nextSlug,
      title,
      summary,
      content,
      category,
      status,
      source_name: String(payload.source_name ?? "").trim() || null,
      source_url: sourceUrl,
      cover_image_url: coverImageUrl,
      pinned: payload.pinned === true,
      featured: payload.featured === true,
      published_at:
        payload.published_at && String(payload.published_at).trim()
          ? new Date(String(payload.published_at)).toISOString()
          : status === "published"
            ? new Date().toISOString()
            : null,
    },
  };
}

function toResponseError(error: unknown) {
  if (error instanceof Response) return error;
  return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
}

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as { runtime?: { env?: RuntimeEnv } }).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const auth = await requireModerator(request, env);
    const url = new URL(request.url);
    const status = String(url.searchParams.get("status") ?? "all").trim() as "all" | NewsStatus;
    const category = String(url.searchParams.get("category") ?? "all").trim() as "all" | NewsCategoryKey;
    const search = String(url.searchParams.get("search") ?? "").trim();
    const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "80", 10);
    const slug = String(url.searchParams.get("slug") ?? "").trim();

    if (slug) {
      const article = await getAdminNewsArticleBySlug(auth.client, slug);
      return jsonResponse({ ok: true, article });
    }

    const articles = await listAdminNewsArticles(auth.client, {
      status,
      category,
      search,
      limit: Number.isFinite(limitParam) ? limitParam : 80,
    });

    return jsonResponse({ ok: true, articles });
  } catch (error) {
    return toResponseError(error);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as { runtime?: { env?: RuntimeEnv } }).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const auth = await requireModerator(request, env);
    const payload = (await request.json().catch(() => null)) as NewsPayload | null;
    if (!payload) return jsonResponse({ error: "Invalid JSON payload" }, 400);

    const validation = validatePayload(payload);
    if (!validation.ok) return jsonResponse({ error: validation.error }, 400);

    const insertPayload = {
      ...validation.value,
      author_id: auth.user.id,
    };

    const result = await auth.client
      .from("news_articles")
      .insert(insertPayload)
      .select("*")
      .single();

    if (result.error) {
      return jsonResponse({ error: result.error.message }, 500);
    }

    return jsonResponse({ ok: true, article: result.data }, 201);
  } catch (error) {
    return toResponseError(error);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as { runtime?: { env?: RuntimeEnv } }).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const auth = await requireModerator(request, env);
    const payload = (await request.json().catch(() => null)) as NewsPayload | null;
    if (!payload?.id) return jsonResponse({ error: "Missing article id" }, 400);

    const validation = validatePayload(payload);
    if (!validation.ok) return jsonResponse({ error: validation.error }, 400);

    const result = await auth.client
      .from("news_articles")
      .update({
        ...validation.value,
        author_id: auth.user.id,
      })
      .eq("id", payload.id)
      .select("*")
      .single();

    if (result.error) {
      return jsonResponse({ error: result.error.message }, 500);
    }

    return jsonResponse({ ok: true, article: result.data });
  } catch (error) {
    return toResponseError(error);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as { runtime?: { env?: RuntimeEnv } }).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const auth = await requireModerator(request, env);
    const url = new URL(request.url);
    const id = String(url.searchParams.get("id") ?? "").trim();
    if (!id) return jsonResponse({ error: "Missing article id" }, 400);

    const result = await auth.client
      .from("news_articles")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (result.error) {
      return jsonResponse({ error: result.error.message }, 500);
    }

    return jsonResponse({ ok: true, id: result.data?.id ?? id });
  } catch (error) {
    return toResponseError(error);
  }
};
