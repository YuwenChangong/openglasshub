import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

function normalizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

const ACCEPTED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as { runtime?: { env?: Record<string, string | undefined> } }).runtime?.env;
    if (!env) return json({ error: "Runtime environment not available" }, 500);

    const token = getBearerToken(request);
    if (!token) return json({ error: "Missing bearer token" }, 401);

    const supabase = createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid auth token" }, 401);

    const payload = (await request.json().catch(() => null)) as
      | { post_id?: string; file_name?: string; mime_type?: string; size_bytes?: number }
      | null;
    if (!payload) return json({ error: "Invalid JSON payload" }, 400);

    const postId = String(payload.post_id ?? "").trim();
    const fileNameRaw = String(payload.file_name ?? "").trim();
    const mimeType = String(payload.mime_type ?? "").trim().toLowerCase();
    const sizeBytes = Number(payload.size_bytes ?? 0);

    if (!postId || !/^[0-9a-f-]{36}$/i.test(postId)) return json({ error: "Invalid post_id format" }, 400);
    if (!fileNameRaw) return json({ error: "file_name is required" }, 400);
    if (!ACCEPTED_VIDEO_TYPES.has(mimeType)) return json({ error: "Unsupported video mime type" }, 400);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_VIDEO_SIZE) {
      return json({ error: "Video size exceeds current upload limit" }, 400);
    }

    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("id, author_id")
      .eq("id", postId)
      .maybeSingle();
    if (postError) return json({ error: postError.message }, 500);
    if (!post) return json({ error: "Post not found" }, 404);
    if (post.author_id !== authData.user.id) return json({ error: "Cannot upload media for a post you do not own" }, 403);

    const accountId = requireEnv(env, "R2_ACCOUNT_ID");
    const accessKeyId = requireEnv(env, "R2_ACCESS_KEY_ID");
    const secretAccessKey = requireEnv(env, "R2_SECRET_ACCESS_KEY");
    const bucketName = requireEnv(env, "R2_BUCKET_NAME");
    const publicBaseUrl = requireEnv(env, "R2_PUBLIC_BASE_URL").replace(/\/+$/, "");

    const objectName = normalizeFileName(fileNameRaw) || "video.mp4";
    const objectKey = `${authData.user.id}/${postId}/${Date.now()}-${objectName}`;

    const client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      ContentType: mimeType,
      ContentLength: sizeBytes,
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 15 * 60 });
    const publicUrl = `${publicBaseUrl}/${objectKey}`;

    return json({
      upload_url: uploadUrl,
      media_url: publicUrl,
      object_key: objectKey,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => json({ error: "Method not allowed" }, 405);

