import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { jsonResponse, requireModerator, type RuntimeEnv } from "../../../../../lib/server/admin-auth";
import {
  createDefaultUserSafetyState,
  listUserSafetyEvents,
  getUserSafetyState,
} from "../../../../../lib/server/user-safety.server";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

export const GET: APIRoute = async ({ request, locals, params }) => {
  try {
    const env = runtimeEnv;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const userId = String(params.id ?? "").trim();
    if (!userId) return jsonResponse({ error: "USER_ID_REQUIRED" }, 400);

    const { client } = await requireModerator(request, env);
    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("id,username,display_name,avatar_url,role,created_at")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) return jsonResponse({ error: profileError.message }, 500);
    if (!profile) return jsonResponse({ error: "USER_NOT_FOUND" }, 404);

    const [state, events] = await Promise.all([
      getUserSafetyState(client, userId).catch((error) => {
        const message = error instanceof Error ? error.message : "USER_SAFETY_QUERY_FAILED";
        if (/USER_SAFETY_QUERY_FAILED|permission|does not exist|relation/i.test(message)) {
          throw new Error(message);
        }
        return createDefaultUserSafetyState(userId);
      }),
      listUserSafetyEvents(client, userId, 100),
    ]);

    const actorIds = Array.from(new Set(events.map((event) => event.actor_id).filter(Boolean))) as string[];
    const { data: actors, error: actorError } = actorIds.length
      ? await client.from("profiles").select("id,username,display_name,avatar_url,role").in("id", actorIds)
      : { data: [], error: null };

    if (actorError) return jsonResponse({ error: actorError.message }, 500);

    const actorMap = new Map((actors ?? []).map((actor) => [actor.id, actor]));

    return jsonResponse({
      user: {
        id: profile.id,
        username: profile.username ?? null,
        display_name: profile.display_name ?? null,
        avatar_url: profile.avatar_url ?? null,
        role: profile.role ?? null,
        created_at: profile.created_at ?? null,
      },
      state,
      events: events.map((event) => ({
        ...event,
        actor_profile: event.actor_id ? actorMap.get(event.actor_id) ?? null : null,
      })),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
