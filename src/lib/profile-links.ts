export function buildProfileHref(profile?: {
  id?: string | null;
  username?: string | null;
} | null): string | null {
  const username = profile?.username?.trim();
  if (username) return `/u/${encodeURIComponent(username)}/`;

  const id = profile?.id?.trim();
  if (id) return `/users/${encodeURIComponent(id)}/`;

  return null;
}
