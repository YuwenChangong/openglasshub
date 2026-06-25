import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_PROXY_TTL = 10 * 60;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function streamStorageObjectViaSignedUrl(params: {
  client: SupabaseClient;
  path: string;
  bucket?: string;
  signedUrlTtl?: number;
  cacheSeconds?: number;
}) {
  const bucket = params.bucket ?? "post-media";
  const signedUrlTtl = params.signedUrlTtl ?? DEFAULT_PROXY_TTL;
  const cacheSeconds = params.cacheSeconds ?? 120;

  const { data, error } = await params.client.storage.from(bucket).createSignedUrl(params.path, signedUrlTtl);
  if (error || !data?.signedUrl) {
    return json({ error: "MEDIA_NOT_FOUND" }, 404);
  }

  const upstream = await fetch(data.signedUrl);
  if (!upstream.ok || !upstream.body) {
    return json({ error: "MEDIA_NOT_FOUND" }, upstream.status === 404 ? 404 : 502);
  }

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  const contentLength = upstream.headers.get("content-length");
  const etag = upstream.headers.get("etag");
  const lastModified = upstream.headers.get("last-modified");

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
