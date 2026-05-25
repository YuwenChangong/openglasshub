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
      width?: number | null;
      height?: number | null;
      duration_seconds?: number | null;
      size_bytes?: number | null;
      mime_type?: string | null;
      is_cover?: boolean;
    }
  | {
      kind: "video";
      storage_path: string;
      alt_text?: string;
      sort_order?: number;
      width?: number | null;
      height?: number | null;
      duration_seconds?: number | null;
      size_bytes?: number | null;
      mime_type?: string | null;
      is_cover?: boolean;
    }
  | {
      kind: "video_link";
      url: string;
      thumbnail_url?: string;
      alt_text?: string;
      sort_order?: number;
      width?: number | null;
      height?: number | null;
      duration_seconds?: number | null;
      size_bytes?: number | null;
      mime_type?: string | null;
      is_cover?: boolean;
    };

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const storagePathRegex = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[^/]+$/i;
const acceptedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

function isValidVideoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function normalizePositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return Number.NaN;
  return parsed;
}

function normalizeNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return Number.NaN;
  return parsed;
}

function shouldFallbackToLegacyColumns(message: string): boolean {
  return /column .* does not exist/i.test(message) || /schema cache/i.test(message);
}

function validateMediaArray(postId: string, userId: string, media: MediaPayload[]): string | null {
  if (!Array.isArray(media) || media.length === 0) {
    return "media is required";
  }
  if (media.length > 6) {
    return "media must contain at most 6 items";
  }

  let coverCount = 0;

  for (const [index, item] of media.entries()) {
    const sortOrder = Number.isFinite(item.sort_order) ? Number(item.sort_order) : index;
    if (sortOrder < 0 || sortOrder > 99) {
      return "sort_order must be between 0 and 99";
    }
    if (typeof item.is_cover !== "undefined" && typeof item.is_cover !== "boolean") {
      return "is_cover must be a boolean";
    }
    if (item.is_cover) {
      coverCount += 1;
    }

    const width = normalizePositiveInteger(item.width);
    const height = normalizePositiveInteger(item.height);
    const durationSeconds = normalizeNonNegativeNumber(item.duration_seconds);
    const sizeBytes = normalizeNonNegativeNumber(item.size_bytes);
    if (Number.isNaN(width) || Number.isNaN(height)) {
      return "width and height must be positive integers";
    }
    if (Number.isNaN(durationSeconds) || Number.isNaN(sizeBytes)) {
      return "duration_seconds and size_bytes must be non-negative numbers";
    }
    if (item.mime_type && !acceptedMimeTypes.has(String(item.mime_type).trim().toLowerCase())) {
      return "Unsupported mime_type";
    }

    if (item.kind === "image" || item.kind === "video") {
      const storagePath = String(item.storage_path ?? "").trim();
      if (!storagePath || !storagePathRegex.test(storagePath)) {
        return "Invalid media storage_path";
      }
      if (!storagePath.startsWith(`${userId}/${postId}/`)) {
        return "Media storage_path must stay inside the current user/post folder";
      }
      if (!item.mime_type) {
        return "mime_type is required for uploaded media";
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

  if (coverCount > 1) {
    return "Only one media item can be marked as cover";
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

    const coverIndex = media.findIndex((item) => item.is_cover === true);
    const { error: resetCoverError } = await userClient
      .from("post_media")
      .update({ is_cover: false })
      .eq("post_id", postId)
      .eq("user_id", authData.user.id);

    if (resetCoverError && !shouldFallbackToLegacyColumns(resetCoverError.message)) {
      return json({ error: resetCoverError.message }, 500);
    }

    const rows = media.map((item, index) => ({
      post_id: postId,
      user_id: authData.user.id,
      kind: item.kind,
      url: item.kind === "video_link" ? item.url.trim() : null,
      storage_path: item.kind === "image" || item.kind === "video" ? item.storage_path.trim() : null,
      thumbnail_url: item.kind === "video_link" ? item.thumbnail_url?.trim() ?? null : null,
      alt_text: item.alt_text?.trim() || null,
      width: normalizePositiveInteger(item.width),
      height: normalizePositiveInteger(item.height),
      duration_seconds: normalizeNonNegativeNumber(item.duration_seconds),
      size_bytes: normalizeNonNegativeNumber(item.size_bytes),
      mime_type: item.mime_type?.trim().toLowerCase() || null,
      sort_order: Number.isFinite(item.sort_order) ? Number(item.sort_order) : index,
      is_cover: item.is_cover === true || (coverIndex < 0 && index === 0),
    }));

    let { data: inserted, error: insertError } = await userClient
      .from("post_media")
      .insert(rows)
      .select("id, post_id, kind, url, storage_path, thumbnail_url, alt_text, width, height, duration_seconds, size_bytes, mime_type, sort_order, is_cover, created_at");

    if (insertError && shouldFallbackToLegacyColumns(insertError.message)) {
      const legacyRows = media.map((item, index) => ({
        post_id: postId,
        user_id: authData.user.id,
        kind: item.kind,
        url: item.kind === "video_link" ? item.url.trim() : null,
        storage_path: item.kind === "image" || item.kind === "video" ? item.storage_path.trim() : null,
        thumbnail_url: item.kind === "video_link" ? item.thumbnail_url?.trim() ?? null : null,
        alt_text: item.alt_text?.trim() || null,
        sort_order: Number.isFinite(item.sort_order) ? Number(item.sort_order) : index,
      }));

      const legacyResult = await userClient
        .from("post_media")
        .insert(legacyRows)
        .select("id, post_id, kind, url, storage_path, thumbnail_url, alt_text, sort_order, created_at");

      inserted = legacyResult.data as typeof inserted;
      insertError = legacyResult.error;
    }

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
