import type { SupabaseClient } from "@supabase/supabase-js";

export const NEWS_MEDIA_BUCKET = "post-media";
const NEWS_MEDIA_PREFIXES = ["news-covers/", "news-content/"] as const;

export function isNewsStoragePath(value: string | null | undefined) {
  const path = String(value ?? "").trim();
  return NEWS_MEDIA_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function isHttpUrl(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  return /^https?:\/\//i.test(text);
}

export async function resolveNewsMediaUrl(
  client: SupabaseClient,
  value: string | null | undefined,
  expiresIn = 60 * 60,
) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (isHttpUrl(text)) return text;
  if (!isNewsStoragePath(text)) return null;

  const { data, error } = await client.storage.from(NEWS_MEDIA_BUCKET).createSignedUrl(text, expiresIn);
  if (error || !data?.signedUrl) {
    console.warn("[news-media] createSignedUrl failed", {
      path: text,
      message: error?.message ?? "missing signed url",
    });
    return null;
  }

  return data.signedUrl;
}

export async function resolveNewsMediaUrls(
  client: SupabaseClient,
  values: Array<string | null | undefined>,
  expiresIn = 60 * 60,
) {
  const uniqueValues = [...new Set(values.map((item) => String(item ?? "").trim()).filter(Boolean))];
  const entries = await Promise.all(
    uniqueValues.map(async (value) => [value, await resolveNewsMediaUrl(client, value, expiresIn)] as const),
  );

  return new Map(entries);
}
