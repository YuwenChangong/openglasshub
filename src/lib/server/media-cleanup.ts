import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteR2Objects } from "../r2-server";
import type { RuntimeEnv } from "./admin-auth";

export type PostMediaLike = {
  id: string;
  kind: string;
  storage_path: string | null;
  url: string | null;
};

export type MediaDeleteFailure = {
  stage: "r2_delete" | "supabase_storage_delete";
  message: string;
  mediaId: string;
  storagePath?: string;
};

function normalizeR2ObjectKey(value: string | null | undefined, r2PublicBaseUrl?: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const stripLeading = (input: string) => input.replace(/^\/+/, "");
  const isLikelyKey = (input: string) => input.startsWith("tmp/") || input.startsWith("posts/");

  const direct = stripLeading(raw);
  if (isLikelyKey(direct)) return direct;

  const tryFromUrl = (urlString: string): string | null => {
    try {
      const parsed = new URL(urlString);
      const path = stripLeading(parsed.pathname);
      return isLikelyKey(path) ? path : null;
    } catch {
      return null;
    }
  };

  const fromRaw = tryFromUrl(raw);
  if (fromRaw) return fromRaw;

  if (r2PublicBaseUrl) {
    const base = r2PublicBaseUrl.replace(/\/+$/, "");
    if (raw.startsWith(`${base}/`)) {
      const tail = stripLeading(raw.slice(base.length + 1));
      if (isLikelyKey(tail)) return tail;
    }
  }

  return null;
}

function isIgnorableStorageDeleteError(message: string | null | undefined): boolean {
  const value = String(message ?? "").toLowerCase();
  return (
    value.includes("not found") ||
    value.includes("the resource was not found") ||
    value.includes("no such key")
  );
}

export async function deleteMediaObject(params: {
  env: RuntimeEnv;
  client: SupabaseClient;
  media: PostMediaLike;
}): Promise<{ ok: boolean; failures: MediaDeleteFailure[]; warnings: string[] }> {
  const { env, client, media } = params;
  const failures: MediaDeleteFailure[] = [];
  const warnings: string[] = [];

  const r2Key = normalizeR2ObjectKey(media.storage_path, env.R2_PUBLIC_BASE_URL)
    ?? normalizeR2ObjectKey(media.url, env.R2_PUBLIC_BASE_URL);

  if (r2Key) {
    try {
      await deleteR2Objects({ env, objectKeys: [r2Key] });
    } catch (error) {
      failures.push({
        stage: "r2_delete",
        message: error instanceof Error ? error.message : "unknown r2 delete error",
        mediaId: media.id,
        storagePath: r2Key,
      });
    }
  } else if (media.storage_path) {
    const { error: removeStorageError } = await client.storage.from("post-media").remove([media.storage_path]);
    if (removeStorageError && !isIgnorableStorageDeleteError(removeStorageError.message)) {
      failures.push({
        stage: "supabase_storage_delete",
        message: removeStorageError.message,
        mediaId: media.id,
        storagePath: media.storage_path,
      });
    }
  } else if (media.url) {
    warnings.push(`media ${media.id} has URL but no managed storage_path; DB row only will be removed`);
  }

  return { ok: failures.length === 0, failures, warnings };
}

export async function deletePostMediaObjects(params: {
  env: RuntimeEnv;
  client: SupabaseClient;
  mediaRows: PostMediaLike[];
}): Promise<{ ok: boolean; failures: MediaDeleteFailure[]; warnings: string[] }> {
  const { env, client, mediaRows } = params;
  const failures: MediaDeleteFailure[] = [];
  const warnings: string[] = [];

  for (const media of mediaRows) {
    const result = await deleteMediaObject({ env, client, media });
    failures.push(...result.failures);
    warnings.push(...result.warnings);
  }

  return { ok: failures.length === 0, failures, warnings };
}
