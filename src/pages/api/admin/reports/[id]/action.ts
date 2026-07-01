import type { APIRoute } from "astro";
import { jsonResponse, requireModerator, type RuntimeEnv } from "../../../../../lib/server/admin-auth";
import {
  applyAdminReportAction,
  fetchAdminReportDetail,
  sanitizeReportResolutionNote,
  type ReportAdminAction,
} from "../../../../../lib/server/reports.server";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

const ALLOWED_ACTIONS: ReportAdminAction[] = [
  "dismiss",
  "reviewing",
  "hide_target",
  "reject_target",
  "warn_user",
  "suspend_user",
  "ban_user",
];

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const reportId = String(params.id ?? "").trim();
    if (!reportId) return jsonResponse({ error: "REPORT_ID_REQUIRED" }, 400);

    const auth = await requireModerator(request, env);
    const payload = (await request.json().catch(() => null)) as
      | { action?: string; note?: string | null; until?: string | null }
      | null;

    const action = String(payload?.action ?? "").trim() as ReportAdminAction;
    if (!ALLOWED_ACTIONS.includes(action)) {
      return jsonResponse({ error: "INVALID_REPORT_ACTION" }, 400);
    }

    const note = sanitizeReportResolutionNote(payload?.note);
    const result = await applyAdminReportAction({
      client: auth.client,
      moderatorId: auth.user.id,
      reportId,
      action,
      note: note || null,
      until: typeof payload?.until === "string" ? payload.until : null,
    });

    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.status);
    }

    const detail = await fetchAdminReportDetail(auth.client, reportId);
    return jsonResponse({
      ok: true,
      report: detail?.report ?? result.report,
      events: detail?.events ?? [],
      safety_state: "safety_state" in result ? result.safety_state ?? null : null,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
