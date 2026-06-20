import type { APIRoute } from "astro";
import { createSSRClient, type CloudflareEnv } from "../../../../../lib/supabase-server";
import {
  isProfileAvatarPath,
  isProfileBannerPath,
  PROFILE_MEDIA_BUCKET,
} from "../../../../../lib/profile-media";
import { streamStorageObjectViaSignedUrl } from "../../../../../lib/media-proxy";

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
  const userId = String(params.userId ?? "").trim();
  const kind = String(params.kind ?? "").trim();
  if (!userId || (kind !== "avatar" && kind !== "banner")) {
    return json({ error: "MEDIA_NOT_FOUND" }, 404);
  }

  const env = locals.runtime.env as CloudflareEnv;
  const supabase = createSSRClient(env);

  const { data, error } = await supabase
    .from("profiles")
    .select("avatar_url, banner_url")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return json({ error: "MEDIA_NOT_FOUND" }, 404);

  const path = kind === "avatar" ? data.avatar_url : data.banner_url;
  if (kind === "avatar" && !isProfileAvatarPath(path)) return json({ error: "MEDIA_NOT_FOUND" }, 404);
  if (kind === "banner" && !isProfileBannerPath(path)) return json({ error: "MEDIA_NOT_FOUND" }, 404);

  return streamStorageObjectViaSignedUrl({
    client: supabase,
    bucket: PROFILE_MEDIA_BUCKET,
    path,
    cacheSeconds: 300,
  });
};

export const ALL: APIRoute = () => json({ error: "Method not allowed" }, 405);
