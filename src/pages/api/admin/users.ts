import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { jsonResponse, requireModerator, type RuntimeEnv } from "../../../lib/server/admin-auth";
import { createDefaultUserSafetyState } from "../../../lib/server/user-safety.server";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const env = runtimeEnv;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const { client } = await requireModerator(request, env);
    const url = new URL(request.url);
    const q = String(url.searchParams.get("q") ?? "").trim();
    const limitRaw = Number.parseInt(String(url.searchParams.get("limit") ?? "60"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 60;

    let query = client
      .from("profiles")
      .select("id,username,display_name,avatar_url,role,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (q) {
      query = query.or(`username.ilike.%${q}%,display_name.ilike.%${q}%`);
    }

    const { data: profiles, error } = await query;
    if (error) return jsonResponse({ error: error.message }, 500);

    const userIds = (profiles ?? []).map((profile) => profile.id);
    const { data: safetyRows, error: safetyError } = userIds.length
      ? await client
          .from("user_safety_states")
          .select("user_id,reputation_score,strike_count,warning_count,status,suspended_until,banned_at,ban_reason,last_action_at,created_at,updated_at")
          .in("user_id", userIds)
      : { data: [], error: null };

    if (safetyError) return jsonResponse({ error: safetyError.message }, 500);

    const safetyMap = new Map(
      ((safetyRows ?? []) as Array<Record<string, unknown>>).map((row) => [
        String(row.user_id ?? ""),
        row,
      ]),
    );

    return jsonResponse({
      users: (profiles ?? []).map((profile) => {
        const rawSafety = safetyMap.get(profile.id) ?? null;
        const defaultState = createDefaultUserSafetyState(profile.id);
        const rawStatus = String(rawSafety?.status ?? defaultState.status);
        const suspendedUntil = typeof rawSafety?.suspended_until === "string" ? rawSafety.suspended_until : null;
        const warningCount = Number(rawSafety?.warning_count ?? defaultState.warning_count) || 0;
        const isExpiredSuspension =
          rawStatus === "suspended" &&
          suspendedUntil &&
          Number.isFinite(Date.parse(suspendedUntil)) &&
          Date.parse(suspendedUntil) <= Date.now();
        const effectiveStatus = isExpiredSuspension ? (warningCount > 0 ? "warned" : "active") : rawStatus;
        const safety = rawSafety
          ? {
              reputation_score: Number(rawSafety.reputation_score ?? 0) || 0,
              strike_count: Number(rawSafety.strike_count ?? 0) || 0,
              warning_count: warningCount,
              status: effectiveStatus,
              suspended_until: isExpiredSuspension ? null : suspendedUntil,
              last_action_at: typeof rawSafety.last_action_at === "string" ? rawSafety.last_action_at : null,
            }
          : {
              reputation_score: defaultState.reputation_score,
              strike_count: defaultState.strike_count,
              warning_count: defaultState.warning_count,
              status: defaultState.status,
              suspended_until: defaultState.suspended_until,
              last_action_at: defaultState.last_action_at,
            };

        return {
          id: profile.id,
          username: profile.username ?? null,
          display_name: profile.display_name ?? null,
          avatar_url: profile.avatar_url ?? null,
          role: profile.role ?? null,
          created_at: profile.created_at ?? null,
          safety,
        };
      }),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
