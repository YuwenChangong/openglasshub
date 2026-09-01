import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { resolveCircleCoverUrl } from "../../../../../lib/circle-cover";
import { CIRCLE_COVER_PREFIX } from "../../../../../lib/circle-cover";
import { moderateAsset } from "../../../../../lib/moderation/moderate-asset.server";
import {
  isLocalDegradedModerationResult,
  isProviderErrorModerationResult,
  moderateContent,
} from "../../../../../lib/moderation/moderate-content.server";
import { createSignedModerationUrls, removeStoragePathIfAllowed } from "../../../../../lib/moderation/moderation-media.server";
import { buildModerationProviderInput, isOpenAICircleCoverModerationEnabled } from "../../../../../lib/moderation/moderation-provider.server";
import { requireManagedCircleBySlug, jsonResponse } from "../../../../../lib/server/circle-management";
import { assertUserCanWrite, getSafetyWriteBlockResponse } from "../../../../../lib/server/user-safety.server";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: Record<string, string | undefined> } };

function isMissingCircleStatusError(message: string) {
  return /status/i.test(message) && /does not exist/i.test(message);
}

function isCircleDeleteRlsError(message: string) {
  return /row-level security|permission denied/i.test(message);
}

async function moderateCircleCoverImage(params: {
  client: Awaited<ReturnType<typeof requireManagedCircleBySlug>>["client"];
  env: Record<string, string | undefined>;
  imagePath: string | null;
}) {
  if (!params.imagePath || !isOpenAICircleCoverModerationEnabled(params.env)) {
    return { decision: "allow" as const, reason: null as string | null };
  }

  const imageUrls = await createSignedModerationUrls({
    client: params.client,
    values: [params.imagePath],
    allowedPrefixes: [CIRCLE_COVER_PREFIX],
    preferDataUrls: true,
  });

  return moderateAsset(
    params.env,
    buildModerationProviderInput({
      targetType: "circle_cover_image",
      imageUrls,
      localeHint: "zh-CN",
    }),
  );
}

export const GET: APIRoute = async ({ request, params, locals }) => {
  try {
    const env = runtimeEnv;
    const slug = String(params.slug ?? "").trim().toLowerCase();
    if (!env) return jsonResponse({ error: "RUNTIME_ENV_MISSING" }, 500);
    if (!slug) return jsonResponse({ error: "MISSING_CIRCLE_SLUG" }, 400);

    const auth = await requireManagedCircleBySlug({ request, env, slug });

    const [{ count: postCount }, { data: postIds }] = await Promise.all([
      auth.client
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("circle_id", auth.circle.id),
      auth.client
        .from("posts")
        .select("id", { count: "exact" })
        .eq("circle_id", auth.circle.id),
    ]);

    let totalComments = 0;
    if ((postIds ?? []).length > 0) {
      const { count } = await auth.client
        .from("comments")
        .select("id", { count: "exact", head: true })
        .in("post_id", (postIds ?? []).map((post) => post.id));
      totalComments = count ?? 0;
    }

    const coverUrl = await resolveCircleCoverUrl(auth.client, auth.circle.image_path ?? null);

    return jsonResponse({
      ok: true,
      circle: {
        ...auth.circle,
        description: auth.circle.description ?? "",
        image_path: auth.circle.image_path ?? null,
        cover_url: coverUrl,
        owner_id: auth.circle.owner_id ?? null,
        post_count: postCount ?? 0,
        comment_count: totalComments,
      },
      viewer: {
        id: auth.user.id,
        role: auth.profile.role ?? null,
        is_owner: auth.circle.owner_id === auth.user.id,
        can_manage: true,
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: "CIRCLE_MANAGE_QUERY_FAILED", details: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  try {
    const env = runtimeEnv;
    const slug = String(params.slug ?? "").trim().toLowerCase();
    if (!env) return jsonResponse({ error: "RUNTIME_ENV_MISSING" }, 500);
    if (!slug) return jsonResponse({ error: "MISSING_CIRCLE_SLUG" }, 400);

    const auth = await requireManagedCircleBySlug({ request, env, slug });
    const safetyDecision = await assertUserCanWrite(auth.client, auth.user.id, "circle_update");
    if (!safetyDecision.allowed) {
      return getSafetyWriteBlockResponse(safetyDecision);
    }
    const payload = (await request.json().catch(() => null)) as
      | { name?: string; description?: string | null; image_path?: string | null; status?: string }
      | null;

    if (!payload) return jsonResponse({ error: "INVALID_JSON_PAYLOAD" }, 400);

    const updates: Record<string, string | null> = {};
    if ("name" in payload) {
      const name = String(payload.name ?? "").trim();
      if (name.length < 2 || name.length > 40) {
        return jsonResponse({ error: "INVALID_CIRCLE_NAME" }, 400);
      }
      const { data: duplicateName, error: duplicateError } = await auth.client
        .from("circles")
        .select("id, name")
        .ilike("name", name)
        .neq("id", auth.circle.id)
        .limit(8);
      if (duplicateError) return jsonResponse({ error: "CIRCLE_MANAGE_QUERY_FAILED", details: duplicateError.message }, 500);
      if ((duplicateName ?? []).some((circle) => String(circle.name ?? "").trim().toLowerCase() === name.toLowerCase())) {
        return jsonResponse({ error: "CIRCLE_NAME_ALREADY_EXISTS" }, 409);
      }
      updates.name = name;
    }
    if ("description" in payload) {
      const description = typeof payload.description === "string" ? payload.description.trim() : "";
      if (description.length > 200) {
        return jsonResponse({ error: "INVALID_CIRCLE_DESCRIPTION" }, 400);
      }
      updates.description = description || null;
    }
    if ("image_path" in payload) {
      const imagePath = typeof payload.image_path === "string" ? payload.image_path.trim() : null;
      if (imagePath && imagePath.length > 500) {
        return jsonResponse({ error: "INVALID_CIRCLE_IMAGE_PATH" }, 400);
      }
      updates.image_path = imagePath;
    }
    if ("status" in payload) {
      const status = String(payload.status ?? "").trim();
      if (!["active", "deleted"].includes(status)) {
        return jsonResponse({ error: "INVALID_CIRCLE_STATUS" }, 400);
      }
      updates.status = status;
    }
    if (Object.keys(updates).length === 0) {
      return jsonResponse({ error: "NOTHING_TO_UPDATE" }, 400);
    }

    if ("name" in updates || "description" in updates) {
      const moderation = await moderateContent(env, {
        contentType: typeof updates.description === "string" ? "circle_description" : "circle_name",
        userId: auth.user.id,
        text: [typeof updates.name === "string" ? updates.name : "", typeof updates.description === "string" ? updates.description : ""]
          .filter(Boolean)
          .join("\n\n"),
        localInputs: [
          ...(typeof updates.name === "string" ? [{ contentType: "circle_name" as const, text: updates.name }] : []),
          ...(typeof updates.description === "string"
            ? [{ contentType: "circle_description" as const, text: updates.description }]
            : []),
        ],
        providerInput: {
          targetType: "circle_text",
          title: typeof updates.name === "string" ? updates.name : undefined,
          description: typeof updates.description === "string" ? updates.description : undefined,
          localeHint: "zh-CN",
        },
      });

      if (moderation.decision !== "allow") {
        const unavailable = moderation.decision === "review" && isProviderErrorModerationResult(moderation);
        return jsonResponse(
          {
            error: unavailable ? "MODERATION_TEMPORARILY_UNAVAILABLE" : "CONTENT_REJECTED",
            message: unavailable
              ? "Circle moderation is temporarily unavailable. Please try again later."
              : "This circle update could not be published because it may violate community rules.",
          },
          unavailable ? 503 : 403,
        );
      }

      if (isLocalDegradedModerationResult(moderation)) {
        console.warn("[moderation] local-only degraded allow", {
          targetType: "circle_text",
          userId: auth.user.id,
          circleId: auth.circle.id,
          reason: moderation.reason,
          provider: moderation.provider,
          status: moderation.providerDetails?.providerStatus ?? null,
        });
      }
    }

    if ("image_path" in updates) {
      const coverModeration = await moderateCircleCoverImage({
        client: auth.client,
        env,
        imagePath: updates.image_path ?? null,
      });
      if (coverModeration.decision !== "allow") {
        await removeStoragePathIfAllowed({
          client: auth.client,
          value: updates.image_path ?? null,
          allowedPrefixes: [CIRCLE_COVER_PREFIX],
          logLabel: "circle-cover-moderation",
        });
        return jsonResponse(
          {
            error: "CONTENT_REJECTED",
            message: "This circle cover could not be published because it may violate community rules.",
          },
          coverModeration.reason?.startsWith("openai_provider_error_") ? 503 : 403,
        );
      }
    }

    let { data, error } = await auth.client
      .from("circles")
      .update(updates)
      .eq("id", auth.circle.id)
      .select("id, slug, name, description, type, status, created_at, updated_at, image_path, owner_id")
      .single();

    if (error && isMissingCircleStatusError(error.message) && !("status" in payload)) {
      const fallback = await auth.client
        .from("circles")
        .update(updates)
        .eq("id", auth.circle.id)
        .select("id, slug, name, description, type, created_at, updated_at, image_path, owner_id")
        .single();
      data = fallback.data
        ? {
            ...fallback.data,
            status: "active",
          }
        : null;
      error = fallback.error;
    }

    if (error) {
      if (/circles_name_lower_unique|duplicate key value/i.test(error.message) && /name/i.test(error.message)) {
        return jsonResponse({ error: "CIRCLE_NAME_ALREADY_EXISTS" }, 409);
      }
      if (isMissingCircleStatusError(error.message) && "status" in payload) {
        return jsonResponse({ error: "CIRCLE_STATUS_SCHEMA_NOT_READY", details: error.message }, 503);
      }
      return jsonResponse({ error: "CIRCLE_MANAGE_QUERY_FAILED", details: error.message }, 500);
    }

    return jsonResponse({
      circle: data
        ? {
            ...data,
            cover_url: await resolveCircleCoverUrl(auth.client, data.image_path ?? null),
          }
        : data,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: "CIRCLE_MANAGE_QUERY_FAILED", details: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const DELETE: APIRoute = async ({ request, params, locals }) => {
  try {
    const env = runtimeEnv;
    const slug = String(params.slug ?? "").trim().toLowerCase();
    if (!env) return jsonResponse({ error: "RUNTIME_ENV_MISSING" }, 500);
    if (!slug) return jsonResponse({ error: "MISSING_CIRCLE_SLUG" }, 400);

    const auth = await requireManagedCircleBySlug({ request, env, slug });
    const safetyDecision = await assertUserCanWrite(auth.client, auth.user.id, "circle_update");
    if (!safetyDecision.allowed) {
      return getSafetyWriteBlockResponse(safetyDecision);
    }
    const { data, error } = await auth.client
      .from("circles")
      .update({ status: "deleted" })
      .eq("id", auth.circle.id)
      .select("id, slug, name, description, type, status, created_at, updated_at, image_path, owner_id")
      .single();

    if (error) {
      if (isMissingCircleStatusError(error.message)) {
        return jsonResponse({ error: "CIRCLE_STATUS_COLUMN_MISSING", details: error.message }, 503);
      }
      if (isCircleDeleteRlsError(error.message)) {
        return jsonResponse({ error: "CIRCLE_DELETE_RLS_FAILED", details: error.message }, 403);
      }
      return jsonResponse({ error: "CIRCLE_DELETE_FAILED", details: error.message }, 500);
    }

    return jsonResponse({
      ok: true,
      circle: data,
      message: "圈子已删除。",
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: "CIRCLE_DELETE_FAILED", details: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
