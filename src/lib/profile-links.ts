export const PROFILE_USERNAME_PATTERN = /^[a-z0-9_-]{3,30}$/;

export function isValidProfileUsername(value?: string | null): boolean {
  return PROFILE_USERNAME_PATTERN.test(value?.trim() ?? "");
}

export function buildProfileHref(profile?: {
  id?: string | null;
  username?: string | null;
} | null): string | null {
  const username = profile?.username?.trim();
  if (username && isValidProfileUsername(username)) return `/u/${encodeURIComponent(username)}/`;

  const id = profile?.id?.trim();
  if (id) return `/users/${encodeURIComponent(id)}/`;

  return null;
}
