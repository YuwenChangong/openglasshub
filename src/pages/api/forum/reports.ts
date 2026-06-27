import type { APIRoute } from "astro";
import {
  createUserClient,
  getBearerToken,
  jsonResponse,
  requireEnv,
  type RuntimeEnv,
} from "../../../lib/server/admin-auth";
import {
  countRecentReportsByUser,
  createUserReport,
  getUserReportTargetPreview,
  parseUserReportPayload,
  resolveReportTargetPreview,
  sanitizeReportReasonText,
} from "../../../lib/server/reports.server";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

type LegacyReportPayload = {
  post_id?: string;
  reason?: string;
};

function parsePayload(payload: unknown) {
  const record = (payload ?? {}) as Record<string, unknown> & LegacyReportPayload;
  if (record.post_id) {
    return parseUserReportPayload({
      target_type: "post",
      target_id: record.post_id,
      reason_code: "other",
      reason_text: sanitizeReportReasonText(record.reason),
    });
  }
  return parseUserReportPayload(payload);
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const token = getBearerToken(request);
    if (!token) return jsonResponse({ error: "Missing bearer token" }, 401);

    const client = createUserClient(env, token);
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user) {
      return jsonResponse({ error: "Invalid auth token" }, 401);
    }

    const payload = await request.json().catch(() => null);
    const parsed = parsePayload(payload);
    if (!parsed.ok) {
      return jsonResponse({ error: parsed.error }, parsed.status);
    }

    let recentCount = 0;
    try {
      recentCount = await countRecentReportsByUser(client, authData.user.id, 60 * 60 * 1000);
    } catch (error) {
      return jsonResponse(
        {
          error: "REPORT_RATE_LIMIT_QUERY_FAILED",
          details: error instanceof Error ? error.message : "Unexpected report rate limit error",
        },
        500,
      );
    }

    if (recentCount >= 12) {
      return jsonResponse({ error: "RATE_LIMITED" }, 429);
    }

    const resolved = await resolveReportTargetPreview(client, parsed.targetType, parsed.targetId);
    if (resolved.error) {
      return jsonResponse({ error: "REPORT_TARGET_LOOKUP_FAILED", details: resolved.error }, 500);
    }
    if (!resolved.exists) {
      return jsonResponse({ error: "REPORT_TARGET_NOT_FOUND" }, 404);
    }
    if (!resolved.available) {
      return jsonResponse(
        {
          ok: true,
          duplicate: false,
          already_handled: true,
          target: getUserReportTargetPreview(resolved.target),
        },
        200,
      );
    }

    const created = await createUserReport({
      client,
      reporterId: authData.user.id,
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      reasonCode: parsed.reasonCode,
      reasonText: parsed.reasonText,
    });

    return jsonResponse(
      {
        ok: true,
        duplicate: created.duplicate,
        report: created.report,
        target: getUserReportTargetPreview(resolved.target),
      },
      created.duplicate ? 200 : 201,
    );
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected server error" },
      500,
    );
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
