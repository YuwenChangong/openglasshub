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

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ALLOWED_TYPES = new Set(["experience", "question", "review", "dev", "news", "feedback"]);

function validatePayload(payload: Record<string, unknown>): string | null {
  const circleSlug = String(payload.circle_slug ?? "").trim();
  const title = String(payload.title ?? "").trim();
  const body = String(payload.body ?? "").trim();
  const type = String(payload.type ?? "").trim();

  if (!circleSlug || !title || !body || !type) {
    return "circle_slug, title, body, type are required";
  }
  if (title.length < 3 || title.length > 180) {
    return "title must be 3-180 characters";
  }
  if (body.length < 10 || body.length > 20000) {
    return "body must be 10-20000 characters";
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

    const circleSlug = url.searchParams.get("circle");
    const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;

    const client = createAnonClient(env);

    let query = client
      .from("posts")
      .select(
        "id,title,type,status,created_at,last_activity_at,circle_id,author_id,circles:circle_id(slug,name),profiles:author_id(username,display_name),post_media(id,post_id,kind,url,storage_path,thumbnail_url,alt_text,width,height,duration_seconds,size_bytes,mime_type,sort_order,is_cover,created_at)",
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

    const circleSlug = String(payload.circle_slug ?? "").trim();
    const title = String(payload.title ?? "").trim();
    const body = String(payload.body ?? "").trim();
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
        body,
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
