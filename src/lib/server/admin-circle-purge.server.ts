import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse, requireAdmin, type AdminAuthResult, type RuntimeEnv } from "./admin-auth";
import { CIRCLE_COVER_BUCKET, isCircleCoverPath } from "../circle-cover";
import { createServerAdminSupabaseClient, TrustedAdminRuntimeError } from "./supabase-admin-client.server";

type PurgePreviewRow = {
  circle_exists: boolean;
  current_status: string | null;
  circle_name: string | null;
  post_count: number;
  circle_report_count: number;
  direct_notification_count: number;
  image_path: string | null;
  allowed: boolean;
  reason_code: string;
};

type PurgeResultRow = {
  purged: boolean;
  reason_code: string;
};

type PurgeDependencies = {
  authorize?: (request: Request, env: RuntimeEnv) => Promise<AdminAuthResult>;
  createAdminClient?: (env: RuntimeEnv) => SupabaseClient;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function publicPreview(row: PurgePreviewRow) {
  return {
    circleExists: row.circle_exists,
    status: row.current_status,
    name: row.circle_name,
    postCount: row.post_count,
    circleReportCount: row.circle_report_count,
    directNotificationCount: row.direct_notification_count,
    hasCover: Boolean(row.image_path),
    allowed: row.allowed,
    reasonCode: row.reason_code,
  };
}

async function loadPreview(client: SupabaseClient, circleId: string): Promise<PurgePreviewRow> {
  const { data, error } = await client.rpc("admin_circle_purge_preview_v1", { circle_id: circleId });
  if (error) throw new Error("PURGE_PREVIEW_RPC_FAILED");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("PURGE_PREVIEW_RPC_INVALID");
  return row as PurgePreviewRow;
}

export async function handleAdminCirclePurge(
  request: Request,
  env: RuntimeEnv,
  dependencies: PurgeDependencies = {},
): Promise<Response> {
  try {
    const payload = (await request.json().catch(() => null)) as { id?: string; action?: string; confirmationName?: string } | null;
    const circleId = String(payload?.id ?? "").trim();
    if (!UUID_PATTERN.test(circleId)) return jsonResponse({ error: "INVALID_CIRCLE_ID" }, 400);
    if (payload?.action !== "preview" && payload?.action !== "purge") return jsonResponse({ error: "INVALID_PURGE_ACTION" }, 400);

    const authorize = dependencies.authorize ?? requireAdmin;
    const createAdminClient = dependencies.createAdminClient ?? createServerAdminSupabaseClient;
    await authorize(request, env);
    const client = createAdminClient(env);
    const preview = await loadPreview(client, circleId);

    if (payload.action === "preview") {
      return jsonResponse({ preview: publicPreview(preview) });
    }

    if (!preview.allowed) return jsonResponse({ preview: publicPreview(preview) }, 409);
    if (String(payload.confirmationName ?? "") !== preview.circle_name) {
      return jsonResponse({ error: "PURGE_CONFIRMATION_NAME_MISMATCH" }, 400);
    }

    if (preview.image_path && isCircleCoverPath(preview.image_path)) {
      const { error: storageError } = await client.storage.from(CIRCLE_COVER_BUCKET).remove([preview.image_path]);
      if (storageError) return jsonResponse({ error: "PURGE_STORAGE_DELETE_FAILED" }, 502);
    }

    const { data, error } = await client.rpc("admin_purge_circle_v1", { circle_id: circleId });
    if (error) return jsonResponse({ error: "PURGE_RPC_FAILED" }, 500);
    const result = (Array.isArray(data) ? data[0] : data) as PurgeResultRow | null;
    if (!result) return jsonResponse({ error: "PURGE_RPC_INVALID" }, 500);
    if (!result.purged) return jsonResponse({ result: { purged: false, reasonCode: result.reason_code } }, 409);

    return jsonResponse({ result: { purged: true, reasonCode: result.reason_code } });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof TrustedAdminRuntimeError) {
      return jsonResponse({ error: "TRUSTED_ADMIN_RUNTIME_UNAVAILABLE", code: error.code }, 500);
    }
    return jsonResponse({ error: "PURGE_SERVER_ERROR" }, 500);
  }
}
