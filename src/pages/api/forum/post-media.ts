import type { APIRoute } from "astro";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const prerender = false;

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
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
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

type MediaPayload =
  | {
      kind: "image";
      storage_path: string;
      alt_text?: string;
      sort_order?: number;
    }
  | {
      kind: "video";
      storage_path: string;
      alt_text?: string;
      sort_order?: number;
    }
  | {
      kind: "video_link";
      url: string;
      thumbnail_url?: string;
      alt_text?: string;
      sort_order?: number;
    };

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const storagePathRegex = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[^/]+$/i;

function isValidVideoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function validateMediaArray(postId: string, userId: string, media: MediaPayload[]): string | null {
  if (!Array.isArray(media) || media.length === 0) {
    return "media is required";
  }
  if (media.length > 6) {
    return "media must contain at most 6 items";
  }

  for (const [index, item] of media.entries()) {
    const sortOrder = Number.isFinite(item.sort_order) ? Number(item.sort_order) : index;
    if (sortOrder < 0 || sortOrder > 99) {
      return "sort_order must be between 0 and 99";
    }

    if (item.kind === "image" || item.kind === "video") {
      const storagePath = String(item.storage_path ?? "").trim();
      if (!storagePath || !storagePathRegex.test(storagePath)) {
        return "Invalid media storage_path";
      }
      if (!storagePath.startsWith(`${userId}/${postId}/`)) {
        return "Media storage_path must stay inside the current user/post folder";
      }
      continue;
    }

    if (item.kind === "video_link") {
      const url = String(item.url ?? "").trim();
      if (!url || !isValidVideoUrl(url)) {
        return "Invalid video url";
      }
      continue;
    }

    return "Unsupported media kind";
  }

  return null;
}

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

    const payload = (await request.json().catch(() => null)) as
      | { post_id?: string; media?: MediaPayload[] }
      | null;
    if (!payload) {
      return json({ error: "Invalid JSON payload" }, 400);
    }

    const postId = String(payload.post_id ?? "").trim();
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
      return json({ error: "Cannot attach media to a post you do not own" }, 403);
    }

    const media = payload.media ?? [];
    const validationError = validateMediaArray(postId, authData.user.id, media);
    if (validationError) {
      return json({ error: validationError }, 400);
    }

    const rows = media.map((item, index) => ({
      post_id: postId,
      user_id: authData.user.id,
      kind: item.kind,
      url: item.kind === "video_link" ? item.url.trim() : null,
      storage_path: item.kind === "image" || item.kind === "video" ? item.storage_path.trim() : null,
      thumbnail_url: item.kind === "video_link" ? item.thumbnail_url?.trim() ?? null : null,
      alt_text: item.alt_text?.trim() || null,
      sort_order: Number.isFinite(item.sort_order) ? Number(item.sort_order) : index,
    }));

    const { data: inserted, error: insertError } = await userClient
      .from("post_media")
      .insert(rows)
      .select("id, post_id, kind, url, storage_path, thumbnail_url, alt_text, sort_order, created_at");

    if (insertError) {
      return json({ error: insertError.message }, 500);
    }

    return json({ media: inserted ?? [] }, 201);
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Unexpected server error" },
      500,
    );
  }
};

export const ALL: APIRoute = () => json({ error: "Method not allowed" }, 405);
