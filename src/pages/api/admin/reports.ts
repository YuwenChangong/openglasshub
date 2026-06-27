import type { APIRoute } from "astro";
import { jsonResponse, requireModerator, type RuntimeEnv } from "../../../lib/server/admin-auth";
import {
  fetchAdminReportsQueue,
  REPORT_PRIORITIES,
  REPORT_REASON_CODES,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
} from "../../../lib/server/reports.server";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

function sanitizeFilter(value: string | null, allowed: readonly string[]) {
  if (!value || value === "all") return "all";
  return allowed.includes(value) ? value : "all";
}

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const auth = await requireModerator(request, env);
    const url = new URL(request.url);
    const limitRaw = Number.parseInt(String(url.searchParams.get("limit") ?? "80"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 80;
    const status = sanitizeFilter(url.searchParams.get("status"), REPORT_STATUSES);
    const targetType = sanitizeFilter(url.searchParams.get("target_type"), REPORT_TARGET_TYPES);
    const reasonCode = sanitizeFilter(url.searchParams.get("reason_code"), REPORT_REASON_CODES);
    const priority = sanitizeFilter(url.searchParams.get("priority"), REPORT_PRIORITIES);

    const reports = await fetchAdminReportsQueue({
      client: auth.client,
      limit,
      status,
      targetType,
      reasonCode,
      priority,
    });

    return jsonResponse({
      reports,
      filters: {
        status,
        target_type: targetType,
        reason_code: reasonCode,
        priority,
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
