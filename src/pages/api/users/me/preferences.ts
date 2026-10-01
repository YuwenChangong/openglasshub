import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { handlePreferenceRequest } from "../../../../lib/server/user-preferences.server";

export const prerender = false;
export const GET: APIRoute = ({ request }) => handlePreferenceRequest(request, env);
export const PATCH: APIRoute = ({ request }) => handlePreferenceRequest(request, env);
