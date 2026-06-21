import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_EXPIRES_IN = 10 * 60;

function normalizePath(path: string | null | undefined) {
  return String(path ?? "").trim();
}

function isAbsoluteUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isAllowedStoragePath(path: string, allowedPrefixes: string[]) {
  return allowedPrefixes.some((prefix) => path.startsWith(prefix));
}

function absolutizeSignedUrl(url: string, baseUrl: string) {
  if (isAbsoluteUrl(url)) return url;
  if (!url.startsWith("/")) return url;

  try {
    const base = new URL(baseUrl);
    return new URL(url, `${base.origin}/`).toString();
  } catch {
    return url;
  }
}

export async function createSignedModerationUrls(params: {
  client: SupabaseClient;
  bucket?: string;
  values: Array<string | null | undefined>;
  allowedPrefixes: string[];
  expiresIn?: number;
  allowAnyStoragePath?: boolean;
}): Promise<string[]> {
  const bucket = params.bucket ?? "post-media";
  const expiresIn = params.expiresIn ?? DEFAULT_EXPIRES_IN;
  const bucketApi = params.client.storage.from(bucket);
  const absoluteUrls = new Set<string>();
  const storagePaths = new Set<string>();

  for (const rawValue of params.values) {
    const value = normalizePath(rawValue);
    if (!value) continue;
    if (isAbsoluteUrl(value)) {
      absoluteUrls.add(value);
      continue;
    }
    if (!params.allowAnyStoragePath && !isAllowedStoragePath(value, params.allowedPrefixes)) continue;
    storagePaths.add(value);
  }

  if (storagePaths.size === 0) {
    return [...absoluteUrls];
  }

  const { data, error } = await bucketApi.createSignedUrls([...storagePaths], expiresIn);
  if (error) {
    throw new Error(error.message);
  }

  const signed = (data ?? [])
    .map((entry) => absolutizeSignedUrl(entry?.signedUrl ?? "", bucketApi.url))
    .filter(Boolean);
  return [...absoluteUrls, ...signed];
}

export async function removeStoragePathIfAllowed(params: {
  client: SupabaseClient;
  bucket?: string;
  value: string | null | undefined;
  allowedPrefixes: string[];
  logLabel: string;
}): Promise<void> {
  const bucket = params.bucket ?? "post-media";
  const value = normalizePath(params.value);
  if (!value || isAbsoluteUrl(value) || !isAllowedStoragePath(value, params.allowedPrefixes)) return;

  const { error } = await params.client.storage.from(bucket).remove([value]);
  if (error) {
    console.warn(`[${params.logLabel}] cleanup failed`, {
      message: error.message,
    });
  }
}
