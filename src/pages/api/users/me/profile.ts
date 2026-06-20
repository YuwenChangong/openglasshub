import type { APIRoute } from "astro";
import { moderateAsset } from "../../../../lib/moderation/moderate-asset.server";
import { moderateContent } from "../../../../lib/moderation/moderate-content.server";
import {
  createSignedModerationUrls,
  removeStoragePathIfAllowed,
} from "../../../../lib/moderation/moderation-media.server";
import {
  buildModerationProviderInput,
  isOpenAIProfileImageModerationEnabled,
} from "../../../../lib/moderation/moderation-provider.server";
import {
  PROFILE_AVATAR_PREFIX,
  PROFILE_BANNER_PREFIX,
  resolveProfileAvatarUrl,
  resolveProfileBannerUrl,
} from "../../../../lib/profile-media";
import { isValidProfileUsername } from "../../../../lib/profile-links";
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

function isMissingBannerSchemaError(message: string) {
  return /banner_url/i.test(message) && /does not exist/i.test(message);
}

function sanitizeImagePath(value: unknown) {
  const path = typeof value === "string" ? value.trim() : "";
  return path || null;
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

async function moderateProfileImage(params: {
  client: Awaited<ReturnType<typeof requireForumUser>>["client"];
  env: Record<string, string | undefined>;
  path: string | null;
  targetType: "profile_avatar_image" | "profile_banner_image";
}) {
  if (!params.path || !isOpenAIProfileImageModerationEnabled(params.env)) {
    return { decision: "allow" as const, reason: null as string | null };
  }

  const allowedPrefixes =
    params.targetType === "profile_avatar_image" ? [PROFILE_AVATAR_PREFIX] : [PROFILE_BANNER_PREFIX];
  const imageUrls = await createSignedModerationUrls({
    client: params.client,
    values: [params.path],
    allowedPrefixes,
  });

  return moderateAsset(
    params.env,
    buildModerationProviderInput({
      targetType: params.targetType,
      imageUrls,
      localeHint: "zh-CN",
    }),
  );
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const auth = await requireForumUser(request, env);
    const payload = (await request.json().catch(() => null)) as ProfilePayload | null;
    if (!payload) {
      return jsonResponse({ error: "INVALID_JSON_PAYLOAD" }, 400);
    }
    if (hasForbiddenFields(payload)) {
      return jsonResponse({ error: "PROFILE_FORBIDDEN_FIELD_UPDATE" }, 403);
    }

    const validationError = validatePayload(payload);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400);
    }

    const displayName = normalizeString(payload.display_name) || null;
    const username = normalizeString(payload.username).toLowerCase() || null;
    const bio = normalizeString(payload.bio) || null;
    const avatarUrl = sanitizeImagePath(payload.avatar_url);
    const bannerUrl = sanitizeImagePath(payload.banner_url);

    const textPayload = [
      displayName ? `Display name: ${displayName}` : "",
      username ? `Username: ${username}` : "",
      bio ? `Bio: ${bio}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const textModeration = await moderateContent(env, {
      contentType: "profile_text",
      userId: auth.user.id,
      text: textPayload,
      providerInput: {
        targetType: "profile_text",
        title: displayName ?? undefined,
        body: textPayload,
        localeHint: "zh-CN",
      },
    });

    if (textModeration.decision !== "allow") {
      return jsonResponse(
        {
          error: "PROFILE_CONTENT_REJECTED",
          message: "资料内容需要调整后再保存。",
        },
        403,
      );
    }

    let currentProfileResult = await auth.client
      .from("profiles")
      .select("id, username, display_name, avatar_url, bio, role, created_at, banner_url")
      .eq("id", auth.user.id)
      .maybeSingle();

    if (currentProfileResult.error && isMissingBannerSchemaError(currentProfileResult.error.message)) {
      currentProfileResult = await auth.client
        .from("profiles")
        .select("id, username, display_name, avatar_url, bio, role, created_at")
        .eq("id", auth.user.id)
        .maybeSingle();
    }

    if (currentProfileResult.error || !currentProfileResult.data) {
      return jsonResponse({ error: currentProfileResult.error?.message ?? "Profile not found" }, 404);
    }

    const currentProfile = currentProfileResult.data as {
      id: string;
      username: string | null;
      display_name: string | null;
      avatar_url: string | null;
      banner_url?: string | null;
      bio: string | null;
      role: string | null;
      created_at: string;
    };

    const nextAvatarPath = avatarUrl ?? currentProfile.avatar_url ?? null;
    const nextBannerPath = bannerUrl ?? currentProfile.banner_url ?? null;

    const avatarChanged = nextAvatarPath !== (currentProfile.avatar_url ?? null);
    const bannerChanged = nextBannerPath !== (currentProfile.banner_url ?? null);

    const [avatarModeration, bannerModeration] = await Promise.all([
      avatarChanged
        ? moderateProfileImage({
            client: auth.client,
            env,
            path: nextAvatarPath,
            targetType: "profile_avatar_image",
          })
        : Promise.resolve({ decision: "allow" as const, reason: null }),
      bannerChanged
        ? moderateProfileImage({
            client: auth.client,
            env,
            path: nextBannerPath,
            targetType: "profile_banner_image",
          })
        : Promise.resolve({ decision: "allow" as const, reason: null }),
    ]);

    if (avatarModeration.decision !== "allow") {
      await removeStoragePathIfAllowed({
        client: auth.client,
        value: nextAvatarPath,
        allowedPrefixes: [PROFILE_AVATAR_PREFIX],
        logLabel: "profile-avatar-moderation",
      });
      const code = avatarModeration.reason?.startsWith("openai_provider_error_")
        ? "PROFILE_IMAGE_MODERATION_UNAVAILABLE"
        : "PROFILE_IMAGE_NOT_ALLOWED";
      return jsonResponse(
        { error: code, field: "avatar", message: "资料图片需要调整后再保存。" },
        code === "PROFILE_IMAGE_NOT_ALLOWED" ? 403 : 503,
      );
    }

    if (bannerModeration.decision !== "allow") {
      await removeStoragePathIfAllowed({
        client: auth.client,
        value: nextBannerPath,
        allowedPrefixes: [PROFILE_BANNER_PREFIX],
        logLabel: "profile-banner-moderation",
      });
      const code = bannerModeration.reason?.startsWith("openai_provider_error_")
        ? "PROFILE_IMAGE_MODERATION_UNAVAILABLE"
        : "PROFILE_IMAGE_NOT_ALLOWED";
      return jsonResponse(
        { error: code, field: "banner", message: "资料图片需要调整后再保存。" },
        code === "PROFILE_IMAGE_NOT_ALLOWED" ? 403 : 503,
      );
    }

    const updatePayload = {
      display_name: displayName,
      username,
      bio,
      avatar_url: nextAvatarPath,
      banner_url: nextBannerPath,
    };

    let updateResult = await auth.client
      .from("profiles")
      .update(updatePayload)
      .eq("id", auth.user.id)
      .select("id, username, display_name, avatar_url, bio, role, created_at, banner_url")
      .single();

    if (updateResult.error && isMissingBannerSchemaError(updateResult.error.message) && !bannerChanged) {
      updateResult = await auth.client
        .from("profiles")
        .update({
          display_name: displayName,
          username,
          bio,
          avatar_url: nextAvatarPath,
        })
        .eq("id", auth.user.id)
        .select("id, username, display_name, avatar_url, bio, role, created_at")
        .single();
    }

    if (updateResult.error || !updateResult.data) {
      return jsonResponse({ error: updateResult.error?.message ?? "PROFILE_UPDATE_FAILED" }, 500);
    }

    const updatedProfile = updateResult.data as typeof currentProfile;
    const [resolvedAvatarUrl, resolvedBannerUrl] = await Promise.all([
      resolveProfileAvatarUrl(auth.client, updatedProfile.avatar_url, undefined, {
        publicProxyUserId: updatedProfile.id,
      }),
      resolveProfileBannerUrl(auth.client, updatedProfile.banner_url ?? null, undefined, {
        publicProxyUserId: updatedProfile.id,
      }),
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
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
