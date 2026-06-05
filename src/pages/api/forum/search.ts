import type { APIRoute } from "astro";
import { createSSRClient } from "../../../lib/supabase-server";
import { runForumSearch } from "../../../lib/forum-search";

export const prerender = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as { runtime?: { env?: Record<string, string | undefined> } }).runtime?.env;
  if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
    return json({ error: "SEARCH_FAILED" }, 500);
  }

  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") ?? "");
  const type = url.searchParams.get("type");

  const supabase = createSSRClient({
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
  });

  const result = await runForumSearch(supabase, {
    query: q,
    type: type === "posts" || type === "circles" || type === "all" ? type : "all",
  });

  if (!result.ok) {
    const status = result.error === "INVALID_QUERY" ? 400 : 500;
    return json({ error: result.error }, status);
  }

  return json(result.results);
};

export const ALL: APIRoute = () => json({ error: "Method not allowed" }, 405);
