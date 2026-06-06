import type { SupabaseClient } from "@supabase/supabase-js";

export const PROFILE_MEDIA_BUCKET = "post-media";
export const PROFILE_AVATAR_PREFIX = "profile-avatars/";
export const PROFILE_BANNER_PREFIX = "profile-banners/";
export const PROFILE_MEDIA_EXPIRES_IN = 60 * 60;

export function isProfileAvatarPath(value?: string | null): value is string {
  return typeof value === "string" && value.startsWith(PROFILE_AVATAR_PREFIX);
}

export function isProfileBannerPath(value?: string | null): value is string {
  return typeof value === "string" && value.startsWith(PROFILE_BANNER_PREFIX);
}

function isAbsoluteUrl(value?: string | null): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

async function createSignedUrl(
  supabase: SupabaseClient,
  path: string,
  expiresIn: number,
  label: "avatar" | "banner",
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(PROFILE_MEDIA_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    console.warn(`[profile-${label}] createSignedUrl failed`, {
      path,
      message: error?.message ?? "missing signed url",
    });
    return null;
  }

  return data.signedUrl;
}

export async function resolveProfileAvatarUrl(
  supabase: SupabaseClient,
  avatarUrl?: string | null,
  expiresIn = PROFILE_MEDIA_EXPIRES_IN,
): Promise<string | null> {
  if (!avatarUrl) return null;
  if (isAbsoluteUrl(avatarUrl)) return avatarUrl;
  if (!isProfileAvatarPath(avatarUrl)) return null;
  return createSignedUrl(supabase, avatarUrl, expiresIn, "avatar");
}

export async function resolveProfileBannerUrl(
  supabase: SupabaseClient,
  bannerUrl?: string | null,
  expiresIn = PROFILE_MEDIA_EXPIRES_IN,
): Promise<string | null> {
  if (!bannerUrl) return null;
  if (isAbsoluteUrl(bannerUrl)) return bannerUrl;
  if (!isProfileBannerPath(bannerUrl)) return null;
  return createSignedUrl(supabase, bannerUrl, expiresIn, "banner");
}
