import type { SupabaseClient } from "@supabase/supabase-js";

export async function buildPostLikeCountMap(
  supabase: SupabaseClient,
  postIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  for (const postId of postIds) {
    counts.set(postId, 0);
  }

  if (postIds.length === 0) {
    return counts;
  }

  const { data, error } = await supabase
    .from("post_votes")
    .select("post_id")
    .in("post_id", postIds)
    .eq("vote", 1);

  if (error || !data) {
    return counts;
  }

  for (const row of data as Array<{ post_id: string | null }>) {
    if (!row.post_id) continue;
    counts.set(row.post_id, (counts.get(row.post_id) ?? 0) + 1);
  }

  return counts;
}

export async function buildPostCommentCountMap(
  supabase: SupabaseClient,
  postIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  for (const postId of postIds) {
    counts.set(postId, 0);
  }

  if (postIds.length === 0) {
    return counts;
  }

  const { data, error } = await supabase
    .from("comments")
    .select("post_id")
    .in("post_id", postIds)
    .eq("status", "published");

  if (error || !data) {
    return counts;
  }

  for (const row of data as Array<{ post_id: string | null }>) {
    if (!row.post_id) continue;
    counts.set(row.post_id, (counts.get(row.post_id) ?? 0) + 1);
  }

  return counts;
}
