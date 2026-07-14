import type { APIRoute } from "astro";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildProfileHref } from "../../../../lib/profile-links";
import { isProfileMediaPathForUser, resolveProfileAvatarUrl } from "../../../../lib/profile-media";

export const prerender = false;

type RuntimeEnv = Record<string, string | undefined>;
type SummaryProfile = { id: string; username: string | null; display_name: string | null; avatar_url: string | null };
type SummaryAuth = { client: SupabaseClient; userId: string };
type SummaryDependencies = {
  authenticate?: (request: Request, env: RuntimeEnv) => Promise<SummaryAuth | { error: Response }>;
  loadProfile?: (client: SupabaseClient, userId: string) => Promise<SummaryProfile | null>;
  countPostLikes?: (client: SupabaseClient, authorId: string) => Promise<{ postCount: number; likeCount: number }>;
  countCommentLikes?: (client: SupabaseClient, authorId: string) => Promise<number>;
  resolveAvatar?: (client: SupabaseClient, profile: SummaryProfile) => Promise<string | null>;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function hasRuntimeBindings(env: RuntimeEnv | undefined): env is RuntimeEnv & { SUPABASE_URL: string; SUPABASE_ANON_KEY: string } {
  return Boolean(env?.SUPABASE_URL && env.SUPABASE_ANON_KEY);
}

export function getBearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  const match = value?.match(/^Bearer ([^\s]+)$/i);
  return match?.[1] ?? null;
}

function createUserClient(env: RuntimeEnv & { SUPABASE_URL: string; SUPABASE_ANON_KEY: string }, token: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authenticate(request: Request, env: RuntimeEnv): Promise<SummaryAuth | { error: Response }> {
  const token = getBearerToken(request);
  if (!token) return { error: json({ ok: false, error: "NOT_AUTHENTICATED" }, 401) };
  const client = createUserClient(env as RuntimeEnv & { SUPABASE_URL: string; SUPABASE_ANON_KEY: string }, token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user?.id) return { error: json({ ok: false, error: "NOT_AUTHENTICATED" }, 401) };
  return { client, userId: data.user.id };
}

async function loadProfile(client: SupabaseClient, userId: string): Promise<SummaryProfile | null> {
  const { data, error } = await client
    .from("profiles")
    .select("id,username,display_name,avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as SummaryProfile;
}

async function countPostLikes(client: SupabaseClient, authorId: string): Promise<{ postCount: number; likeCount: number }> {
  const [posts, likes] = await Promise.all([
    client.from("posts").select("id", { count: "exact", head: true }).eq("author_id", authorId).eq("status", "published").eq("moderation_status", "published"),
    client.from("post_votes").select("post_id,posts!inner(id)", { count: "exact", head: true }).eq("vote", 1).eq("posts.author_id", authorId).eq("posts.status", "published").eq("posts.moderation_status", "published"),
  ]);
  if (posts.error || likes.error) throw new Error("SUMMARY_AGGREGATION_FAILED");
  return { postCount: posts.count ?? 0, likeCount: likes.count ?? 0 };
}

async function countCommentLikes(client: SupabaseClient, authorId: string): Promise<number> {
  const { count, error } = await client
    .from("comment_reactions")
    .select("comment_id,comments!inner(id,posts:post_id!inner(id))", { count: "exact", head: true })
    .eq("reaction_type", "like")
    .eq("comments.author_id", authorId)
    .eq("comments.status", "published")
    .eq("comments.moderation_status", "published")
    .eq("comments.posts.status", "published")
    .eq("comments.posts.moderation_status", "published");
  if (error) throw new Error("SUMMARY_AGGREGATION_FAILED");
  return count ?? 0;
}

async function resolveAvatar(client: SupabaseClient, profile: SummaryProfile) {
  if (!isProfileMediaPathForUser(profile.avatar_url, profile.id, "avatar")) return null;
  return resolveProfileAvatarUrl(client, profile.avatar_url, undefined, { publicProxyUserId: profile.id });
}

function isAuthenticationFailure(value: SummaryAuth | { error: Response }): value is { error: Response } {
  return "error" in value;
}

function summaryResponse(profile: SummaryProfile, avatarResolvedUrl: string | null, postCount: number, receivedLikeCount: number) {
  return {
    ok: true,
    profile: {
      id: profile.id,
      username: profile.username,
      display_name: profile.display_name,
      profile_href: buildProfileHref(profile),
      avatar_resolved_url: avatarResolvedUrl,
    },
    stats: { post_count: postCount, received_like_count: receivedLikeCount },
  };
}

export function createSummaryGet(dependencies: SummaryDependencies = {}): APIRoute {
  return async ({ request, locals }) => {
    const env = (locals as { runtime?: { env?: RuntimeEnv } }).runtime?.env;
    if (!hasRuntimeBindings(env)) return json({ ok: false, error: "SUMMARY_UNAVAILABLE" }, 503);

    try {
      const auth = await (dependencies.authenticate ?? authenticate)(request, env);
      if (isAuthenticationFailure(auth)) return auth.error;
      const profile = await (dependencies.loadProfile ?? loadProfile)(auth.client, auth.userId);
      if (!profile || profile.id !== auth.userId) return json({ ok: false, error: "PROFILE_NOT_FOUND" }, 404);

      const [avatarResolvedUrl, postStats, commentLikeCount] = await Promise.all([
        (dependencies.resolveAvatar ?? resolveAvatar)(auth.client, profile),
        (dependencies.countPostLikes ?? countPostLikes)(auth.client, auth.userId),
        (dependencies.countCommentLikes ?? countCommentLikes)(auth.client, auth.userId),
      ]);
      return json(summaryResponse(profile, avatarResolvedUrl, postStats.postCount, postStats.likeCount + commentLikeCount));
    } catch {
      return json({ ok: false, error: "SUMMARY_FAILED" }, 500);
    }
  };
}

export const GET: APIRoute = createSummaryGet();
export const ALL: APIRoute = () => json({ error: "Method not allowed" }, 405);
