import type { APIRoute } from "astro";
import { jsonResponse, requireModerator, type RuntimeEnv } from "../../../../lib/server/admin-auth";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const { client } = await requireModerator(request, env);
    const url = new URL(request.url);
    const limitRaw = Number.parseInt(String(url.searchParams.get("limit") ?? "100"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 100;

    const { data, error } = await client
      .from("reports")
      .select("id,target_id,target_type,reporter_id,reason,status,created_at,posts:target_id(title,status)")
      .eq("target_type", "post")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return jsonResponse({ error: error.message }, 500);

    return jsonResponse({
      reports: (data ?? []).map((row) => ({
        id: row.id,
        post_id: row.target_id,
        reporter_id: row.reporter_id,
        reason: row.reason,
        status: row.status,
        created_at: row.created_at,
        post_title: row.posts?.title ?? null,
        post_status: row.posts?.status ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
