import type { APIRoute } from "astro";
import { jsonResponse, type RuntimeEnv } from "../../../../lib/server/admin-auth";
import { handleTrustedAdminRuntimeCapability } from "../../../../lib/server/supabase-admin.server";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as RuntimeLocals).runtime?.env;
  if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

  return handleTrustedAdminRuntimeCapability(request, env);
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
