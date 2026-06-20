import type { SupabaseClient } from "@supabase/supabase-js";

export const PROFILE_MEDIA_BUCKET = "post-media";
export const PROFILE_AVATAR_PREFIX = "profile-avatars/";
export const PROFILE_BANNER_PREFIX = "profile-banners/";
export const PROFILE_MEDIA_EXPIRES_IN = 10 * 60;
const profileMediaUrlCache = new WeakMap<SupabaseClient, Map<string, Promise<string | null>>>();

export function buildProfileMediaProxyUrl(userId: string, kind: "avatar" | "banner") {
  return `/api/media/profile/${encodeURIComponent(userId)}/${kind}`;
}

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
  let clientCache = profileMediaUrlCache.get(supabase);
  if (!clientCache) {
    clientCache = new Map<string, Promise<string | null>>();
    profileMediaUrlCache.set(supabase, clientCache);
  }

  const cacheKey = `${label}:${expiresIn}:${path}`;
  const cached = clientCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const { data, error } = await supabase.storage.from(PROFILE_MEDIA_BUCKET).createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) {
      console.warn(`[profile-${label}] createSignedUrl failed`, {
        path,
        message: error?.message ?? "missing signed url",
      });
      return null;
    }

    return data.signedUrl;
  })();

  clientCache.set(cacheKey, pending);
  return pending;
}

export async function resolveProfileAvatarUrl(
  supabase: SupabaseClient,
  avatarUrl?: string | null,
  expiresIn = PROFILE_MEDIA_EXPIRES_IN,
  options?: { publicProxyUserId?: string | null },
): Promise<string | null> {
  if (!avatarUrl) return null;
  if (isAbsoluteUrl(avatarUrl)) return avatarUrl;
  if (!isProfileAvatarPath(avatarUrl)) return null;
  if (options?.publicProxyUserId) {
    return buildProfileMediaProxyUrl(options.publicProxyUserId, "avatar");
  }
  return createSignedUrl(supabase, avatarUrl, expiresIn, "avatar");
}

export async function resolveProfileBannerUrl(
  supabase: SupabaseClient,
  bannerUrl?: string | null,
  expiresIn = PROFILE_MEDIA_EXPIRES_IN,
  options?: { publicProxyUserId?: string | null },
): Promise<string | null> {
  if (!bannerUrl) return null;
  if (isAbsoluteUrl(bannerUrl)) return bannerUrl;
  if (!isProfileBannerPath(bannerUrl)) return null;
  if (options?.publicProxyUserId) {
    return buildProfileMediaProxyUrl(options.publicProxyUserId, "banner");
  }
  return createSignedUrl(supabase, bannerUrl, expiresIn, "banner");
}
