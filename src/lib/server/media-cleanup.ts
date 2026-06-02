import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteR2Objects } from "../r2-server";
import type { RuntimeEnv } from "./admin-auth";

export type PostMediaLike = {
  id: string;
  kind: string;
  storage_path: string | null;
  url: string | null;
};

export type MediaCleanupObjectStatus = "deleted" | "already_missing" | "skipped" | "failed";
export type MediaCleanupStorage = "r2" | "supabase" | "external" | "unknown";

export type MediaCleanupResult = {
  ok: boolean;
  deletedObjects: Array<{
    mediaId: string;
    storage: MediaCleanupStorage;
    path?: string;
    status: MediaCleanupObjectStatus;
    error?: string;
  }>;
  deletedRows: number;
  warnings: string[];
  errors: string[];
};

function nonEmptyMessage(message: string | null | undefined, fallback: string): string {
  const normalized = String(message ?? "").trim();
  return normalized || fallback;
}

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

function parseR2DeleteErrorMessage(message: string): Array<{ code: string; detail: string }> {
  const normalized = nonEmptyMessage(message, "Unknown R2 delete error");
  const prefix = "R2_DELETE_FAILED:";
  if (!normalized.startsWith(prefix)) {
    return [{ code: "Unknown", detail: normalized }];
  }

  try {
    const parsed = JSON.parse(normalized.slice(prefix.length)) as Array<{
      code?: string;
      message?: string;
      key?: string;
    }>;

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [{ code: "Unknown", detail: normalized }];
    }

    return parsed.map((item) => ({
      code: nonEmptyMessage(item.code, "Unknown"),
      detail: nonEmptyMessage(item.message, "Unknown R2 delete error"),
    }));
  } catch {
    return [{ code: "Unknown", detail: normalized }];
  }
}

function mergeResults(target: MediaCleanupResult, partial: MediaCleanupResult) {
  target.deletedObjects.push(...partial.deletedObjects);
  target.deletedRows += partial.deletedRows;
  target.warnings.push(...partial.warnings);
  target.errors.push(...partial.errors);
  target.ok = target.ok && partial.ok;
}

function resolveStorageType(media: PostMediaLike, r2PublicBaseUrl?: string): {
  storage: MediaCleanupStorage;
  path?: string;
} {
  const r2Key =
    normalizeR2ObjectKey(media.storage_path, r2PublicBaseUrl) ??
    normalizeR2ObjectKey(media.url, r2PublicBaseUrl);

  if (r2Key) {
    return { storage: "r2", path: r2Key };
  }

  const storagePath = String(media.storage_path ?? "").trim();
  if (storagePath) {
    return { storage: "supabase", path: storagePath };
  }

  const url = String(media.url ?? "").trim();
  if (url) {
    return { storage: "external", path: url };
  }

  return { storage: "unknown" };
}

export async function deleteMediaObject(params: {
  env: RuntimeEnv;
  client: SupabaseClient;
  media: PostMediaLike;
}): Promise<MediaCleanupResult> {
  const { env, client, media } = params;
  const result: MediaCleanupResult = {
    ok: true,
    deletedObjects: [],
    deletedRows: 0,
    warnings: [],
    errors: [],
  };

  const resolved = resolveStorageType(media, env.R2_PUBLIC_BASE_URL);
  const entry = {
    mediaId: media.id,
    storage: resolved.storage,
    path: resolved.path,
    status: "skipped" as MediaCleanupObjectStatus,
  };

  if (resolved.storage === "r2" && resolved.path) {
    try {
      await deleteR2Objects({ env, objectKeys: [resolved.path] });
      entry.status = "deleted";
    } catch (error) {
      const message = nonEmptyMessage(
        error instanceof Error ? error.message : null,
        "Unknown R2 delete error",
      );
      const parsedErrors = parseR2DeleteErrorMessage(message);
      if (parsedErrors.every((item) => isIgnorableStorageDeleteError(item.code) || isIgnorableStorageDeleteError(item.detail))) {
        entry.status = "already_missing";
        result.warnings.push(`media ${media.id} R2 object already missing: ${resolved.path}`);
      } else {
        entry.status = "failed";
        entry.error = message;
        result.errors.push(`media ${media.id} R2 delete failed: ${message}`);
        result.ok = false;
      }
    }
  } else if (resolved.storage === "supabase" && resolved.path) {
    const { error: removeStorageError } = await client.storage.from("post-media").remove([resolved.path]);
    if (removeStorageError) {
      const message = nonEmptyMessage(removeStorageError.message, "Unknown Supabase storage delete error");
      if (isIgnorableStorageDeleteError(message)) {
        entry.status = "already_missing";
        result.warnings.push(`media ${media.id} storage object already missing: ${resolved.path}`);
      } else {
        entry.status = "failed";
        entry.error = message;
        result.errors.push(`media ${media.id} storage delete failed: ${message}`);
        result.ok = false;
      }
    } else {
      entry.status = "deleted";
    }
  } else if (resolved.storage === "external") {
    entry.status = "skipped";
    result.warnings.push(`media ${media.id} uses external URL; only DB row cleanup is attempted`);
  } else {
    entry.status = "skipped";
    result.warnings.push(`media ${media.id} has no managed storage path`);
  }

  result.deletedObjects.push(entry);
  return result;
}

export async function deletePostMediaObjects(params: {
  env: RuntimeEnv;
  client: SupabaseClient;
  mediaRows: PostMediaLike[];
  deleteRows?: boolean;
}): Promise<MediaCleanupResult> {
  const { env, client, mediaRows, deleteRows = false } = params;
  const result: MediaCleanupResult = {
    ok: true,
    deletedObjects: [],
    deletedRows: 0,
    warnings: [],
    errors: [],
  };

  for (const media of mediaRows) {
    const partial = await deleteMediaObject({ env, client, media });
    mergeResults(result, partial);
  }

  if (deleteRows && mediaRows.length > 0) {
    const mediaIds = mediaRows.map((media) => media.id).filter(Boolean);
    const { data: deletedRows, error: deleteRowsError } = await client
      .from("post_media")
      .delete()
      .in("id", mediaIds)
      .select("id");

    if (deleteRowsError) {
      const message = nonEmptyMessage(deleteRowsError.message, "Unknown post_media delete error");
      result.errors.push(`post_media row delete failed: ${message}`);
      result.ok = false;
    } else {
      result.deletedRows = deletedRows?.length ?? 0;
      if (result.deletedRows < mediaIds.length) {
        result.warnings.push(
          `post_media rows already missing: ${mediaIds.length - result.deletedRows}`,
        );
      }
    }
  }

  return result;
}
