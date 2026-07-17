import type { SupabaseClient } from "@supabase/supabase-js";
import { isPublicVisibleCircle } from "./site-navigation";

const CIRCLE_COVER_BUCKET = "post-media";
const CIRCLE_COVER_PREFIX = "circle-covers/";
const CIRCLE_COVER_EXPIRES_IN = 10 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CIRCLE_COVER_PATH_PATTERN = /^circle-covers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[1-9][0-9]{0,12}-[a-z0-9._-]{1,240}$/i;

type PublicCircleCoverRow = {
  id: string;
  slug?: string | null;
  name?: string | null;
  status?: string | null;
  image_path?: string | null;
};

export function buildCircleCoverProxyUrl(circleId: string) {
  return `/api/media/circle/${encodeURIComponent(circleId)}`;
}

export function isCircleCoverPath(imagePath?: string | null): imagePath is string {
  return typeof imagePath === "string" && CIRCLE_COVER_PATH_PATTERN.test(imagePath);
}

export function isCircleId(circleId?: string | null): circleId is string {
  return typeof circleId === "string" && UUID_PATTERN.test(circleId);
}

export async function resolvePublicCircleCoverTarget(
  supabase: SupabaseClient,
  circleId: string,
): Promise<{ circleId: string; imagePath: string } | null> {
  const normalizedCircleId = circleId.trim().toLowerCase();
  if (!isCircleId(normalizedCircleId)) return null;

  const { data, error } = await supabase
    .from("circles")
    .select("id,slug,name,status,image_path")
    .eq("id", normalizedCircleId)
    .maybeSingle();
  const circle = data as PublicCircleCoverRow | null;

  if (error || !circle || circle.id !== normalizedCircleId) return null;
  if (circle.status?.toLowerCase() !== "active") return null;
  if (!isPublicVisibleCircle(circle)) return null;
  if (!isCircleCoverPath(circle.image_path)) return null;

  return { circleId: circle.id, imagePath: circle.image_path };
}

export async function resolveCircleCoverUrl(
  supabase: SupabaseClient,
  imagePath?: string | null,
  expiresIn = CIRCLE_COVER_EXPIRES_IN,
  options?: { publicProxyCircleId?: string | null },
): Promise<string | null> {
  if (!isCircleCoverPath(imagePath)) {
    return null;
  }
  if (options?.publicProxyCircleId) {
    return buildCircleCoverProxyUrl(options.publicProxyCircleId);
  }

  const { data, error } = await supabase.storage.from(CIRCLE_COVER_BUCKET).createSignedUrl(imagePath, expiresIn);
  if (error || !data?.signedUrl) {
    console.warn("[circle-cover] createSignedUrl failed", imagePath, error?.message ?? "missing signed url");
    return null;
  }

  return data.signedUrl;
}

export async function buildCircleCoverUrlMap(
  supabase: SupabaseClient,
  circles: Array<{ id: string; image_path?: string | null }>,
  expiresIn = CIRCLE_COVER_EXPIRES_IN,
  options?: { publicProxy?: boolean },
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  await Promise.all(
    circles.map(async (circle) => {
      const signedUrl = await resolveCircleCoverUrl(supabase, circle.image_path, expiresIn, {
        publicProxyCircleId: options?.publicProxy ? circle.id : null,
      });
      if (signedUrl) {
        map.set(circle.id, signedUrl);
      }
    }),
  );

  return map;
}

export { CIRCLE_COVER_BUCKET, CIRCLE_COVER_EXPIRES_IN, CIRCLE_COVER_PREFIX };
