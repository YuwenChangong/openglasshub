import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import type { RuntimeEnv } from "../../../../lib/server/admin-auth.ts";
import { jsonResponse } from "../../../../lib/server/admin-auth.ts";
import { handleIssue } from "./start.ts";

export const prerender = false;
export const handleResend = (request: Request, env: RuntimeEnv, fetchImpl: typeof fetch = fetch) => handleIssue(request, env, true, fetchImpl);
export const POST: APIRoute = ({ request }) => handleResend(request, runtimeEnv as RuntimeEnv);
export const ALL: APIRoute = () => jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
