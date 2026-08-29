import type { APIRoute } from "astro";
import { createDeviceAdminHandlers, createSupabaseDeviceRepository } from "../../../lib/server/device-admin";
import { jsonResponse, requireModerator, type RuntimeEnv } from "../../../lib/server/admin-auth";

export const prerender = false;
type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

function handlers(request: Request, locals: unknown) {
  const env = (locals as RuntimeLocals).runtime?.env;
  if (!env) return null;
  return createDeviceAdminHandlers({
    authorize: async (nextRequest) => {
      try { return await requireModerator(nextRequest, env); }
      catch (error) { return error instanceof Response ? error : jsonResponse({ ok: false, code: "SERVER_ERROR", message: "操作失败，请稍后重试。" }, 500); }
    },
    repositoryFor: createSupabaseDeviceRepository,
  });
}

function unavailable() { return jsonResponse({ ok: false, code: "SERVER_ERROR", message: "运行环境不可用。" }, 500); }
export const GET: APIRoute = ({ request, locals }) => handlers(request, locals)?.GET(request) ?? unavailable();
export const POST: APIRoute = ({ request, locals }) => handlers(request, locals)?.POST(request) ?? unavailable();
export const PATCH: APIRoute = ({ request, locals }) => handlers(request, locals)?.PATCH(request) ?? unavailable();
export const DELETE: APIRoute = ({ request, locals }) => handlers(request, locals)?.DELETE(request) ?? unavailable();
export const ALL: APIRoute = () => jsonResponse({ ok: false, code: "METHOD_NOT_ALLOWED", message: "Method not allowed" }, 405);
