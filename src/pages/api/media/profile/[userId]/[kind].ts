import type { APIRoute } from "astro";
import { env as runtimeEnv } from "cloudflare:workers";
import { createSSRClient, type CloudflareEnv } from "../../../../../lib/supabase-server";
import {
  isProfileMediaPathForUser,
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROFILE_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

type ProfileMediaKind = "avatar" | "banner";
type PublicProfileMediaRow = { id: string; avatar_url?: string | null; banner_url?: string | null };

export function isProfileMediaUserId(value?: string | null): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isProfileMediaKind(value?: string | null): value is ProfileMediaKind {
  return value === "avatar" || value === "banner";
}

export async function resolvePublicProfileMediaTarget(
  supabase: ReturnType<typeof createSSRClient>,
  userId: string,
  kind: ProfileMediaKind,
): Promise<string | null> {
  const normalizedUserId = userId.toLowerCase();
  if (!isProfileMediaUserId(normalizedUserId)) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id,avatar_url,banner_url")
    .eq("id", normalizedUserId)
    .maybeSingle();
  const profile = data as PublicProfileMediaRow | null;
  if (error || !profile || profile.id !== normalizedUserId) return null;

  const path = kind === "avatar" ? profile.avatar_url : profile.banner_url;
  return isProfileMediaPathForUser(path, profile.id, kind) ? path : null;
}

type ProfileMediaDependencies = {
  createSSRClient: typeof createSSRClient;
  streamStorageObjectViaSignedUrl: typeof streamStorageObjectViaSignedUrl;
};

const productionDependencies: ProfileMediaDependencies = { createSSRClient, streamStorageObjectViaSignedUrl };

export function createProfileMediaGet(dependencies: ProfileMediaDependencies = productionDependencies): APIRoute {
  return async ({ params, locals }) => {
  const userId = String(params.userId ?? "").toLowerCase();
  const kind = String(params.kind ?? "");
  if (!isProfileMediaUserId(userId) || !isProfileMediaKind(kind)) return json({ error: "MEDIA_NOT_FOUND" }, 404);

  const env = runtimeEnv as CloudflareEnv;
  const supabase = dependencies.createSSRClient(env);
  const path = await resolvePublicProfileMediaTarget(supabase, userId, kind);
  if (!path) return json({ error: "MEDIA_NOT_FOUND" }, 404);

  return dependencies.streamStorageObjectViaSignedUrl({
    client: supabase,
    bucket: PROFILE_MEDIA_BUCKET,
    path,
    cacheSeconds: 300,
    allowedContentTypes: PROFILE_IMAGE_CONTENT_TYPES,
  });
};
}

export const GET: APIRoute = createProfileMediaGet();

export const ALL: APIRoute = () => json({ error: "Method not allowed" }, 405);
