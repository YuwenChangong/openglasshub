import type { APIRoute } from "astro";
import { buildUniqueCircleSlug, slugifyCircleName } from "../../../lib/circle-slug";
import { isPublicVisibleCircle } from "../../../lib/site-navigation";
import { fetchCirclesWithFallback } from "../../../lib/circle-data";
import {
  createAnonClient,
  jsonResponse,
  requireForumUser,
  isCircleManager,
} from "../../../lib/server/circle-management";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: Record<string, string | undefined> } };

function isMissingCircleOwnerSchemaError(message: string) {
  return /owner_id|image_path/i.test(message) && /does not exist/i.test(message);
}

function validateType(type: string) {
  return ["topic", "device", "project"].includes(type);
}

async function findDuplicateCircle(
  client: ReturnType<typeof createAnonClient>,
  params: { name?: string; excludeId?: string },
) {
  if (params.name) {
    let query = client.from("circles").select("id, name").ilike("name", params.name).limit(8);
    if (params.excludeId) query = query.neq("id", params.excludeId);
    const { data, error } = await query;
    if (error) return { status: 500, details: error.message };
    if ((data ?? []).some((circle) => String(circle.name ?? "").trim().toLowerCase() === params.name?.toLowerCase())) {
      return { error: "CIRCLE_NAME_ALREADY_EXISTS", status: 409 };
    }
  }

  return null;
}

export const GET: APIRoute = async ({ locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) {
      return jsonResponse({ error: "Runtime environment not available" }, 500);
    }

    const supabase = createAnonClient(env);
    const { circles, error, supportsExtendedSchema } = await fetchCirclesWithFallback(supabase);
    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    return jsonResponse({
      circles: circles.filter((circle) => isPublicVisibleCircle(circle)),
      supportsExtendedSchema,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected server error" },
      500,
    );
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) {
      return jsonResponse({ error: "Runtime environment not available" }, 500);
    }

    const auth = await requireForumUser(request, env);
    const payload = (await request.json().catch(() => null)) as
      | { slug?: string; name?: string; description?: string | null; type?: string; image_path?: string | null; owner_id?: string | null }
      | null;

    if (!payload) return jsonResponse({ error: "INVALID_JSON_PAYLOAD" }, 400);

    const name = String(payload.name ?? "").trim();
    const description = typeof payload.description === "string" ? payload.description.trim() : "";
    const type = String(payload.type ?? "").trim();
    const imagePath = typeof payload.image_path === "string" ? payload.image_path.trim() : null;
    const requestedOwnerId = typeof payload.owner_id === "string" ? payload.owner_id.trim() : "";

    if (name.length < 2 || name.length > 40) {
      return jsonResponse({ error: "INVALID_CIRCLE_NAME" }, 400);
    }
    if (description.length > 200) {
      return jsonResponse({ error: "INVALID_CIRCLE_DESCRIPTION" }, 400);
    }
    if (!validateType(type)) {
      return jsonResponse({ error: "INVALID_CIRCLE_TYPE" }, 400);
    }
    if (imagePath && imagePath.length > 500) {
      return jsonResponse({ error: "INVALID_CIRCLE_IMAGE_PATH" }, 400);
    }
    if (requestedOwnerId && requestedOwnerId !== auth.user.id) {
      return jsonResponse({ error: "CIRCLE_CREATE_FAILED", details: "owner_id is assigned by the server." }, 400);
    }

    const duplicate = await findDuplicateCircle(auth.client, { name });
    if (duplicate) {
      if (!duplicate.error) {
        return jsonResponse({ error: "CIRCLE_CREATE_FAILED", details: duplicate.details ?? "Duplicate lookup failed" }, 500);
      }
      return jsonResponse({ error: duplicate.error }, duplicate.status ?? 500);
    }

    const slugBase = slugifyCircleName(name);

    async function insertCircleWithSlug(slug: string) {
      return auth.client
        .from("circles")
        .insert({
          slug,
          name,
          description: description || null,
          type,
          image_path: imagePath,
          owner_id: auth.user.id,
        })
        .select("id, slug, name, description, type, image_path, owner_id")
        .single();
    }

    let generatedSlug = await buildUniqueCircleSlug(auth.client, name);
    let { data, error } = await insertCircleWithSlug(generatedSlug);

    if (error && /circles_slug_key|duplicate key value/i.test(error.message) && /slug/i.test(error.message)) {
      generatedSlug = await buildUniqueCircleSlug(auth.client, `${slugBase}-${Date.now()}`);
      const retry = await insertCircleWithSlug(generatedSlug);
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      if (/circles_name_lower_unique|duplicate key value/i.test(error.message) && /name/i.test(error.message)) {
        return jsonResponse({ error: "CIRCLE_NAME_ALREADY_EXISTS" }, 409);
      }
      if (/circles_slug_key|duplicate key value/i.test(error.message) && /slug/i.test(error.message)) {
        return jsonResponse({ error: "CIRCLE_CREATE_FAILED", details: "Circle slug generation conflict persisted after retry." }, 500);
      }
      if (isMissingCircleOwnerSchemaError(error.message)) {
        return jsonResponse({
          error: "CIRCLE_OWNER_RLS_NOT_READY",
          details: "Circle owner schema or RLS is not ready in the database.",
        }, 503);
      }
      return jsonResponse({ error: "CIRCLE_CREATE_FAILED", details: error.message }, 500);
    }

    return jsonResponse({ circle: data }, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse(
      { error: "CIRCLE_CREATE_FAILED", details: error instanceof Error ? error.message : "Unexpected server error" },
      500,
    );
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) {
      return jsonResponse({ error: "Runtime environment not available" }, 500);
    }

    const auth = await requireForumUser(request, env);
    const payload = (await request.json().catch(() => null)) as
      | { id?: string; slug?: string; name?: string; description?: string | null; image_path?: string | null }
      | null;

    if (!payload) return jsonResponse({ error: "INVALID_JSON_PAYLOAD" }, 400);

    const id = String(payload.id ?? "").trim();
    const slug = String(payload.slug ?? "").trim();
    if (!id && !slug) {
      return jsonResponse({ error: "MISSING_CIRCLE_ID_OR_SLUG" }, 400);
    }

    const currentCircleQuery = auth.client
      .from("circles")
      .select("id, slug, owner_id")
      .limit(1);
    const { data: currentCircle, error: currentCircleError } = id
      ? await currentCircleQuery.eq("id", id).maybeSingle()
      : await currentCircleQuery.eq("slug", slug).maybeSingle();

    if (currentCircleError) {
      return jsonResponse({ error: "CIRCLE_MANAGE_QUERY_FAILED", details: currentCircleError.message }, 500);
    }
    if (!currentCircle) {
      return jsonResponse({ error: "CIRCLE_NOT_FOUND" }, 404);
    }
    if (!isCircleManager(currentCircle.owner_id, auth.user.id, auth.profile.role)) {
      return jsonResponse({ error: "CIRCLE_MANAGE_FORBIDDEN" }, 403);
    }

    const updates: Record<string, string | null> = {};
    if ("name" in payload) {
      const nextName = String(payload.name ?? "").trim();
      if (nextName.length < 2 || nextName.length > 40) {
        return jsonResponse({ error: "INVALID_CIRCLE_NAME" }, 400);
      }
      const duplicate = await findDuplicateCircle(auth.client, { name: nextName, excludeId: currentCircle.id });
      if (duplicate && !duplicate.error) {
        return jsonResponse({ error: "CIRCLE_MANAGE_QUERY_FAILED", details: duplicate.details ?? "Duplicate lookup failed" }, 500);
      }
      if (duplicate) return jsonResponse({ error: duplicate.error }, duplicate.status ?? 500);
      updates.name = nextName;
    }
    if ("description" in payload) {
      const nextDescription = typeof payload.description === "string" ? payload.description.trim() : "";
      if (nextDescription.length > 200) {
        return jsonResponse({ error: "INVALID_CIRCLE_DESCRIPTION" }, 400);
      }
      updates.description = nextDescription || null;
    }
    if ("image_path" in payload) {
      const imagePath = typeof payload.image_path === "string" ? payload.image_path.trim() : null;
      if (imagePath && imagePath.length > 500) {
        return jsonResponse({ error: "INVALID_CIRCLE_IMAGE_PATH" }, 400);
      }
      updates.image_path = imagePath;
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ error: "NOTHING_TO_UPDATE" }, 400);
    }

    const query = auth.client
      .from("circles")
      .update(updates)
      .eq("id", currentCircle.id)
      .select("id, slug, name, description, type, image_path, owner_id")
      .single();

    const { data, error } = await query;
    if (error) {
      if (/circles_name_lower_unique|duplicate key value/i.test(error.message) && /name/i.test(error.message)) {
        return jsonResponse({ error: "CIRCLE_NAME_ALREADY_EXISTS" }, 409);
      }
      if (isMissingCircleOwnerSchemaError(error.message)) {
        return jsonResponse({ error: "CIRCLE_OWNER_RLS_NOT_READY", details: error.message }, 503);
      }
      return jsonResponse({ error: "CIRCLE_MANAGE_QUERY_FAILED", details: error.message }, 500);
    }

    return jsonResponse({ circle: data });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse(
      { error: "CIRCLE_MANAGE_QUERY_FAILED", details: error instanceof Error ? error.message : "Unexpected server error" },
      500,
    );
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
