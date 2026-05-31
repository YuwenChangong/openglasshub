export const LEGACY_MEDIA_PLACEHOLDERS = new Set([
  "仅媒体内容占位：该帖子包含图片或视频媒体。",
  "（仅媒体内容）",
]);

// Invisible fallback for DB constraints that require minimum body length.
// This keeps "media-only" posts semantically empty in UI.
export const MEDIA_ONLY_SENTINEL = "\u2063\u2063\u2063\u2063\u2063\u2063\u2063\u2063\u2063\u2063\u2063\u2063";

export function isPlaceholderBody(value?: string | null): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return LEGACY_MEDIA_PLACEHOLDERS.has(trimmed) || trimmed === MEDIA_ONLY_SENTINEL;
}

export function sanitizeBodyForDisplay(value?: string | null): string {
  if (!value) return "";
  if (isPlaceholderBody(value)) return "";
  return value;
}

