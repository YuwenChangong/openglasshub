import type { APIRoute } from "astro";
import { env as runtimeEnv } from "cloudflare:workers";
import { createSSRClient, type CloudflareEnv } from "../../../../lib/supabase-server";
import {
  CIRCLE_COVER_BUCKET,
  resolvePublicCircleCoverTarget,
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

  const env = runtimeEnv as CloudflareEnv;
  const supabase = createSSRClient(env);

  const coverTarget = await resolvePublicCircleCoverTarget(supabase, circleId);
  if (!coverTarget) return json({ error: "MEDIA_NOT_FOUND" }, 404);

  return streamStorageObjectViaSignedUrl({
    client: supabase,
    bucket: CIRCLE_COVER_BUCKET,
    path: coverTarget.imagePath,
    cacheSeconds: 300,
  });
};

export const ALL: APIRoute = () => json({ error: "Method not allowed" }, 405);
