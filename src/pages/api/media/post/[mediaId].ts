import type { APIRoute } from "astro";
import { env as runtimeEnv } from "cloudflare:workers";
import { createSSRClient, type CloudflareEnv } from "../../../../lib/supabase-server";
import { streamStorageObjectViaSignedUrl } from "../../../../lib/media-proxy";

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

export const GET: APIRoute = async ({ params, request, locals }) => {
  const mediaId = String(params.mediaId ?? "").trim();
  if (!mediaId) return json({ error: "MEDIA_NOT_FOUND" }, 404);

  const env = runtimeEnv as CloudflareEnv;
  const supabase = createSSRClient(env);
  const variant = new URL(request.url).searchParams.get("variant") === "thumb" ? "thumb" : "display";

  const { data, error } = await supabase
    .from("post_media")
    .select("id, kind, url, storage_path, thumbnail_url, posts:post_id(status, moderation_status)")
    .eq("id", mediaId)
    .maybeSingle();

  if (error || !data) return json({ error: "MEDIA_NOT_FOUND" }, 404);

  const post = Array.isArray(data.posts) ? data.posts[0] : data.posts;
  if (!post || post.status !== "published" || post.moderation_status !== "published") {
    return json({ error: "MEDIA_NOT_FOUND" }, 404);
  }

  const thumbnailPath = String(data.thumbnail_url ?? "").trim();
  const storagePath = String(data.storage_path ?? "").trim();
  const path = variant === "thumb" ? (thumbnailPath || storagePath) : storagePath;

  if (!path) {
    const fallbackUrl = String(data.url ?? "").trim();
    if (!fallbackUrl) return json({ error: "MEDIA_NOT_FOUND" }, 404);
    return Response.redirect(fallbackUrl, 307);
  }

  const primaryResponse = await streamStorageObjectViaSignedUrl({
    client: supabase,
    path,
    cacheSeconds: 300,
  });

  if (
    variant === "thumb" &&
    primaryResponse.status >= 400 &&
    thumbnailPath &&
    storagePath &&
    thumbnailPath !== storagePath
  ) {
    return streamStorageObjectViaSignedUrl({
      client: supabase,
      path: storagePath,
      cacheSeconds: 300,
    });
  }

  return primaryResponse;
};

export const ALL: APIRoute = () => json({ error: "Method not allowed" }, 405);
