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
import { MEDIA_ONLY_SENTINEL } from "../../../lib/post-body";
import { getRequestIp } from "../../../lib/request-ip";
import { validateTurnstileToken } from "../../../lib/turnstile";
import { deleteR2Objects } from "../../../lib/r2-server";

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

function normalizeR2ObjectKey(
  value: string | null | undefined,
  r2PublicBaseUrl?: string,
): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const stripLeading = (input: string) => input.replace(/^\/+/, "");
  const isLikelyKey = (input: string) =>
    input.startsWith("tmp/") || input.startsWith("posts/");

  const direct = stripLeading(raw);
  if (isLikelyKey(direct)) return direct;

  const tryFromUrl = (urlString: string): string | null => {
    try {
      const url = new URL(urlString);
      const key = stripLeading(url.pathname);
      if (isLikelyKey(key)) return key;
      return null;
    } catch {
      return null;
    }
  };

  const fromRawUrl = tryFromUrl(raw);
  if (fromRawUrl) return fromRawUrl;

  if (r2PublicBaseUrl) {
    const base = r2PublicBaseUrl.replace(/\/+$/, "");
    if (raw.startsWith(base + "/")) {
      const tail = stripLeading(raw.slice(base.length + 1));
      if (isLikelyKey(tail)) return tail;
    }
  }

  return null;
}

function isIgnorableStorageDeleteError(message: string | null | undefined): boolean {
  const value = String(message ?? "").toLowerCase();
  return (
    value.includes("not found") ||
    value.includes("the resource was not found") ||
    value.includes("no such key")
  );
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
    const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;

    const client = createAnonClient(env);

    let query = client
      .from("posts")
      .select(
        "id,title,type,status,created_at,last_activity_at,circle_id,author_id,circles:circle_id(slug,name),profiles:author_id(username,display_name),post_media(*)",
      )
      .eq("status", "published")
      .order("last_activity_at", { ascending: false })
      .limit(limit);

    if (circleSlug) {
      const { data: circle, error: circleError } = await client
        .from("circles")
        .select("id")
        .eq("slug", circleSlug)
        .maybeSingle();
      if (circleError) {
        return json({ error: circleError.message }, 500);
      }
      if (!circle) {
        return json({ posts: [], total: 0 }, 200);
      }
      query = query.eq("circle_id", circle.id);
    }

    const { data, error } = await query;
    if (error) {
      return json({ error: error.message }, 500);
    }

    return json({ posts: data ?? [], total: data?.length ?? 0 });
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
    const { data: circle, error: circleError } = await userClient
      .from("circles")
      .select("id")
      .eq("slug", circleSlug)
      .maybeSingle();
    if (circleError) {
      return json({ error: circleError.message }, 500);
    }
    if (!circle) {
      return json({ error: "Circle not found" }, 404);
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
      return json({ error: "Post already deleted" }, 409);
    }

    const { data: mediaRows, error: mediaQueryError } = await userClient
      .from("post_media")
      .select("id,kind,storage_path,url")
      .eq("post_id", postId)
      .eq("user_id", authData.user.id);
    if (mediaQueryError) {
      return json({ error: mediaQueryError.message }, 500);
    }

    const postMediaStoragePaths = (mediaRows ?? [])
      .map((row) => row.storage_path)
      .filter((value): value is string => Boolean(value));
    const r2PublicBaseUrl = env.R2_PUBLIC_BASE_URL;
    const r2Keys = Array.from(
      new Set(
        (mediaRows ?? [])
          .map((row) => normalizeR2ObjectKey(row.storage_path, r2PublicBaseUrl) ?? normalizeR2ObjectKey(row.url, r2PublicBaseUrl))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const supabaseMediaPaths = postMediaStoragePaths.filter((path) => {
      // If this value can be resolved to an R2 object key (including full URL),
      // it must NOT be sent to Supabase Storage remove.
      const resolvedR2Key = normalizeR2ObjectKey(path, r2PublicBaseUrl);
      return !resolvedR2Key;
    });

    const deletionFailures: Array<{
      stage: "r2_delete" | "supabase_storage_delete" | "post_media_delete";
      message: string;
      storagePaths?: string[];
    }> = [];

    if (r2Keys.length > 0) {
      try {
        await deleteR2Objects({ env, objectKeys: r2Keys });
      } catch (r2DeleteError) {
        deletionFailures.push({
          stage: "r2_delete",
          message:
            r2DeleteError instanceof Error ? r2DeleteError.message : "unknown error",
          storagePaths: r2Keys,
        });
      }
    }

    if (supabaseMediaPaths.length > 0) {
      const { error: removeStorageError } = await userClient.storage.from("post-media").remove(supabaseMediaPaths);
      if (removeStorageError && !isIgnorableStorageDeleteError(removeStorageError.message)) {
        deletionFailures.push({
          stage: "supabase_storage_delete",
          message: removeStorageError.message,
          storagePaths: supabaseMediaPaths,
        });
      }
    }

    if (deletionFailures.length > 0) {
      return json(
        {
          error: "POST_DELETE_MEDIA_PARTIAL_FAILURE",
          failures: deletionFailures,
        },
        500,
      );
    }

    const { error: deleteMediaRowsError } = await userClient
      .from("post_media")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", authData.user.id);
    if (deleteMediaRowsError) {
      // Fallback: hard-delete post so FK cascade can remove remaining post_media rows.
      const { error: hardDeleteCascadeError } = await userClient
        .from("posts")
        .delete()
        .eq("id", postId)
        .eq("author_id", authData.user.id);
      if (hardDeleteCascadeError) {
        return json(
          {
            error: "POST_DELETE_MEDIA_PARTIAL_FAILURE",
            failures: [
              {
                stage: "post_media_delete",
                message: deleteMediaRowsError.message,
              },
              {
                stage: "post_media_delete",
                message: `hard_delete_fallback_failed: ${hardDeleteCascadeError.message}`,
              },
            ],
          },
          500,
        );
      }
      return json({
        ok: true,
        post: { id: postId, status: "deleted" },
        mode: "hard_delete_cascade_fallback",
      });
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
      return json({ ok: true, post: { id: postId, status: "deleted" }, mode: "hard_delete_fallback" });
    }

    return json({ ok: true, post: updated });
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
