/**
 * Forum Posts API — Astro endpoint for Cloudflare Worker.
 *
 * Migrated from functions/api/forum/posts.ts because @astrojs/cloudflare
 * emits dist/_worker.js which takes precedence over the /functions directory
 * in Cloudflare Pages advanced mode.
 *
 * Uses Cloudflare runtime env vars: SUPABASE_URL, SUPABASE_ANON_KEY.
 * Does NOT use PUBLIC_* variables or service role key.
 * RLS enforces ownership via user JWT.
 */

import type { APIRoute } from "astro";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildPostCommentCountMap,
  buildPostLikeCountMap,
  isMissingViewCountError,
  safeIncrementPostViewCount,
} from "../../../lib/post-engagement";
import { MEDIA_ONLY_SENTINEL } from "../../../lib/post-body";
import { getRequestIp } from "../../../lib/request-ip";
import { deletePostMediaObjects } from "../../../lib/server/media-cleanup";
import { enforceUserRateLimit, hashRateLimitIp } from "../../../lib/server/rate-limit";
import { validateTurnstileToken } from "../../../lib/server/turnstile";

export const prerender = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function createAnonClient(env: Record<string, string | undefined>): SupabaseClient {
  return createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_ANON_KEY"));
}

function createUserClient(
  env: Record<string, string | undefined>,
  bearerToken: string,
): SupabaseClient {
  return createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_ANON_KEY"), {
    global: {
      headers: { Authorization: `Bearer ${bearerToken}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function parseModeratorEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isMissingCircleStatusError(error: { message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes("status") && message.includes("does not exist");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ALLOWED_TYPES = new Set(["experience", "question", "review", "dev", "news", "feedback"]);

function validatePayload(payload: Record<string, unknown>): string | null {
  const circleSlug = String(payload.circle_slug ?? "").trim();
  const title = String(payload.title ?? "").trim();
  const body = String(payload.body ?? "").trim();
  const hasMedia = payload.has_media === true;
  const type = String(payload.type ?? "").trim();

  if (!circleSlug || !title || !type) {
    return "circle_slug, title, type are required";
  }
  if (title.length < 3 || title.length > 180) {
    return "title must be 3-180 characters";
  }
  if (body.length > 20000) {
    return "body must be <=20000 characters";
  }
  if (!body && !hasMedia) {
    return "body or media is required";
  }
  if (!ALLOWED_TYPES.has(type)) {
    return "Invalid post type";
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET — list published posts
// ---------------------------------------------------------------------------

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as { runtime?: { env?: Record<string, string | undefined> } }).runtime?.env;
    if (!env) {
      return json({ error: "Runtime environment not available" }, 500);
    }

    const url = new URL(request.url);
    if (url.searchParams.get("moderation_check") === "1") {
      const token = getBearerToken(request);
      if (!token) {
        return json({ error: "Missing bearer token" }, 401);
      }
      const userClient = createUserClient(env, token);
      const { data: authData, error: authError } = await userClient.auth.getUser(token);
      if (authError || !authData.user) {
        return json({ error: "Invalid auth token" }, 401);
      }
      const moderators = parseModeratorEmails(env.MODERATOR_EMAILS);
      const email = authData.user.email?.toLowerCase() ?? "";
      return json({
        configured: moderators.length > 0,
        can_moderate: moderators.length > 0 && moderators.includes(email),
      });
    }

    const ownershipCheckId = String(url.searchParams.get("ownership_check") ?? "").trim();
    if (ownershipCheckId) {
      const token = getBearerToken(request);
      if (!token) {
        return json({ error: "Missing bearer token" }, 401);
      }
      const userClient = createUserClient(env, token);
      const { data: authData, error: authError } = await userClient.auth.getUser(token);
      if (authError || !authData.user) {
        return json({ error: "Invalid auth token" }, 401);
      }
      const { data: post, error: postError } = await userClient
        .from("posts")
        .select("id,author_id")
        .eq("id", ownershipCheckId)
        .maybeSingle();
      if (postError) {
        return json({ error: postError.message }, 500);
      }
      if (!post) {
        return json({ exists: false, is_author: false }, 200);
      }
      return json({ exists: true, is_author: post.author_id === authData.user.id }, 200);
    }

    const circleSlug = url.searchParams.get("circle");
    const sort = url.searchParams.get("sort") === "hot" ? "hot" : "latest";
    const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;
    const incrementView = url.searchParams.get("increment_view") === "1";
    const incrementPostId = String(url.searchParams.get("id") ?? "").trim();

    const client = createAnonClient(env);

    if (incrementView && incrementPostId) {
      const result = await safeIncrementPostViewCount(client, incrementPostId);
      return json(result.ok ? { ok: true } : { ok: false }, 200);
    }

    const selectWithViewCount =
      "id,title,type,status,created_at,last_activity_at,view_count,circle_id,author_id,circles:circle_id(slug,name),profiles:author_id(username,display_name),post_media(*)";
    const selectWithoutViewCount =
      "id,title,type,status,created_at,last_activity_at,circle_id,author_id,circles:circle_id(slug,name),profiles:author_id(username,display_name),post_media(*)";

    let query = client
      .from("posts")
      .select(selectWithViewCount)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(sort === "hot" ? Math.min(Math.max(limit * 4, 60), 200) : limit);

    if (circleSlug) {
      let { data: circle, error: circleError } = await client
        .from("circles")
        .select("id")
        .eq("slug", circleSlug)
        .eq("status", "active")
        .maybeSingle();
      if (circleError && isMissingCircleStatusError(circleError)) {
        const fallback = await client
          .from("circles")
          .select("id")
          .eq("slug", circleSlug)
          .maybeSingle();
        circle = fallback.data;
        circleError = fallback.error;
      }
      if (circleError) {
        return json({ error: circleError.message }, 500);
      }
      if (!circle) {
        return json({ posts: [], total: 0 }, 200);
      }
      query = query.eq("circle_id", circle.id);
    }

    let supportsViewCount = true;
    let { data, error } = await query;
    if (error && isMissingViewCountError(error)) {
      console.warn("[forum-posts-api] view_count unavailable, falling back", error.message);
      supportsViewCount = false;
      let fallbackQuery = client
        .from("posts")
        .select(selectWithoutViewCount)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(sort === "hot" ? Math.min(Math.max(limit * 4, 60), 200) : limit);

      if (circleSlug) {
        let { data: circle, error: circleError } = await client.from("circles").select("id").eq("slug", circleSlug).eq("status", "active").maybeSingle();
        if (circleError && isMissingCircleStatusError(circleError)) {
          const fallback = await client.from("circles").select("id").eq("slug", circleSlug).maybeSingle();
          circle = fallback.data;
        }
        if (circle) {
          fallbackQuery = fallbackQuery.eq("circle_id", circle.id);
        }
      }

      const fallbackResult = await fallbackQuery;
      data = fallbackResult.data;
      error = fallbackResult.error;
    }
    if (error) {
      return json({ error: error.message }, 500);
    }

    let posts = data ?? [];
    if (sort === "hot" && posts.length > 0) {
      const postIds = posts.map((post) => post.id);
      const [likeCountMap, commentCountMap] = await Promise.all([
        buildPostLikeCountMap(client, postIds),
        buildPostCommentCountMap(client, postIds),
      ]);

      posts = [...posts]
        .sort((left, right) => {
          const leftScore =
            (commentCountMap.get(left.id) ?? 0) * 3 +
            (likeCountMap.get(left.id) ?? 0) * 2 +
            Number(supportsViewCount ? left.view_count ?? 0 : 0);
          const rightScore =
            (commentCountMap.get(right.id) ?? 0) * 3 +
            (likeCountMap.get(right.id) ?? 0) * 2 +
            Number(supportsViewCount ? right.view_count ?? 0 : 0);

          if (rightScore !== leftScore) return rightScore - leftScore;
          return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
        })
        .slice(0, limit);
    }

    return json({ posts, total: posts.length, sort, supports_view_count: supportsViewCount });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Unexpected server error" },
      500,
    );
  }
};

// ---------------------------------------------------------------------------
// POST — create a post (requires auth)
// ---------------------------------------------------------------------------

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as { runtime?: { env?: Record<string, string | undefined> } }).runtime?.env;
    if (!env) {
      return json({ error: "Runtime environment not available" }, 500);
    }

    const token = getBearerToken(request);
    if (!token) {
      return json({ error: "Missing bearer token" }, 401);
    }

    const userClient = createUserClient(env, token);
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) {
      return json({ error: "Invalid auth token" }, 401);
    }

    const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload) {
      return json({ error: "Invalid JSON payload" }, 400);
    }

    const validationError = validatePayload(payload);
    if (validationError) {
      return json({ error: validationError }, 400);
    }
    const turnstileToken = String(payload.turnstile_token ?? "").trim();
    const turnstile = await validateTurnstileToken({
      env,
      token: turnstileToken,
      remoteIp: getRequestIp(request),
    });
    if (!turnstile.ok) {
      return json({ error: turnstile.message ?? "Turnstile verification failed", code: turnstile.code }, 403);
    }
    const rateSalt = requireEnv(env, "RATE_LIMIT_SALT");
    const ipHash = await hashRateLimitIp(getRequestIp(request), rateSalt);
    const rateLimit = await enforceUserRateLimit({
      client: userClient,
      userId: authData.user.id,
      ipHash,
      purpose: "post_create",
      maxAttempts: 10,
      windowMs: 60 * 60 * 1000,
    });
    if (!rateLimit.ok) {
      if (rateLimit.error === "RATE_LIMITED") {
        return json({ error: "Too many posts created", code: "RATE_LIMITED" }, 429);
      }
      return json({ error: rateLimit.error }, 500);
    }

    const circleSlug = String(payload.circle_slug ?? "").trim();
    const title = String(payload.title ?? "").trim();
    const body = String(payload.body ?? "").trim();
    const hasMedia = payload.has_media === true;
    const normalizedBody = body || (hasMedia ? MEDIA_ONLY_SENTINEL : "");
    const type = String(payload.type ?? "").trim();

    // Verify profile exists
    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("id")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (profileError) {
      return json({ error: profileError.message }, 500);
    }
    if (!profile) {
      return json({ error: "Profile not found for current user" }, 403);
    }

    // Resolve circle
    let { data: circle, error: circleError } = await userClient
      .from("circles")
      .select("id")
      .eq("slug", circleSlug)
      .eq("status", "active")
      .maybeSingle();
    if (circleError && isMissingCircleStatusError(circleError)) {
      const fallback = await userClient
        .from("circles")
        .select("id")
        .eq("slug", circleSlug)
        .maybeSingle();
      circle = fallback.data;
      circleError = fallback.error;
    }
    if (circleError) {
      return json({ error: circleError.message }, 500);
    }
    if (!circle) {
      return json({ error: "Circle not found or deleted" }, 404);
    }

    // Insert post (RLS enforces ownership)
    const { data: inserted, error: insertError } = await userClient
      .from("posts")
      .insert({
        author_id: authData.user.id,
        circle_id: circle.id,
        type,
        title,
        body: normalizedBody,
        // MVP policy: publish immediately until moderation tooling is available.
        status: "published",
      })
      .select("id,author_id,circle_id,type,title,status,created_at")
      .single();
    if (insertError) {
      return json({ error: insertError.message }, 500);
    }

    return json({ post: inserted }, 201);
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Unexpected server error" },
      500,
    );
  }
};

// ---------------------------------------------------------------------------
// DELETE — remove a post owned by current user (soft delete preferred)
// ---------------------------------------------------------------------------

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as { runtime?: { env?: Record<string, string | undefined> } }).runtime?.env;
    if (!env) {
      return json({ error: "Runtime environment not available" }, 500);
    }

    const token = getBearerToken(request);
    if (!token) {
      return json({ error: "Missing bearer token" }, 401);
    }

    const userClient = createUserClient(env, token);
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) {
      return json({ error: "Invalid auth token" }, 401);
    }

    const url = new URL(request.url);
    const postId = String(url.searchParams.get("id") ?? url.searchParams.get("post_id") ?? "").trim();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(postId)) {
      return json({ error: "Invalid post_id format" }, 400);
    }

    const { data: post, error: postError } = await userClient
      .from("posts")
      .select("id, author_id, status")
      .eq("id", postId)
      .maybeSingle();
    if (postError) {
      return json({ error: postError.message }, 500);
    }
    if (!post) {
      return json({ error: "Post not found" }, 404);
    }
    if (post.author_id !== authData.user.id) {
      return json({ error: "Cannot delete a post you do not own" }, 403);
    }
    if (post.status === "deleted") {
      return json({
        ok: true,
        status: "deleted",
        post: { id: postId, status: "deleted" },
        cleanup: {
          ok: true,
          warnings: [],
          errors: [],
          deletedObjects: [],
          deletedRows: 0,
        },
        message: "已删除",
      });
    }

    const { data: mediaRows, error: mediaQueryError } = await userClient
      .from("post_media")
      .select("id,kind,storage_path,url")
      .eq("post_id", postId)
      .eq("user_id", authData.user.id);
    if (mediaQueryError) {
      return json({ error: mediaQueryError.message }, 500);
    }

    const { data: updated, error: updateError } = await userClient
      .from("posts")
      .update({ status: "deleted" })
      .eq("id", postId)
      .eq("author_id", authData.user.id)
      .select("id,status")
      .single();
    if (updateError) {
      // Backward compatibility: old RLS policies may not allow authors to set deleted.
      const { error: hardDeleteError } = await userClient
        .from("posts")
        .delete()
        .eq("id", postId)
        .eq("author_id", authData.user.id);
      if (hardDeleteError) {
        return json({ error: updateError.message }, 500);
      }
      return json({
        ok: true,
        post: { id: postId, status: "deleted" },
        mode: "hard_delete_fallback",
        cleanup: {
          ok: true,
          warnings: [],
          errors: [],
          deletedObjects: [],
          deletedRows: 0,
        },
      });
    }

    const cleanup = await deletePostMediaObjects({
      env: env as Record<string, string | undefined>,
      client: userClient,
      mediaRows: mediaRows ?? [],
      deleteRows: true,
    });

    return json({
      ok: true,
      status: "deleted",
      post: updated,
      cleanup: {
        ok: cleanup.ok,
        warnings: cleanup.warnings,
        errors: cleanup.errors,
        deletedObjects: cleanup.deletedObjects,
        deletedRows: cleanup.deletedRows,
      },
      message: cleanup.ok ? "已删除并清理媒体" : "已删除，部分媒体清理需要后续重试",
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Unexpected server error" },
      500,
    );
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as { runtime?: { env?: Record<string, string | undefined> } }).runtime?.env;
    if (!env) {
      return json({ error: "Runtime environment not available" }, 500);
    }

    const token = getBearerToken(request);
    if (!token) {
      return json({ error: "Missing bearer token" }, 401);
    }

    const userClient = createUserClient(env, token);
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) {
      return json({ error: "Invalid auth token" }, 401);
    }

    const payload = (await request.json().catch(() => null)) as
      | { id?: string; status?: string }
      | null;
    const postId = String(payload?.id ?? "").trim();
    const nextStatus = String(payload?.status ?? "").trim();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(postId)) {
      return json({ error: "Invalid post id" }, 400);
    }
    if (nextStatus !== "hidden") {
      return json({ error: "Only hidden status is supported in this endpoint" }, 400);
    }

    const moderators = parseModeratorEmails(env.MODERATOR_EMAILS);
    if (moderators.length === 0) {
      return json({ error: "moderation not configured" }, 403);
    }
    const email = authData.user.email?.toLowerCase() ?? "";
    if (!moderators.includes(email)) {
      return json({ error: "Forbidden" }, 403);
    }

    const { data: updated, error: updateError } = await userClient
      .from("posts")
      .update({ status: "hidden" })
      .eq("id", postId)
      .select("id,status")
      .single();
    if (updateError) {
      return json({ error: updateError.message }, 500);
    }

    return json({ post: updated });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Unexpected server error" },
      500,
    );
  }
};

// ---------------------------------------------------------------------------
// Unsupported methods
// ---------------------------------------------------------------------------

export const ALL: APIRoute = () => {
  return json({ error: "Method not allowed" }, 405);
};
