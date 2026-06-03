import type { SupabaseClient } from "@supabase/supabase-js";

type PostViewCountResult = { ok: true } | { ok: false; error: string };

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isMissingViewCountError(error: { message?: string } | null | undefined): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes("view_count") &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("column"))
  );
}

export async function safeIncrementPostViewCount(
  supabase: SupabaseClient,
  postId: string,
): Promise<PostViewCountResult> {
  const attempts = [
    { p_post_id: postId },
    { target_post_id: postId },
  ];

  let lastError = "";

  for (const params of attempts) {
    try {
      const { error } = await supabase.rpc("increment_post_view_count", params);
      if (!error) {
        return { ok: true };
      }
      lastError = error.message;
    } catch (error) {
      lastError = getErrorMessage(error);
    }
  }

  console.warn("[post-view-count] increment failed", lastError);
  return { ok: false, error: lastError || "increment_post_view_count unavailable" };
}

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
