import type { SupabaseClient } from "@supabase/supabase-js";

export type PostMediaKind = "image" | "video" | "video_link";

export interface PostMediaRow {
  id: string;
  post_id?: string | null;
  kind: PostMediaKind;
  url?: string | null;
  storage_path?: string | null;
  thumbnail_url?: string | null;
  alt_text?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
}

export interface ResolvedPostMedia extends PostMediaRow {
  displayUrl: string;
  previewUrl: string;
}

type PostWithMedia = {
  id: string;
  post_media?: PostMediaRow[] | null;
};

function sortMediaRows<T extends PostMediaRow>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftOrder = Number.isFinite(left.sort_order) ? Number(left.sort_order) : 0;
    const rightOrder = Number.isFinite(right.sort_order) ? Number(right.sort_order) : 0;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    const leftCreated = left.created_at ? new Date(left.created_at).getTime() : 0;
    const rightCreated = right.created_at ? new Date(right.created_at).getTime() : 0;
    return leftCreated - rightCreated;
  });
}

export async function resolveSignedPostMedia(
  supabase: SupabaseClient,
  mediaRows: PostMediaRow[],
  expiresIn = 60 * 60,
): Promise<ResolvedPostMedia[]> {
  const sortedRows = sortMediaRows(mediaRows);
  const storagePaths = sortedRows
    .filter((item) => (item.kind === "image" || item.kind === "video") && item.storage_path)
    .map((item) => item.storage_path as string);

  const { data: signedUrls } = storagePaths.length
    ? await supabase.storage.from("post-media").createSignedUrls(storagePaths, expiresIn)
    : { data: [] as Array<{ signedUrl?: string }> };

  const signedUrlMap = new Map(
    storagePaths.map((path, index) => [path, signedUrls?.[index]?.signedUrl ?? ""]),
  );

  return sortedRows.map((item) => {
    const signedUrl =
      item.storage_path && (item.kind === "image" || item.kind === "video")
        ? signedUrlMap.get(item.storage_path) ?? ""
        : item.url?.trim() ?? "";

    return {
      ...item,
      displayUrl: signedUrl,
      previewUrl: item.thumbnail_url?.trim() || signedUrl,
    };
  });
}

export async function buildResolvedPostMediaMap(
  supabase: SupabaseClient,
  posts: PostWithMedia[],
  expiresIn = 60 * 60,
): Promise<Map<string, ResolvedPostMedia[]>> {
  const flattened = posts.flatMap((post) =>
    (post.post_media ?? []).map((item) => ({
      ...item,
      post_id: post.id,
    })),
  );

  const resolvedMedia = await resolveSignedPostMedia(supabase, flattened, expiresIn);
  const mediaMap = new Map<string, ResolvedPostMedia[]>();

  for (const item of resolvedMedia) {
    const postId = item.post_id;
    if (!postId) continue;
    const current = mediaMap.get(postId) ?? [];
    current.push(item);
    mediaMap.set(postId, current);
  }

  for (const [postId, items] of mediaMap.entries()) {
    mediaMap.set(postId, sortMediaRows(items));
  }

  return mediaMap;
}
