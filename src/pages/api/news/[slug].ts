import type { APIRoute } from "astro";
import {
  getPublicNewsArticleBySlug,
  isValidNewsSlug,
  listRelatedPublicNews,
} from "../../../lib/news";
import { createSSRClient, type CloudflareEnv } from "../../../lib/supabase-server";

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

const MAX_PUBLIC_NEWS_SLUG_LENGTH = 96;

export function parsePublicNewsSlug(value: string | undefined): string | null {
  const raw = String(value ?? "");
  if (!raw || raw.length > MAX_PUBLIC_NEWS_SLUG_LENGTH) return null;

  let slug: string;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    return null;
  }

  if (
    slug.length === 0 ||
    slug.length > MAX_PUBLIC_NEWS_SLUG_LENGTH ||
    /[\u0000-\u001f\u007f/\\]/.test(slug) ||
    !isValidNewsSlug(slug)
  ) {
    return null;
  }

  return slug;
}

type NewsDetailDependencies = {
  createSSRClient: typeof createSSRClient;
  getPublicNewsArticleBySlug: typeof getPublicNewsArticleBySlug;
  listRelatedPublicNews: typeof listRelatedPublicNews;
};

const productionDependencies: NewsDetailDependencies = {
  createSSRClient,
  getPublicNewsArticleBySlug,
  listRelatedPublicNews,
};

export function createPublicNewsDetailGet(dependencies: NewsDetailDependencies = productionDependencies): APIRoute {
  return async ({ params, locals }) => {
    const env = (locals as { runtime?: { env?: Partial<CloudflareEnv> } }).runtime?.env;
    if (!env?.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ error: "NEWS_UNAVAILABLE" }, 500);

    const slug = parsePublicNewsSlug(params.slug);
    if (!slug) return json({ error: "NEWS_NOT_FOUND" }, 404);

    try {
      const client = dependencies.createSSRClient(env as CloudflareEnv);
      const article = await dependencies.getPublicNewsArticleBySlug(client, slug);
      if (!article) return json({ error: "NEWS_NOT_FOUND" }, 404);

      const related = await dependencies.listRelatedPublicNews(client, {
        category: article.category,
        excludeSlug: article.slug,
        limit: 4,
      });

      return json({ ok: true, article, related });
    } catch {
      return json({ error: "NEWS_DETAIL_FETCH_FAILED" }, 500);
    }
  };
}

export const GET: APIRoute = createPublicNewsDetailGet();
