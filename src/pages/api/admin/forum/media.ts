import type { APIRoute } from "astro";
import { deleteMediaObject } from "../../../../lib/server/media-cleanup";
import { jsonResponse, requireModerator, type RuntimeEnv } from "../../../../lib/server/admin-auth";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const { client } = await requireModerator(request, env);
    const url = new URL(request.url);

    const kind = String(url.searchParams.get("kind") ?? "all").trim();
    const unbound = url.searchParams.get("unbound") === "1";
    const large = url.searchParams.get("large") === "1";
    const recent = String(url.searchParams.get("recent") ?? "").trim();
    const limitRaw = Number.parseInt(String(url.searchParams.get("limit") ?? "100"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 100;

    let query = client
      .from("post_media")
      .select("id,post_id,user_id,kind,size_bytes,mime_type,storage_path,url,width,height,duration_seconds,created_at,posts:post_id(id,status)")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (kind === "video" || kind === "image") {
      query = query.eq("kind", kind);
    }
    if (recent === "24h") {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      query = query.gte("created_at", since);
    }

    const { data, error } = await query;
    if (error) return jsonResponse({ error: error.message }, 500);

    const mapped = (data ?? []).map((row) => {
      const postStatus = row.posts?.status ?? null;
      const isBoundToPost = Boolean(row.post_id && postStatus && postStatus !== "deleted");
      return {
        id: row.id,
        post_id: row.post_id,
        user_id: row.user_id,
        kind: row.kind,
        size_bytes: row.size_bytes,
        mime_type: row.mime_type,
        storage_path: row.storage_path,
        url: row.url,
        width: row.width,
        height: row.height,
        duration_seconds: row.duration_seconds,
        created_at: row.created_at,
        is_bound_to_post: isBoundToPost,
        post_status: postStatus,
      };
    });

    const filtered = mapped.filter((row) => {
      if (unbound && row.is_bound_to_post) return false;
      if (large && Number(row.size_bytes ?? 0) < 52_428_800) return false;
      return true;
    });

    return jsonResponse({ media: filtered });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const { client } = await requireModerator(request, env);
    const url = new URL(request.url);
    const mediaId = String(url.searchParams.get("id") ?? "").trim();
    if (!uuidRegex.test(mediaId)) return jsonResponse({ error: "Invalid media id" }, 400);

    const { data: media, error: mediaError } = await client
      .from("post_media")
      .select("id,kind,storage_path,url")
      .eq("id", mediaId)
      .maybeSingle();

    if (mediaError) return jsonResponse({ error: mediaError.message }, 500);
    if (!media) return jsonResponse({ error: "Media not found" }, 404);

    const deletion = await deleteMediaObject({ env, client, media });
    if (!deletion.ok) {
      return jsonResponse({ error: "MEDIA_DELETE_STORAGE_FAILED", details: deletion.failures }, 500);
    }

    const { error: deleteError } = await client.from("post_media").delete().eq("id", mediaId);
    if (deleteError) return jsonResponse({ error: deleteError.message }, 500);

    return jsonResponse({ ok: true, id: mediaId, warnings: deletion.warnings });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
