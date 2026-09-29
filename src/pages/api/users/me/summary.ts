import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildProfileHref } from "../../../../lib/profile-links";
import { buildProfileMediaProxyUrl, isProfileMediaPathForUser, resolveProfileAvatarUrl } from "../../../../lib/profile-media";
import type { UserSummaryFailure, UserSummaryObservation, UserSummarySuccess } from "../../../../lib/user-summary";

export const prerender = false;

type RuntimeEnv = Record<string, string | undefined>;
type SummaryProfile = { id: string; username: string | null; display_name: string | null; avatar_url: string | null };
type SummaryAuth = { client: SupabaseClient; userId: string };
type PostStats = { postCount: number | null; likeCount: number | null };
type SummaryDependencies = {
  authenticate?: (request: Request, env: RuntimeEnv) => Promise<SummaryAuth | { error: Response }>;
  loadProfile?: (client: SupabaseClient, userId: string) => Promise<SummaryProfile | null>;
  countPostLikes?: (client: SupabaseClient, authorId: string, signal?: AbortSignal) => Promise<PostStats>;
  countCommentLikes?: (client: SupabaseClient, authorId: string, signal?: AbortSignal) => Promise<number | null>;
  resolveAvatar?: (client: SupabaseClient, profile: SummaryProfile) => Promise<string | null>;
  observe?: (event: UserSummaryObservation) => void;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function failure(code: UserSummaryFailure["code"], status: number): Response {
  return json({ ok: false, code } satisfies UserSummaryFailure, status);
}

function measuredCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function settleOptional<T>(read: () => PromiseLike<T | null>, deadline: Promise<null>): Promise<T | null> {
  const settled = Promise.resolve().then(read).then((value) => value, () => null);
  return Promise.race([settled, deadline]);
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
  if (!token) return { error: failure("UNAUTHORIZED", 401) };
  const client = createUserClient(env as RuntimeEnv & { SUPABASE_URL: string; SUPABASE_ANON_KEY: string }, token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user?.id) return { error: failure("UNAUTHORIZED", 401) };
  return { client, userId: data.user.id };
}

async function loadProfile(client: SupabaseClient, userId: string): Promise<SummaryProfile | null> {
  const { data, error } = await client
    .from("profiles")
    .select("id,username,display_name,avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error("SUMMARY_PROFILE_UNAVAILABLE");
  if (!data) return null;
  return data as SummaryProfile;
}

async function countPostLikes(client: SupabaseClient, authorId: string, signal: AbortSignal, deadline: Promise<null>): Promise<PostStats> {
  const postsQuery = client.from("posts").select("id", { count: "exact", head: true }).eq("author_id", authorId).eq("status", "published").eq("moderation_status", "published");
  const likesQuery = client.from("post_votes").select("post_id,posts!inner(id)", { count: "exact", head: true }).eq("vote", 1).eq("posts.author_id", authorId).eq("posts.status", "published").eq("posts.moderation_status", "published");
  const [posts, likes] = await Promise.all([
    settleOptional(() => postsQuery.abortSignal(signal), deadline),
    settleOptional(() => likesQuery.abortSignal(signal), deadline),
  ]);
  return {
    postCount: posts && !posts.error ? measuredCount(posts.count) : null,
    likeCount: likes && !likes.error ? measuredCount(likes.count) : null,
  };
}

async function countCommentLikes(client: SupabaseClient, authorId: string, signal?: AbortSignal): Promise<number | null> {
  const query = client
    .from("comment_reactions")
    .select("comment_id,comments!inner(id,posts:post_id!inner(id))", { count: "exact", head: true })
    .eq("reaction_type", "like")
    .eq("comments.author_id", authorId)
    .eq("comments.status", "published")
    .eq("comments.moderation_status", "published")
    .eq("comments.posts.status", "published")
    .eq("comments.posts.moderation_status", "published");
  const { count, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw new Error("SUMMARY_AGGREGATION_FAILED");
  return measuredCount(count);
}

async function resolveAvatar(client: SupabaseClient, profile: SummaryProfile) {
  if (!isProfileMediaPathForUser(profile.avatar_url, profile.id, "avatar")) return null;
  return resolveProfileAvatarUrl(client, profile.avatar_url, undefined, { publicProxyUserId: profile.id });
}

function isAuthenticationFailure(value: SummaryAuth | { error: Response }): value is { error: Response } {
  return "error" in value;
}

function summaryResponse(profile: SummaryProfile, avatarResolvedUrl: string | null, postCount: number | null, receivedLikeCount: number | null, availability: UserSummarySuccess["availability"]): UserSummarySuccess {
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
    availability,
  };
}

export function createSummaryGet(dependencies: SummaryDependencies = {}): APIRoute {
  return async ({ request }) => {
    const observe = (stage: UserSummaryObservation["stage"], status: UserSummaryObservation["status"], started: number) => {
      try { dependencies.observe?.({ stage, status, durationMs: Math.max(0, performance.now() - started) }); } catch { /* Diagnostics must not affect the response. */ }
    };
    const env = runtimeEnv;
    const authStarted = performance.now();
    if (!hasRuntimeBindings(env)) {
      observe("auth", "unavailable", authStarted);
      return failure("PROFILE_UNAVAILABLE", 503);
    }

    let auth: SummaryAuth;
    try {
      const result = await (dependencies.authenticate ?? authenticate)(request, env);
      if (isAuthenticationFailure(result)) {
        observe("auth", "unavailable", authStarted);
        return failure("UNAUTHORIZED", 401);
      }
      auth = result;
      observe("auth", "ok", authStarted);
    } catch {
      observe("auth", "unavailable", authStarted);
      return failure("UNAUTHORIZED", 401);
    }

    const profileStarted = performance.now();
    let profile: SummaryProfile;
    try {
      const result = await (dependencies.loadProfile ?? loadProfile)(auth.client, auth.userId);
      if (!result || result.id !== auth.userId) {
        observe("profile", "missing", profileStarted);
        return failure("PROFILE_NOT_FOUND", 404);
      }
      profile = result;
      observe("profile", "ok", profileStarted);
    } catch {
      observe("profile", "unavailable", profileStarted);
      return failure("PROFILE_UNAVAILABLE", 503);
    }

    const controller = new AbortController();
    let deadlineTimer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<null>((resolve) => {
      deadlineTimer = setTimeout(() => { resolve(null); controller.abort(); }, 1500);
    });
    // Bound subqueries individually so a stalled like read cannot discard a known post count.
    const optional = async <T>(stage: "avatar" | "posts" | "comments", read: () => Promise<T | null>, ready: (value: T) => boolean = () => true): Promise<T | null> => {
      const started = performance.now();
      let value: T | null;
      try { value = await read(); } catch { value = null; }
      observe(stage, value !== null && ready(value) ? "ok" : "unavailable", started);
      return value;
    };
    try {
      const [avatarResolvedUrl, postStats, commentLikeCount] = await Promise.all([
        optional("avatar", () => settleOptional(async () => {
          if (!isProfileMediaPathForUser(profile.avatar_url, profile.id, "avatar")) return null;
          const resolved = await (dependencies.resolveAvatar ?? resolveAvatar)(auth.client, profile);
          return resolved === buildProfileMediaProxyUrl(profile.id, "avatar") ? resolved : null;
        }, deadline)),
        optional("posts", async () => {
          const stats = dependencies.countPostLikes
            ? await settleOptional(() => dependencies.countPostLikes!(auth.client, auth.userId, controller.signal), deadline)
            : await countPostLikes(auth.client, auth.userId, controller.signal, deadline);
          return stats ? { postCount: measuredCount(stats.postCount), likeCount: measuredCount(stats.likeCount) } : null;
        }, (stats) => stats.postCount !== null && stats.likeCount !== null),
        optional("comments", () => settleOptional(async () => measuredCount(await (dependencies.countCommentLikes ?? countCommentLikes)(auth.client, auth.userId, controller.signal)), deadline)),
      ]);
      const postCount = postStats?.postCount ?? null;
      const postLikeCount = postStats?.likeCount ?? null;
      const receivedLikeCount = postLikeCount !== null && commentLikeCount !== null ? measuredCount(postLikeCount + commentLikeCount) : null;
      return json(summaryResponse(profile, avatarResolvedUrl, postCount, receivedLikeCount, {
        avatar: avatarResolvedUrl === null ? "unavailable" : "ready",
        posts: postCount !== null && postLikeCount !== null ? "ready" : "unavailable",
        commentLikes: commentLikeCount === null ? "unavailable" : "ready",
      }));
    } finally {
      clearTimeout(deadlineTimer!);
    }
  };
}

export const GET: APIRoute = createSummaryGet();
export const ALL: APIRoute = () => json({ error: "Method not allowed" }, 405);
