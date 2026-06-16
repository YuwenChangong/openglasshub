import type { APIRoute } from "astro";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getProfileById } from "../../../../lib/profile-data";
import { buildProfileHref } from "../../../../lib/profile-links";
import { resolveProfileAvatarUrl } from "../../../../lib/profile-media";

export const prerender = false;

type RuntimeEnv = Record<string, string | undefined>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function requireEnv(env: RuntimeEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

function createUserClient(env: RuntimeEnv, bearerToken: string): SupabaseClient {
  return createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_ANON_KEY"), {
    global: {
      headers: { Authorization: `Bearer ${bearerToken}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isMissingCommentReactionsError(error?: { message?: string | null } | null) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes("comment_reactions") &&
    (message.includes("does not exist") || message.includes("schema cache") || message.includes("relation"))
  );
}

async function countPostLikes(client: SupabaseClient, authorId: string): Promise<{ postCount: number; likeCount: number }> {
  const { data: posts, error: postsError, count: postCount } = await client
    .from("posts")
    .select("id", { count: "exact" })
    .eq("author_id", authorId)
    .eq("status", "published");

  if (postsError) {
    throw postsError;
  }

  const postIds = ((posts as Array<{ id: string }> | null) ?? []).map((post) => post.id);
  if (postIds.length === 0) {
    return { postCount: postCount ?? 0, likeCount: 0 };
  }

  const { count, error } = await client
    .from("post_votes")
    .select("post_id", { count: "exact", head: true })
    .in("post_id", postIds)
    .eq("vote", 1);

  if (error) {
    throw error;
  }

  return {
    postCount: postCount ?? postIds.length,
    likeCount: count ?? 0,
  };
}

async function countCommentLikes(client: SupabaseClient, authorId: string): Promise<number> {
  const { data: comments, error: commentsError } = await client
    .from("comments")
    .select("id,posts:post_id!inner(id)")
    .eq("author_id", authorId)
    .eq("status", "published")
    .eq("posts.status", "published");

  if (commentsError) {
    if (isMissingCommentReactionsError(commentsError)) return 0;
    throw commentsError;
  }

  const commentIds = ((comments as Array<{ id: string }> | null) ?? []).map((comment) => comment.id);
  if (commentIds.length === 0) return 0;

  const { count, error } = await client
    .from("comment_reactions")
    .select("comment_id", { count: "exact", head: true })
    .in("comment_id", commentIds)
    .eq("reaction_type", "like");

  if (error) {
    if (isMissingCommentReactionsError(error)) return 0;
    throw error;
  }

  return count ?? 0;
}

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as { runtime?: { env?: RuntimeEnv } }).runtime?.env;
    if (!env) return json({ ok: false, error: "Runtime environment not available" }, 500);

    const token = getBearerToken(request);
    if (!token) return json({ ok: false, error: "NOT_AUTHENTICATED" }, 401);

    const client = createUserClient(env, token);
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user) {
      return json({ ok: false, error: "NOT_AUTHENTICATED" }, 401);
    }

    const profile = await getProfileById(client, authData.user.id);
    if (!profile) {
      return json({ ok: false, error: "PROFILE_NOT_FOUND" }, 404);
    }

    const [avatarResolvedUrl, postStats, commentLikeCount] = await Promise.all([
      resolveProfileAvatarUrl(client, profile.avatar_url),
      countPostLikes(client, profile.id),
      countCommentLikes(client, profile.id),
    ]);

    return json({
      ok: true,
      profile: {
        id: profile.id,
        username: profile.username,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        role: profile.role,
        profile_href: buildProfileHref(profile),
        avatar_resolved_url: avatarResolvedUrl,
      },
      stats: {
        post_count: postStats.postCount,
        received_like_count: postStats.likeCount + commentLikeCount,
      },
    });
  } catch (error) {
    console.warn("[header-user-menu] summary failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ ok: false, error: "SUMMARY_FAILED" }, 500);
  }
};

export const ALL: APIRoute = () => json({ error: "Method not allowed" }, 405);
