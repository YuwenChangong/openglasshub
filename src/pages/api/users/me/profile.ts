import type { APIRoute } from "astro";
import { isValidProfileUsername } from "../../../../lib/profile-links";
import { resolveProfileAvatarUrl, resolveProfileBannerUrl } from "../../../../lib/profile-media";
import { jsonResponse, requireForumUser } from "../../../../lib/server/circle-management";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: Record<string, string | undefined> } };

type ProfilePayload = {
  display_name?: string | null;
  username?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  banner_url?: string | null;
  role?: unknown;
  id?: unknown;
  email?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  updated_by?: unknown;
};

const FORBIDDEN_PROFILE_FIELDS = ["role", "id", "email", "created_at", "updated_at", "updated_by"] as const;

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeImagePath(value: unknown) {
  const path = typeof value === "string" ? value.trim() : "";
  return path || null;
}

function isMissingBannerSchemaError(message: string) {
  return /banner_url/i.test(message) && /does not exist/i.test(message);
}

function hasForbiddenFields(payload: ProfilePayload) {
  return FORBIDDEN_PROFILE_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(payload, field));
}

function validatePayload(payload: ProfilePayload) {
  const displayName = normalizeString(payload.display_name);
  const username = normalizeString(payload.username).toLowerCase();
  const bio = normalizeString(payload.bio);
  const avatarUrl = sanitizeImagePath(payload.avatar_url);
  const bannerUrl = sanitizeImagePath(payload.banner_url);

  if (!displayName) return "用户名不能为空。";
  if (displayName.length > 40) return "用户名不能超过 40 个字符。";
  if (username && !isValidProfileUsername(username)) {
    return "主页地址仅支持小写英文、数字、下划线和短横线。";
  }
  if (bio.length > 240) return "个人简介不能超过 240 个字符。";
  if (avatarUrl && avatarUrl.length > 500) return "头像路径过长。";
  if (bannerUrl && bannerUrl.length > 500) return "横幅路径过长。";
  return null;
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const auth = await requireForumUser(request, env);
    const payload = (await request.json().catch(() => null)) as ProfilePayload | null;
    if (!payload) return jsonResponse({ error: "INVALID_JSON_PAYLOAD" }, 400);
    if (hasForbiddenFields(payload)) return jsonResponse({ error: "PROFILE_FORBIDDEN_FIELD_UPDATE" }, 403);

    const validationError = validatePayload(payload);
    if (validationError) return jsonResponse({ error: validationError }, 400);

    const displayName = normalizeString(payload.display_name) || null;
    const username = normalizeString(payload.username).toLowerCase() || null;
    const bio = normalizeString(payload.bio) || null;
    const avatarUrl = sanitizeImagePath(payload.avatar_url);
    const bannerUrl = sanitizeImagePath(payload.banner_url);

    const updatePayload = {
      display_name: displayName,
      username,
      bio,
      avatar_url: avatarUrl,
      banner_url: bannerUrl,
    };

    let updateResult = await auth.client
      .from("profiles")
      .update(updatePayload)
      .eq("id", auth.user.id)
      .select("id, username, display_name, avatar_url, bio, role, created_at, banner_url")
      .single();

    if (updateResult.error && isMissingBannerSchemaError(updateResult.error.message) && !bannerUrl) {
      updateResult = await auth.client
        .from("profiles")
        .update({
          display_name: displayName,
          username,
          bio,
          avatar_url: avatarUrl,
        })
        .eq("id", auth.user.id)
        .select("id, username, display_name, avatar_url, bio, role, created_at")
        .single();
    }

    if (updateResult.error || !updateResult.data) {
      return jsonResponse({ error: "PROFILE_UPDATE_FAILED" }, 500);
    }

    const updatedProfile = updateResult.data as {
      id: string;
      username: string | null;
      display_name: string | null;
      avatar_url: string | null;
      banner_url?: string | null;
      bio: string | null;
      role: string | null;
      created_at: string;
    };

    const [resolvedAvatarUrl, resolvedBannerUrl] = await Promise.all([
      resolveProfileAvatarUrl(auth.client, updatedProfile.avatar_url),
      resolveProfileBannerUrl(auth.client, updatedProfile.banner_url ?? null),
    ]);

    return jsonResponse({
      profile: {
        ...updatedProfile,
        resolved_avatar_url: resolvedAvatarUrl,
        resolved_banner_url: resolvedBannerUrl,
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: "PROFILE_UPDATE_FAILED" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
