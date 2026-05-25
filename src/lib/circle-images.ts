import type { SupabaseClient } from "@supabase/supabase-js";

export interface CircleImageRow {
  id: string;
  image_path?: string | null;
}

export async function buildCircleImageMap(
  supabase: SupabaseClient,
  circles: CircleImageRow[],
  expiresIn = 60 * 60,
): Promise<Map<string, string>> {
  const imageMap = new Map<string, string>();
  const rowsWithImage = circles.filter((circle) => circle.image_path);
  const paths = rowsWithImage.map((circle) => circle.image_path as string);

  const { data: signedUrls } = paths.length
    ? await supabase.storage.from("post-media").createSignedUrls(paths, expiresIn)
    : { data: [] as Array<{ signedUrl?: string }> };

  rowsWithImage.forEach((circle, index) => {
    imageMap.set(circle.id, signedUrls?.[index]?.signedUrl ?? "");
  });

  return imageMap;
}
