import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyUserRestricted, notifyUserWarned } from "./moderation-notifications.server.ts";

export type UserSafetyStatus = "active" | "warned" | "suspended" | "banned";
export type UserSafetyEventType =
  | "warning"
  | "suspend"
  | "ban"
  | "unban"
  | "strike_added"
  | "strike_removed"
  | "note";
export type UserSafetyAdminAction = "warn" | "suspend" | "ban" | "unban" | "clear_warning";
export type UserSafetyWriteAction =
  | "post_create"
  | "comment_create"
  | "circle_create"
  | "circle_update"
  | "post_media_create"
  | "media_upload"
  | "external_video_upload"
  | "profile_update";

export type UserSafetyState = {
  user_id: string;
  reputation_score: number;
  strike_count: number;
  warning_count: number;
  status: UserSafetyStatus;
  suspended_until: string | null;
  banned_at: string | null;
  ban_reason: string | null;
  last_action_at: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  effective_status: UserSafetyStatus;
};

export type UserSafetyEvent = {
  id: string;
  user_id: string;
  actor_id: string | null;
  event_type: UserSafetyEventType;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type UserSafetyWriteDecision =
  | { allowed: true; state: UserSafetyState }
  | {
      allowed: false;
      code: "USER_BANNED" | "USER_SUSPENDED" | "USER_SAFETY_CHECK_FAILED";
      status: 403 | 503;
      message: string;
      suspended_until?: string | null;
    };

const SAFETY_STATE_SELECT =
  "user_id,reputation_score,strike_count,warning_count,status,suspended_until,banned_at,ban_reason,last_action_at,created_at,updated_at";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function normalizeInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function normalizeStatus(value: unknown): UserSafetyStatus {
  if (value === "warned" || value === "suspended" || value === "banned") {
    return value;
  }
  return "active";
}

function defaultStatusFromCounters(warningCount: number): UserSafetyStatus {
  return warningCount > 0 ? "warned" : "active";
}

export function createDefaultUserSafetyState(userId: string): UserSafetyState {
  return {
    user_id: userId,
    reputation_score: 0,
    strike_count: 0,
    warning_count: 0,
    status: "active",
    suspended_until: null,
    banned_at: null,
    ban_reason: null,
    last_action_at: null,
    updated_by: null,
    created_at: null,
    updated_at: null,
    effective_status: "active",
  };
}

function applyEffectiveStatus(state: Omit<UserSafetyState, "effective_status">): UserSafetyState {
  let effectiveStatus = state.status;
  if (state.status === "suspended" && state.suspended_until) {
    const untilTs = Date.parse(state.suspended_until);
    if (Number.isFinite(untilTs) && untilTs <= Date.now()) {
      effectiveStatus = defaultStatusFromCounters(state.warning_count);
    }
  }

  return {
    ...state,
    effective_status: effectiveStatus,
  };
}

function normalizeUserSafetyState(userId: string, row: Record<string, unknown> | null): UserSafetyState {
  if (!row) return createDefaultUserSafetyState(userId);

  return applyEffectiveStatus({
    user_id: String(row.user_id ?? userId),
    reputation_score: Number(row.reputation_score ?? 0) || 0,
    strike_count: normalizeInteger(row.strike_count),
    warning_count: normalizeInteger(row.warning_count),
    status: normalizeStatus(row.status),
    suspended_until: typeof row.suspended_until === "string" ? row.suspended_until : null,
    banned_at: typeof row.banned_at === "string" ? row.banned_at : null,
    ban_reason: typeof row.ban_reason === "string" && row.ban_reason.trim() ? row.ban_reason.trim() : null,
    last_action_at: typeof row.last_action_at === "string" ? row.last_action_at : null,
    updated_by: typeof row.updated_by === "string" ? row.updated_by : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
  });
}

function mapSupabaseErrorMessage(error: { message?: string | null } | null | undefined, fallback: string) {
  const message = String(error?.message ?? "").trim();
  return message || fallback;
}

export async function getUserSafetyState(client: SupabaseClient, userId: string): Promise<UserSafetyState> {
  const { data, error } = await client
    .from("user_safety_states")
    .select(SAFETY_STATE_SELECT)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(mapSupabaseErrorMessage(error, "USER_SAFETY_QUERY_FAILED"));
  }

  return normalizeUserSafetyState(userId, (data as Record<string, unknown> | null) ?? null);
}

export async function isUserSuspendedOrBanned(client: SupabaseClient, userId: string) {
  const state = await getUserSafetyState(client, userId);
  const blocked = state.effective_status === "banned" || state.effective_status === "suspended";
  return {
    blocked,
    state,
    code:
      state.effective_status === "banned"
        ? ("USER_BANNED" as const)
        : state.effective_status === "suspended"
          ? ("USER_SUSPENDED" as const)
          : null,
  };
}

export async function assertUserCanWrite(
  client: SupabaseClient,
  userId: string,
  action: UserSafetyWriteAction,
): Promise<UserSafetyWriteDecision> {
  try {
    const state = await getUserSafetyState(client, userId);

    if (state.effective_status === "banned") {
      return {
        allowed: false,
        code: "USER_BANNED",
        status: 403,
        message: `User is banned from ${action}.`,
      };
    }

    if (state.effective_status === "suspended") {
      return {
        allowed: false,
        code: "USER_SUSPENDED",
        status: 403,
        message: `User is suspended from ${action}.`,
        suspended_until: state.suspended_until,
      };
    }

    return {
      allowed: true,
      state,
    };
  } catch (error) {
    return {
      allowed: false,
      code: "USER_SAFETY_CHECK_FAILED",
      status: 503,
      message: error instanceof Error ? error.message : "User safety check failed.",
    };
  }
}

export function getSafetyWriteBlockResponse(decision: Exclude<UserSafetyWriteDecision, { allowed: true }>): Response {
  if (decision.code === "USER_BANNED") {
    return jsonResponse(
      {
        error: "USER_BANNED",
        code: "USER_BANNED",
        message: "当前账号已被封禁，无法继续发布或修改内容。",
      },
      403,
    );
  }

  if (decision.code === "USER_SUSPENDED") {
    return jsonResponse(
      {
        error: "USER_SUSPENDED",
        code: "USER_SUSPENDED",
        suspended_until: decision.suspended_until ?? null,
        message: "当前账号已被暂停发言，暂时无法继续发布或修改内容。",
      },
      403,
    );
  }

  return jsonResponse(
    {
      error: "USER_SAFETY_CHECK_FAILED",
      code: "USER_SAFETY_CHECK_FAILED",
      message: "用户安全状态暂时无法确认，请稍后再试。",
    },
    503,
  );
}

export async function listUserSafetyEvents(client: SupabaseClient, userId: string, limit = 50): Promise<UserSafetyEvent[]> {
  const { data, error } = await client
    .from("user_safety_events")
    .select("id,user_id,actor_id,event_type,reason,metadata,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 100)));

  if (error) {
    throw new Error(mapSupabaseErrorMessage(error, "USER_SAFETY_EVENTS_QUERY_FAILED"));
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id ?? ""),
    user_id: String(row.user_id ?? userId),
    actor_id: typeof row.actor_id === "string" ? row.actor_id : null,
    event_type: (row.event_type as UserSafetyEventType) ?? "note",
    reason: typeof row.reason === "string" ? row.reason : null,
    metadata: row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {},
    created_at: String(row.created_at ?? ""),
  }));
}

export async function upsertUserSafetyState(
  client: SupabaseClient,
  state: Omit<UserSafetyState, "effective_status" | "created_at" | "updated_at">,
): Promise<UserSafetyState> {
  const payload = {
    user_id: state.user_id,
    reputation_score: state.reputation_score,
    strike_count: state.strike_count,
    warning_count: state.warning_count,
    status: state.status,
    suspended_until: state.suspended_until,
    banned_at: state.banned_at,
    ban_reason: state.ban_reason,
    last_action_at: state.last_action_at,
    updated_by: state.updated_by,
  };

  const { data: existing, error: lookupError } = await client
    .from("user_safety_states")
    .select("user_id")
    .eq("user_id", state.user_id)
    .maybeSingle();

  if (lookupError) {
    throw new Error(mapSupabaseErrorMessage(lookupError, "USER_SAFETY_LOOKUP_FAILED"));
  }

  const { error } = existing
    ? await client
        .from("user_safety_states")
        .update({
          reputation_score: payload.reputation_score,
          strike_count: payload.strike_count,
          warning_count: payload.warning_count,
          status: payload.status,
          suspended_until: payload.suspended_until,
          banned_at: payload.banned_at,
          ban_reason: payload.ban_reason,
          last_action_at: payload.last_action_at,
          updated_by: payload.updated_by,
        })
        .eq("user_id", state.user_id)
    : await client
        .from("user_safety_states")
        .insert(payload);

  if (error) {
    throw new Error(mapSupabaseErrorMessage(error, "USER_SAFETY_UPSERT_FAILED"));
  }

  return getUserSafetyState(client, state.user_id);
}

export async function insertUserSafetyEvent(client: SupabaseClient, event: {
  user_id: string;
  actor_id: string | null;
  event_type: UserSafetyEventType;
  reason: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await client.from("user_safety_events").insert({
    user_id: event.user_id,
    actor_id: event.actor_id,
    event_type: event.event_type,
    reason: event.reason,
    metadata: event.metadata ?? {},
  });

  if (error) {
    throw new Error(mapSupabaseErrorMessage(error, "USER_SAFETY_EVENT_INSERT_FAILED"));
  }
}

export function sanitizeSafetyReason(value: unknown): string {
  return String(value ?? "").trim().slice(0, 500);
}

export function validateFutureIsoTimestamp(value: unknown): { ok: true; iso: string } | { ok: false; error: string } {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: false, error: "SUSPEND_UNTIL_REQUIRED" };
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return { ok: false, error: "INVALID_SUSPEND_UNTIL" };
  if (date.getTime() <= Date.now()) return { ok: false, error: "SUSPEND_UNTIL_MUST_BE_FUTURE" };
  return { ok: true, iso: date.toISOString() };
}

type UserSafetyTransitionResult =
  | { ok: false; status: 400 | 409; error: string }
  | {
      ok: true;
      changed: boolean;
      eventType: UserSafetyEventType | null;
      nextState: {
        reputation_score: number;
        strike_count: number;
        warning_count: number;
        status: UserSafetyStatus;
        suspended_until: string | null;
        banned_at: string | null;
        ban_reason: string | null;
      };
    };

export function computeUserSafetyTransition(
  current: UserSafetyState,
  action: UserSafetyAdminAction,
  params: { reason: string | null; until?: string | null; nowIso?: string | null },
): UserSafetyTransitionResult {
  const nowIso = params.nowIso ?? new Date().toISOString();
  let nextStatus: UserSafetyStatus = current.status;
  let nextSuspendedUntil = current.suspended_until;
  let nextBannedAt = current.banned_at;
  let nextBanReason = current.ban_reason;
  let nextWarningCount = current.warning_count;
  let nextStrikeCount = current.strike_count;
  let nextReputation = current.reputation_score;
  let eventType: UserSafetyEventType | null = null;

  if (action === "warn") {
    if (current.effective_status === "banned" || current.effective_status === "suspended") {
      return { ok: false, status: 409, error: "USER_SAFETY_ACTION_CONFLICT" };
    }
    nextStatus = "warned";
    nextWarningCount += 1;
    nextReputation -= 1;
    eventType = "warning";
  } else if (action === "suspend") {
    if (current.effective_status === "banned") {
      return { ok: false, status: 409, error: "USER_ALREADY_BANNED" };
    }
    if (current.effective_status === "suspended") {
      return { ok: false, status: 409, error: "USER_ALREADY_SUSPENDED" };
    }
    const validatedUntil = validateFutureIsoTimestamp(params.until);
    if (!validatedUntil.ok) {
      return { ok: false, status: 400, error: validatedUntil.error };
    }
    nextStatus = "suspended";
    nextSuspendedUntil = validatedUntil.iso;
    nextBannedAt = null;
    nextBanReason = params.reason;
    nextStrikeCount += 1;
    nextReputation -= 2;
    eventType = "suspend";
  } else if (action === "ban") {
    if (current.effective_status === "banned") {
      return { ok: false, status: 409, error: "USER_ALREADY_BANNED" };
    }
    nextStatus = "banned";
    nextSuspendedUntil = null;
    nextBannedAt = nowIso;
    nextBanReason = params.reason;
    nextStrikeCount += 1;
    nextReputation -= 5;
    eventType = "ban";
  } else if (action === "clear_warning") {
    if (
      current.effective_status === "banned" ||
      current.effective_status === "suspended" ||
      current.status === "banned" ||
      current.status === "suspended"
    ) {
      return { ok: false, status: 409, error: "USER_SAFETY_ACTION_CONFLICT" };
    }
    if (current.warning_count <= 0 && current.status === "active") {
      return {
        ok: true,
        changed: false,
        eventType: null,
        nextState: {
          reputation_score: current.reputation_score,
          strike_count: current.strike_count,
          warning_count: current.warning_count,
          status: current.status,
          suspended_until: current.suspended_until,
          banned_at: current.banned_at,
          ban_reason: current.ban_reason,
        },
      };
    }
    nextWarningCount = Math.max(0, current.warning_count - 1);
    nextStatus = defaultStatusFromCounters(nextWarningCount);
    if (nextReputation < 0) nextReputation += 1;
    eventType = "note";
  } else {
    if (
      current.effective_status !== "banned" &&
      current.effective_status !== "suspended" &&
      current.status !== "banned" &&
      current.status !== "suspended"
    ) {
      return { ok: false, status: 409, error: "USER_NOT_RESTRICTED" };
    }
    nextStatus = defaultStatusFromCounters(current.warning_count);
    nextSuspendedUntil = null;
    nextBannedAt = null;
    nextBanReason = null;
    eventType = "unban";
  }

  const changed =
    nextStatus !== current.status ||
    nextSuspendedUntil !== current.suspended_until ||
    nextBannedAt !== current.banned_at ||
    nextBanReason !== current.ban_reason ||
    nextWarningCount !== current.warning_count ||
    nextStrikeCount !== current.strike_count ||
    nextReputation !== current.reputation_score;

  return {
    ok: true,
    changed,
    eventType,
    nextState: {
      reputation_score: nextReputation,
      strike_count: nextStrikeCount,
      warning_count: nextWarningCount,
      status: nextStatus,
      suspended_until: nextSuspendedUntil,
      banned_at: nextBannedAt,
      ban_reason: nextBanReason,
    },
  };
}

export async function applyUserSafetyAction(params: {
  client: SupabaseClient;
  actorId: string;
  targetUserId: string;
  action: UserSafetyAdminAction;
  reason: string | null;
  until?: string | null;
}) {
  const { client, actorId, targetUserId, action } = params;
  if (actorId === targetUserId) {
    return { ok: false as const, status: 403, error: "USER_SAFETY_SELF_ACTION_FORBIDDEN" };
  }

  const { data: targetProfile, error: targetProfileError } = await client
    .from("profiles")
    .select("id")
    .eq("id", targetUserId)
    .maybeSingle();
  if (targetProfileError) {
    throw new Error(mapSupabaseErrorMessage(targetProfileError, "USER_LOOKUP_FAILED"));
  }
  if (!targetProfile) {
    return { ok: false as const, status: 404, error: "USER_NOT_FOUND" };
  }

  const current = await getUserSafetyState(client, targetUserId);
  const nowIso = new Date().toISOString();
  const transition = computeUserSafetyTransition(current, action, {
    reason: params.reason,
    until: params.until ?? null,
    nowIso,
  });
  if (!transition.ok) {
    return { ok: false as const, status: transition.status, error: transition.error };
  }
  if (!transition.changed) {
    return { ok: true as const, state: current };
  }

  const nextState = await upsertUserSafetyState(client, {
    user_id: targetUserId,
    reputation_score: transition.nextState.reputation_score,
    strike_count: transition.nextState.strike_count,
    warning_count: transition.nextState.warning_count,
    status: transition.nextState.status,
    suspended_until: transition.nextState.suspended_until,
    banned_at: transition.nextState.banned_at,
    ban_reason: transition.nextState.ban_reason,
    last_action_at: nowIso,
    updated_by: actorId,
  });

  if (transition.eventType) {
    await insertUserSafetyEvent(client, {
      user_id: targetUserId,
      actor_id: actorId,
      event_type: transition.eventType,
      reason: params.reason,
      metadata: {
        action,
        previous_status: current.status,
        previous_effective_status: current.effective_status,
        previous_warning_count: current.warning_count,
        next_status: nextState.status,
        next_effective_status: nextState.effective_status,
        next_warning_count: nextState.warning_count,
        suspended_until: nextState.suspended_until,
      },
    });
  }

  try {
    if (action === "warn") {
      await notifyUserWarned({
        client,
        recipientId: targetUserId,
        actingAdminId: actorId,
      });
    } else if (action === "suspend" || action === "ban") {
      await notifyUserRestricted({
        client,
        recipientId: targetUserId,
        actingAdminId: actorId,
      });
    }
  } catch (error) {
    console.warn("[user-safety] notification dispatch failed", {
      action,
      message: error instanceof Error ? error.message : "unknown error",
    });
  }

  return { ok: true as const, state: nextState };
}
