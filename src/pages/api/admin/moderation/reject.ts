import type { APIRoute } from "astro";
import { jsonResponse, requireModerator, type RuntimeEnv } from "../../../../lib/server/admin-auth";
import { applyModerationAdminAction, parseModerationActionPayload } from "../../../../lib/server/moderation-admin";

export const prerender = false;
type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);
    const { client, user } = await requireModerator(request, env);
    const payload = await request.json().catch(() => null);
    const parsed = parseModerationActionPayload(payload);
    if (!parsed.ok) return parsed.response;

    const result = await applyModerationAdminAction({
      client,
      moderatorId: user.id,
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      action: "reject",
      reason: parsed.reason,
    });
    if (!result.ok) return jsonResponse({ error: result.error }, result.status ?? 500);
    return jsonResponse({ ok: true, item: result.item, already_applied: result.alreadyApplied === true });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);

