import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { moderateAsset } from "../../../../lib/moderation/moderate-asset.server";
import {
  isLocalDegradedModerationResult,
  isProviderErrorModerationResult,
  moderateContent,
} from "../../../../lib/moderation/moderate-content.server";
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
  isProfileMediaPathForUser,
  resolveProfileAvatarUrl,
  resolveProfileBannerUrl,
} from "../../../../lib/profile-media";
import { isValidProfileUsername } from "../../../../lib/profile-links";
import { createUserClient, jsonResponse } from "../../../../lib/server/circle-management";
import { requireAuthenticatedLegalConsent } from "../../../../lib/server/legal-consent-mutation.server";
import { createLegalConsentReadRepository } from "../../../../lib/server/legal-consent-repository.server";
import { sanitizeApiError } from "../../../../lib/server/error-response";
import { assertUserCanWrite, getSafetyWriteBlockResponse } from "../../../../lib/server/user-safety.server";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: Record<string, string | undefined> } };
type ProfileClient = SupabaseClient;
type ProfilePayload = Record<string, unknown>;
type ParsedProfilePayload = {
  displayName: string;
  username: string | null;
  bio: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
};

const MAX_PROFILE_BODY_BYTES = 16 * 1024;
export const PROFILE_MUTABLE_FIELDS = ["display_name", "username", "bio", "avatar_url", "banner_url"] as const;
export const PROFILE_FORBIDDEN_FIELDS = [
  "id",
  "user_id",
  "profile_id",
  "owner_id",
  "actor_id",
  "role",
  "is_admin",
  "is_moderator",
  "moderation_status",
  "safety_state",
  "suspended_until",
  "banned_at",
  "verified",
  "verified_badge",
  "trust_level",
  "email",
  "created_at",
  "updated_at",
  "updated_by",
  "consent_state",
  "report_count",
] as const;
const MUTABLE_FIELD_SET = new Set<string>(PROFILE_MUTABLE_FIELDS);
const FORBIDDEN_FIELD_SET = new Set<string>(PROFILE_FORBIDDEN_FIELDS);
const PROFILE_SELECT = "id, username, display_name, avatar_url, bio, banner_url";

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isMissingBannerSchemaError(message: string) {
  return /banner_url/i.test(message) && /does not exist/i.test(message);
}

function hasUnsafeText(value: string) {
  return /[\u0000-\u001f\u007f<>]/.test(value);
}

function normalizeText(value: string) {
  return value.normalize("NFC").trim();
}

function parseNullableText(payload: ProfilePayload, field: string): string | null | undefined {
  if (!hasOwn(payload, field)) return undefined;
  const value = payload[field];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("PROFILE_INVALID_FIELD_TYPE");
  return normalizeText(value);
}

function getStrictBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._~+\/-]+=*)$/i.exec(header);
  return match?.[1] ?? null;
}

function requireRuntimeBindings(env: Record<string, string | undefined> | undefined) {
  if (!env?.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw jsonResponse({ error: "PROFILE_UNAVAILABLE" }, 503);
  }
  return env;
}

async function authenticateProfileActor(request: Request, env: Record<string, string | undefined>) {
  const token = getStrictBearerToken(request);
  if (!token) throw jsonResponse({ error: "NOT_AUTHENTICATED" }, 401);

  const client = createUserClient(env, token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user?.id) throw jsonResponse({ error: "NOT_AUTHENTICATED" }, 401);

  return { client, userId: data.user.id };
}

export function parseProfilePayload(payload: unknown): ParsedProfilePayload | { error: string; status: number } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "INVALID_JSON_PAYLOAD", status: 400 };
  }

  const record = payload as ProfilePayload;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_FIELD_SET.has(key)) return { error: "PROFILE_FORBIDDEN_FIELD_UPDATE", status: 403 };
    if (!MUTABLE_FIELD_SET.has(key)) return { error: "PROFILE_UNKNOWN_FIELD", status: 400 };
  }

  try {
    const displayName = parseNullableText(record, "display_name");
    const usernameValue = parseNullableText(record, "username");
    const bio = parseNullableText(record, "bio");
    const avatarUrl = parseNullableText(record, "avatar_url");
    const bannerUrl = parseNullableText(record, "banner_url");
    if (!displayName) return { error: "PROFILE_DISPLAY_NAME_REQUIRED", status: 400 };
    if (displayName.length > 40 || hasUnsafeText(displayName)) return { error: "PROFILE_DISPLAY_NAME_INVALID", status: 400 };
    if (usernameValue !== undefined && usernameValue !== null && usernameValue !== "" && hasUnsafeText(usernameValue)) {
      return { error: "PROFILE_USERNAME_INVALID", status: 400 };
    }
    const username = usernameValue ? usernameValue.toLowerCase() : null;
    if (username && !isValidProfileUsername(username)) return { error: "PROFILE_USERNAME_INVALID", status: 400 };
    if (bio && (bio.length > 240 || hasUnsafeText(bio))) return { error: "PROFILE_BIO_INVALID", status: 400 };
    if (avatarUrl && avatarUrl.length > 500) return { error: "PROFILE_AVATAR_INVALID", status: 400 };
    if (bannerUrl && bannerUrl.length > 500) return { error: "PROFILE_BANNER_INVALID", status: 400 };
    return { displayName, username, bio: bio || null, avatarUrl, bannerUrl };
  } catch {
    return { error: "PROFILE_INVALID_FIELD_TYPE", status: 400 };
  }
}

function isProfilePayloadError(value: ParsedProfilePayload | { error: string; status: number }): value is { error: string; status: number } {
  return "error" in value;
}

function validateProfileMediaReferences(payload: ParsedProfilePayload, userId: string) {
  if (payload.avatarUrl && !isProfileMediaPathForUser(payload.avatarUrl, userId, "avatar")) {
    return "PROFILE_AVATAR_INVALID";
  }
  if (payload.bannerUrl && !isProfileMediaPathForUser(payload.bannerUrl, userId, "banner")) {
    return "PROFILE_BANNER_INVALID";
  }
  return null;
}

async function moderateProfileImage(params: {
  client: ProfileClient;
  env: Record<string, string | undefined>;
  path: string | null;
  targetType: "profile_avatar_image" | "profile_banner_image";
}) {
  if (!params.path || !isOpenAIProfileImageModerationEnabled(params.env)) {
    return { decision: "allow" as const, reason: null as string | null };
  }

  const allowedPrefixes = params.targetType === "profile_avatar_image" ? [PROFILE_AVATAR_PREFIX] : [PROFILE_BANNER_PREFIX];
  const imageUrls = await createSignedModerationUrls({
    client: params.client,
    values: [params.path],
    allowedPrefixes,
    preferDataUrls: true,
  });
  return moderateAsset(params.env, buildModerationProviderInput({ targetType: params.targetType, imageUrls, localeHint: "zh-CN" }));
}

function isUniqueUsernameError(error: { code?: string | null; message?: string | null } | null | undefined) {
  return error?.code === "23505" || /profiles_username_unique_ci/i.test(error?.message ?? "");
}

function normalizeStoredProfileMedia(value: unknown, userId: string, kind: "avatar" | "banner") {
  return typeof value === "string" && isProfileMediaPathForUser(value, userId, kind) ? value : null;
}

function profileResponse(profile: {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  banner_url?: string | null;
  bio: string | null;
}, resolvedAvatarUrl: string | null, resolvedBannerUrl: string | null) {
  return {
    id: profile.id,
    username: profile.username,
    display_name: profile.display_name,
    bio: profile.bio,
    avatar_url: profile.avatar_url,
    banner_url: profile.banner_url ?? null,
    resolved_avatar_url: resolvedAvatarUrl,
    resolved_banner_url: resolvedBannerUrl,
  };
}

export function createProfilePost(dependencies: {
  authenticate?: typeof authenticateProfileActor;
  requireConsent?: typeof requireAuthenticatedLegalConsent;
  createConsentRepository?: typeof createLegalConsentReadRepository;
  assertWrite?: typeof assertUserCanWrite;
} = {}): APIRoute {
  return async ({ request, locals }) => {
  try {
    const env = requireRuntimeBindings(runtimeEnv);
    const auth = await (dependencies.authenticate ?? authenticateProfileActor)(request, env);
    const consent = await (dependencies.requireConsent ?? requireAuthenticatedLegalConsent)({
      identity: { userId: auth.userId },
      repository: (dependencies.createConsentRepository ?? createLegalConsentReadRepository)(auth.client),
    });
    if (!consent.ok) return consent.response;
    const safetyDecision = await (dependencies.assertWrite ?? assertUserCanWrite)(auth.client, auth.userId, "profile_update");
    if (!safetyDecision.allowed) return getSafetyWriteBlockResponse(safetyDecision);

    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return jsonResponse({ error: "PROFILE_CONTENT_TYPE_INVALID" }, 415);
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_PROFILE_BODY_BYTES) {
      return jsonResponse({ error: "PROFILE_PAYLOAD_TOO_LARGE" }, 413);
    }
    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: "INVALID_JSON_PAYLOAD" }, 400);
    }
    const parsedPayload = parseProfilePayload(rawPayload);
    if (isProfilePayloadError(parsedPayload)) return jsonResponse({ error: parsedPayload.error }, parsedPayload.status);
    const mediaError = validateProfileMediaReferences(parsedPayload, auth.userId);
    if (mediaError) return jsonResponse({ error: mediaError }, 400);

    let currentProfileResult = await auth.client.from("profiles").select(PROFILE_SELECT).eq("id", auth.userId).maybeSingle();
    if (currentProfileResult.error && isMissingBannerSchemaError(currentProfileResult.error.message)) {
      currentProfileResult = await auth.client.from("profiles").select("id, username, display_name, avatar_url, bio").eq("id", auth.userId).maybeSingle();
    }
    if (currentProfileResult.error || !currentProfileResult.data) return jsonResponse({ error: "PROFILE_NOT_FOUND" }, 404);

    const currentProfile = currentProfileResult.data as {
      id: string; username: string | null; display_name: string | null; avatar_url: string | null; banner_url?: string | null; bio: string | null;
    };
    const currentAvatarPath = normalizeStoredProfileMedia(currentProfile.avatar_url, auth.userId, "avatar");
    const currentBannerPath = normalizeStoredProfileMedia(currentProfile.banner_url, auth.userId, "banner");
    const nextAvatarPath = parsedPayload.avatarUrl ?? currentAvatarPath;
    const nextBannerPath = parsedPayload.bannerUrl ?? currentBannerPath;
    const avatarChanged = nextAvatarPath !== currentAvatarPath;
    const bannerChanged = nextBannerPath !== currentBannerPath;

    const textPayload = [
      `Display name: ${parsedPayload.displayName}`,
      parsedPayload.username ? `Username: ${parsedPayload.username}` : "",
      parsedPayload.bio ? `Bio: ${parsedPayload.bio}` : "",
    ].filter(Boolean).join("\n");
    const textModeration = await moderateContent(env, {
      contentType: "profile_text", userId: auth.userId, text: textPayload,
      providerInput: { targetType: "profile_text", title: parsedPayload.displayName, body: textPayload, localeHint: "zh-CN" },
    });
    if (textModeration.decision !== "allow") {
      const unavailable = textModeration.decision === "review" && isProviderErrorModerationResult(textModeration);
      return jsonResponse({ error: unavailable ? "PROFILE_MODERATION_UNAVAILABLE" : "PROFILE_CONTENT_REJECTED" }, unavailable ? 503 : 403);
    }
    if (isLocalDegradedModerationResult(textModeration)) {
      console.warn("[moderation] local-only degraded allow", { targetType: "profile_text", userId: auth.userId, reason: textModeration.reason, provider: textModeration.provider, status: textModeration.providerDetails?.providerStatus ?? null });
    }

    const [avatarModeration, bannerModeration] = await Promise.all([
      avatarChanged ? moderateProfileImage({ client: auth.client, env, path: nextAvatarPath, targetType: "profile_avatar_image" }) : Promise.resolve({ decision: "allow" as const, reason: null }),
      bannerChanged ? moderateProfileImage({ client: auth.client, env, path: nextBannerPath, targetType: "profile_banner_image" }) : Promise.resolve({ decision: "allow" as const, reason: null }),
    ]);
    if (avatarModeration.decision !== "allow" || bannerModeration.decision !== "allow") {
      const isAvatar = avatarModeration.decision !== "allow";
      const result = isAvatar ? avatarModeration : bannerModeration;
      const path = isAvatar ? nextAvatarPath : nextBannerPath;
      await removeStoragePathIfAllowed({ client: auth.client, value: path, allowedPrefixes: isAvatar ? [PROFILE_AVATAR_PREFIX] : [PROFILE_BANNER_PREFIX], logLabel: isAvatar ? "profile-avatar-moderation" : "profile-banner-moderation" });
      const unavailable = result.reason?.startsWith("openai_provider_error_");
      return jsonResponse({ error: unavailable ? "PROFILE_IMAGE_MODERATION_UNAVAILABLE" : "PROFILE_IMAGE_NOT_ALLOWED", field: isAvatar ? "avatar" : "banner" }, unavailable ? 503 : 403);
    }

    const updatePayload = { display_name: parsedPayload.displayName, username: parsedPayload.username, bio: parsedPayload.bio, avatar_url: nextAvatarPath, banner_url: nextBannerPath };
    let updateResult = await auth.client.from("profiles").update(updatePayload).eq("id", auth.userId).select(PROFILE_SELECT).single();
    if (updateResult.error && isMissingBannerSchemaError(updateResult.error.message) && !bannerChanged) {
      updateResult = await auth.client.from("profiles").update({ display_name: parsedPayload.displayName, username: parsedPayload.username, bio: parsedPayload.bio, avatar_url: nextAvatarPath }).eq("id", auth.userId).select("id, username, display_name, avatar_url, bio").single();
    }
    if (updateResult.error || !updateResult.data) {
      return jsonResponse({ error: isUniqueUsernameError(updateResult.error) ? "PROFILE_USERNAME_UNAVAILABLE" : "PROFILE_UPDATE_FAILED" }, isUniqueUsernameError(updateResult.error) ? 409 : 500);
    }

    const updatedProfile = updateResult.data as typeof currentProfile;
    const [resolvedAvatarUrl, resolvedBannerUrl] = await Promise.all([
      resolveProfileAvatarUrl(auth.client, normalizeStoredProfileMedia(updatedProfile.avatar_url, auth.userId, "avatar"), undefined, { publicProxyUserId: auth.userId }),
      resolveProfileBannerUrl(auth.client, normalizeStoredProfileMedia(updatedProfile.banner_url, auth.userId, "banner"), undefined, { publicProxyUserId: auth.userId }),
    ]);
    return jsonResponse({ profile: profileResponse(updatedProfile, resolvedAvatarUrl, resolvedBannerUrl) });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: "PROFILE_UPDATE_FAILED" }, 500);
    return jsonResponse({ error: sanitizeApiError(error, "PROFILE_UPDATE_FAILED") }, 500);
  }
  };
};

export const POST: APIRoute = createProfilePost();

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
