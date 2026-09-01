import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { getPublicNewsArticleBySlug, listRelatedPublicNews } from "../../../lib/news";

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

function requireEnv(env: Record<string, string | undefined>, key: string) {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

export const GET: APIRoute = async ({ params, locals }) => {
  try {
    const env = runtimeEnv;
    if (!env) return json({ error: "Runtime environment not available" }, 500);

    const slug = String(params.slug ?? "").trim();
    if (!slug) return json({ error: "Invalid slug" }, 400);

    const client = createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_ANON_KEY"));
    const article = await getPublicNewsArticleBySlug(client, slug);
    if (!article) return json({ error: "Not found" }, 404);

    const related = await listRelatedPublicNews(client, {
      category: article.category,
      excludeSlug: article.slug,
      limit: 4,
    });

    return json({
      ok: true,
      article,
      related,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "NEWS_DETAIL_FETCH_FAILED" }, 500);
  }
};
