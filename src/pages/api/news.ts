import type { APIRoute } from "astro";
import {
  listPublicNewsFeed,
  parseNewsFilter,
  type NewsFilterKey,
} from "../../lib/news";
import { createSSRClient, type CloudflareEnv } from "../../lib/supabase-server";

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

const MAX_PUBLIC_NEWS_LIMIT = 12;

export function parsePublicNewsPositiveInt(value: string | null, fallback: number, maximum: number) {
  if (value === null) return fallback;
  if (!/^[1-9][0-9]{0,3}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed <= maximum ? parsed : null;
}

export function parsePublicNewsQuery(url: URL): { category: NewsFilterKey; page: number; limit: number } | null {
  const rawCategory = url.searchParams.get("category");
  const category = parseNewsFilter(rawCategory);
  if (rawCategory !== null && rawCategory !== category) return null;

  const page = parsePublicNewsPositiveInt(url.searchParams.get("page"), 1, 1_000);
  const limit = parsePublicNewsPositiveInt(url.searchParams.get("limit"), 5, MAX_PUBLIC_NEWS_LIMIT);
  return page && limit ? { category, page, limit } : null;
}

type NewsApiDependencies = {
  createSSRClient: typeof createSSRClient;
  listPublicNewsFeed: typeof listPublicNewsFeed;
};

const productionDependencies: NewsApiDependencies = { createSSRClient, listPublicNewsFeed };

export function createPublicNewsGet(dependencies: NewsApiDependencies = productionDependencies): APIRoute {
  return async ({ request, locals }) => {
    const env = (locals as { runtime?: { env?: Partial<CloudflareEnv> } }).runtime?.env;
    if (!env?.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ error: "NEWS_UNAVAILABLE" }, 500);

    const query = parsePublicNewsQuery(new URL(request.url));
    if (!query) return json({ error: "INVALID_NEWS_QUERY" }, 400);

    try {
      const client = dependencies.createSSRClient(env as CloudflareEnv);
      const payload = await dependencies.listPublicNewsFeed(client, {
        filter: query.category,
        page: query.page,
        limit: query.limit,
      });

      return json({
        ok: true,
        category: query.category,
        ...payload,
      });
    } catch {
      return json({ error: "NEWS_FETCH_FAILED" }, 500);
    }
  };
}

export const GET: APIRoute = createPublicNewsGet();
