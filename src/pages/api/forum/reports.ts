import type { APIRoute } from "astro";
import {
  createUserClient,
  getBearerToken,
  jsonResponse,
  requireEnv,
  type RuntimeEnv,
} from "../../../lib/server/admin-auth";
import { requireVerifiedApplicationSession } from "../../../lib/server/application-session.ts";
import {
  countRecentReportsByUser,
  createUserReport,
  getUserReportTargetPreview,
  parseUserReportPayload,
  resolveReportTargetPreview,
  sanitizeReportReasonText,
} from "../../../lib/server/reports.server";
import { requireAuthenticatedLegalConsent } from "../../../lib/server/legal-consent-mutation.server";
import { createLegalConsentReadRepository } from "../../../lib/server/legal-consent-repository.server";
import { assertUserCanWrite, getSafetyWriteBlockResponse } from "../../../lib/server/user-safety.server";

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

    const authData = await requireVerifiedApplicationSession(request, env);
    const client = authData.client;
    const consent = await requireAuthenticatedLegalConsent({
      identity: { userId: authData.user.id },
      repository: createLegalConsentReadRepository(client),
    });
    if (!consent.ok) return consent.response;

    const safetyDecision = await assertUserCanWrite(client, authData.user.id, "report_create");
    if (!safetyDecision.allowed) {
      return getSafetyWriteBlockResponse(safetyDecision);
    }

    const payload = await request.json().catch(() => null);
    const parsed = parsePayload(payload);
    if (!parsed.ok) {
      return jsonResponse({ error: parsed.error }, parsed.status);
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
    if (error instanceof Response) return error;
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected server error" },
      500,
    );
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
