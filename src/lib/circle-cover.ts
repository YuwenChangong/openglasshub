import type { SupabaseClient } from "@supabase/supabase-js";

const CIRCLE_COVER_BUCKET = "post-media";
const CIRCLE_COVER_PREFIX = "circle-covers/";
const CIRCLE_COVER_EXPIRES_IN = 60 * 60;

export function isCircleCoverPath(imagePath?: string | null): imagePath is string {
  return typeof imagePath === "string" && imagePath.startsWith(CIRCLE_COVER_PREFIX);
}

export async function resolveCircleCoverUrl(
  supabase: SupabaseClient,
  imagePath?: string | null,
  expiresIn = CIRCLE_COVER_EXPIRES_IN,
): Promise<string | null> {
  if (!isCircleCoverPath(imagePath)) {
    return null;
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
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  await Promise.all(
    circles.map(async (circle) => {
      const signedUrl = await resolveCircleCoverUrl(supabase, circle.image_path, expiresIn);
      if (signedUrl) {
        map.set(circle.id, signedUrl);
      }
    }),
  );

  return map;
}

export { CIRCLE_COVER_BUCKET, CIRCLE_COVER_EXPIRES_IN, CIRCLE_COVER_PREFIX };
