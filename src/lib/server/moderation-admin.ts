import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse } from "./admin-auth.ts";

export type ModerationAdminAction = "approve" | "reject" | "hide";
export type ModerationAdminTarget = "post" | "comment";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseModerationActionPayload(payload: unknown): {
  ok: true;
  targetType: ModerationAdminTarget;
  targetId: string;
  reason: string | null;
} | {
  ok: false;
  response: Response;
} {
  const record = (payload ?? {}) as Record<string, unknown>;
  const targetType = String(record.target_type ?? "").trim() as ModerationAdminTarget;
  const targetId = String(record.target_id ?? "").trim();
  const reason = String(record.reason ?? "").trim() || null;

  if (targetType !== "post" && targetType !== "comment") {
    return { ok: false, response: jsonResponse({ error: "Invalid target_type" }, 400) };
  }
  if (!uuidRegex.test(targetId)) {
    return { ok: false, response: jsonResponse({ error: "Invalid target_id" }, 400) };
  }
  return { ok: true, targetType, targetId, reason };
}

export async function applyModerationAdminAction(params: {
  client: SupabaseClient;
  moderatorId: string;
  targetType: ModerationAdminTarget;
  targetId: string;
  action: ModerationAdminAction;
  reason?: string | null;
}) {
  const { client, moderatorId, targetType, targetId, action, reason } = params;
  const table = targetType === "post" ? "posts" : "comments";
  const now = new Date().toISOString();

  const updatePayload =
    action === "approve"
      ? {
          status: "published",
          moderation_status: "published",
          moderation_reason: reason ?? null,
          moderation_score: null,
          moderation_provider: "manual-admin",
          moderated_at: now,
          moderated_by: moderatorId,
        }
      : action === "reject"
        ? {
            status: "hidden",
            moderation_status: "rejected",
            moderation_reason: reason ?? "Rejected by moderator",
            moderation_provider: "manual-admin",
            moderated_at: now,
            moderated_by: moderatorId,
          }
        : {
            status: "hidden",
            moderation_status: "hidden_by_admin",
            moderation_reason: reason ?? "Hidden by moderator",
            moderation_provider: "manual-admin",
            moderated_at: now,
            moderated_by: moderatorId,
          };

  const desiredStatus = updatePayload.status;
  const desiredModerationStatus = updatePayload.moderation_status;

  const { data: existing, error: existingError } = await client
    .from(table)
    .select("id,status,moderation_status,moderation_reason,moderated_at,moderated_by")
    .eq("id", targetId)
    .maybeSingle();

  if (existingError) {
    return { ok: false as const, status: 500, error: existingError.message };
  }
  if (!existing) {
    return { ok: false as const, status: 404, error: "Moderation target not found" };
  }

  if (
    existing.status === desiredStatus &&
    existing.moderation_status === desiredModerationStatus
  ) {
    return {
      ok: true as const,
      item: existing,
      alreadyApplied: true,
    };
  }

  const { data: updatedRows, error: updateError } = await client
    .from(table)
    .update(updatePayload)
    .eq("id", targetId)
    .select("id,status,moderation_status,moderation_reason,moderated_at,moderated_by");

  if (updateError) {
    return { ok: false as const, status: 500, error: updateError.message };
  }

  const updated = Array.isArray(updatedRows) ? (updatedRows[0] ?? null) : updatedRows ?? null;

  const { error: actionError } = await client.from("moderation_actions").insert({
    moderator_id: moderatorId,
    target_type: targetType,
    target_id: targetId,
    action,
    reason: reason ?? `${action} ${targetType}`,
  });

  if (actionError) {
    return { ok: false as const, status: 500, error: actionError.message };
  }

  return {
    ok: true as const,
    item:
      updated ??
      {
        id: targetId,
        status: desiredStatus,
        moderation_status: desiredModerationStatus,
        moderation_reason: updatePayload.moderation_reason ?? null,
        moderated_at: now,
        moderated_by: moderatorId,
      },
    alreadyApplied: false,
  };
}
