import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_PROXY_TTL = 10 * 60;
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 150 * 1024 * 1024;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function streamTrustedMediaUrl(params: {
  url: string;
  cacheSeconds?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
  allowedContentTypes?: readonly string[];
}) {
  const cacheSeconds = params.cacheSeconds ?? 120;
  const timeoutMs = params.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxResponseBytes = params.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  let upstream: Response;
  try {
    upstream = await fetch(params.url, { signal: abortController.signal });
  } catch {
    return json({ error: "MEDIA_UNAVAILABLE" }, 502);
  } finally {
    clearTimeout(timeout);
  }

  if (!upstream.ok || !upstream.body) {
    return json({ error: "MEDIA_NOT_FOUND" }, upstream.status === 404 ? 404 : 502);
  }

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  const contentLength = upstream.headers.get("content-length");
  const etag = upstream.headers.get("etag");
  const lastModified = upstream.headers.get("last-modified");

  if (!contentLength || !/^\d+$/.test(contentLength) || Number(contentLength) > maxResponseBytes) {
    return json({ error: "MEDIA_UNAVAILABLE" }, 502);
  }

  const normalizedContentType = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (params.allowedContentTypes && !params.allowedContentTypes.includes(normalizedContentType)) {
    return json({ error: "MEDIA_UNAVAILABLE" }, 502);
  }

  if (contentType) headers.set("content-type", contentType);
  if (contentLength) headers.set("content-length", contentLength);
  if (etag) headers.set("etag", etag);
  if (lastModified) headers.set("last-modified", lastModified);
  headers.set("cache-control", `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`);

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
}

export async function streamStorageObjectViaSignedUrl(params: {
  client: SupabaseClient;
  path: string;
  bucket?: string;
  signedUrlTtl?: number;
  cacheSeconds?: number;
  allowedContentTypes?: readonly string[];
}) {
  const bucket = params.bucket ?? "post-media";
  const signedUrlTtl = params.signedUrlTtl ?? DEFAULT_PROXY_TTL;

  const { data, error } = await params.client.storage.from(bucket).createSignedUrl(params.path, signedUrlTtl);
  if (error || !data?.signedUrl) {
    return json({ error: "MEDIA_NOT_FOUND" }, 404);
  }

  return streamTrustedMediaUrl({
    url: data.signedUrl,
    cacheSeconds: params.cacheSeconds,
    allowedContentTypes: params.allowedContentTypes,
  });
}
