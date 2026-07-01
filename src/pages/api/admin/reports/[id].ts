import type { APIRoute } from "astro";
import { jsonResponse, requireModerator, type RuntimeEnv } from "../../../../lib/server/admin-auth";
import { fetchAdminReportDetail } from "../../../../lib/server/reports.server";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

export const GET: APIRoute = async ({ request, locals, params }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const reportId = String(params.id ?? "").trim();
    if (!reportId) return jsonResponse({ error: "REPORT_ID_REQUIRED" }, 400);

    const auth = await requireModerator(request, env);
    const detail = await fetchAdminReportDetail(auth.client, reportId);
    if (!detail) return jsonResponse({ error: "REPORT_NOT_FOUND" }, 404);
    return jsonResponse(detail);
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
