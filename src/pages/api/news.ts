import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import {
  listPublicNewsFeed,
  parseNewsFilter,
} from "../../lib/news";

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

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const env = runtimeEnv;
    if (!env) return json({ error: "Runtime environment not available" }, 500);

    const client = createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_ANON_KEY"));
    const url = new URL(request.url);
    const category = parseNewsFilter(url.searchParams.get("category"));
    const pageParam = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
    const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "5", 10);

    const payload = await listPublicNewsFeed(client, {
      filter: category,
      page: Number.isFinite(pageParam) ? pageParam : 1,
      limit: Number.isFinite(limitParam) ? limitParam : 5,
    });

    return json({
      ok: true,
      category,
      ...payload,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "NEWS_FETCH_FAILED" }, 500);
  }
};
