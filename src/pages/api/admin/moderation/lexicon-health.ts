import type { APIRoute } from "astro";
import { requireModerator, jsonResponse, type RuntimeEnv } from "../../../../lib/server/admin-auth";
import { getSensitiveLexiconHealth } from "../../../../lib/moderation/sensitive-lexicon-loader.server";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    await requireModerator(request, env);
    const health = await getSensitiveLexiconHealth(env);
    return jsonResponse({
      ok: true,
      lexicon: health,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
