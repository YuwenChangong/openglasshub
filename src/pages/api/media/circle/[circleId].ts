import type { APIRoute } from "astro";
import { createSSRClient, type CloudflareEnv } from "../../../../lib/supabase-server";
import {
  CIRCLE_COVER_BUCKET,
  isCircleCoverPath,
} from "../../../../lib/circle-cover";
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

export const GET: APIRoute = async ({ params, locals }) => {
  const circleId = String(params.circleId ?? "").trim();
  if (!circleId) return json({ error: "MEDIA_NOT_FOUND" }, 404);

  const env = locals.runtime.env as CloudflareEnv;
  const supabase = createSSRClient(env);

  const { data, error } = await supabase
    .from("circles")
    .select("image_path,status")
    .eq("id", circleId)
    .maybeSingle();

  if (error || !data) return json({ error: "MEDIA_NOT_FOUND" }, 404);
  if (data.status && data.status !== "active") return json({ error: "MEDIA_NOT_FOUND" }, 404);
  if (!isCircleCoverPath(data.image_path)) return json({ error: "MEDIA_NOT_FOUND" }, 404);

  return streamStorageObjectViaSignedUrl({
    client: supabase,
    bucket: CIRCLE_COVER_BUCKET,
    path: data.image_path,
    cacheSeconds: 300,
  });
};

export const ALL: APIRoute = () => json({ error: "Method not allowed" }, 405);
