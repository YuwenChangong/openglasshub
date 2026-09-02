import type { APIRoute } from "astro";
import { env as runtimeEnv } from "cloudflare:workers";
import { jsonResponse, type RuntimeEnv } from "../../../../lib/server/admin-auth";
import { handleTrustedAdminRuntimeCapability } from "../../../../lib/server/supabase-admin.server";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const env = runtimeEnv as RuntimeEnv;
  if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

  return handleTrustedAdminRuntimeCapability(request, env);
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
