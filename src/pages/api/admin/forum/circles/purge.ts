import type { APIRoute } from "astro";
import { env as runtimeEnv } from "cloudflare:workers";
import { handleAdminCirclePurge } from "../../../../../lib/server/admin-circle-purge.server";
import { jsonResponse, type RuntimeEnv } from "../../../../../lib/server/admin-auth";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const env = runtimeEnv as RuntimeEnv;
  if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);
  return handleAdminCirclePurge(request, env);
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
