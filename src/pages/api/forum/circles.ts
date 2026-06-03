import type { APIRoute } from "astro";
import { isPublicVisibleCircle } from "../../../lib/site-navigation";
import { fetchCirclesWithFallback } from "../../../lib/circle-data";
import {
  createAnonClient,
  jsonResponse,
  normalizeCircleSlug,
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
  params: { name?: string; slug?: string; excludeId?: string },
) {
  if (params.slug) {
    let query = client.from("circles").select("id").eq("slug", params.slug).limit(1);
    if (params.excludeId) query = query.neq("id", params.excludeId);
    const { data, error } = await query;
    if (error) return { error: error.message };
    if ((data ?? []).length > 0) return { error: "CIRCLE_SLUG_ALREADY_EXISTS", status: 409 };
  }

  if (params.name) {
    let query = client.from("circles").select("id, name").ilike("name", params.name).limit(8);
    if (params.excludeId) query = query.neq("id", params.excludeId);
    const { data, error } = await query;
    if (error) return { error: error.message };
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
      | { slug?: string; name?: string; description?: string | null; type?: string; image_path?: string | null }
      | null;

    if (!payload) return jsonResponse({ error: "Invalid JSON payload" }, 400);

    const slug = normalizeCircleSlug(String(payload.slug ?? payload.name ?? ""));
    const name = String(payload.name ?? "").trim();
    const description = typeof payload.description === "string" ? payload.description.trim() : "";
    const type = String(payload.type ?? "").trim();
    const imagePath = typeof payload.image_path === "string" ? payload.image_path.trim() : null;

    if (!slug || slug.length < 2 || slug.length > 80) {
      return jsonResponse({ error: "Invalid circle slug" }, 400);
    }
    if (name.length < 2 || name.length > 40) {
      return jsonResponse({ error: "Circle name must be 2-40 characters" }, 400);
    }
    if (description.length > 200) {
      return jsonResponse({ error: "Circle description must be <=200 characters" }, 400);
    }
    if (!validateType(type)) {
      return jsonResponse({ error: "Invalid circle type" }, 400);
    }
    if (imagePath && imagePath.length > 500) {
      return jsonResponse({ error: "Circle image path is too long" }, 400);
    }

    const duplicate = await findDuplicateCircle(auth.client, { name, slug });
    if (duplicate) {
      return jsonResponse({ error: duplicate.error }, duplicate.status ?? 500);
    }

    const { data, error } = await auth.client
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

    if (error) {
      if (/circles_name_lower_unique|duplicate key value/i.test(error.message) && /name/i.test(error.message)) {
        return jsonResponse({ error: "CIRCLE_NAME_ALREADY_EXISTS" }, 409);
      }
      if (/circles_slug_key|duplicate key value/i.test(error.message) && /slug/i.test(error.message)) {
        return jsonResponse({ error: "CIRCLE_SLUG_ALREADY_EXISTS" }, 409);
      }
      if (isMissingCircleOwnerSchemaError(error.message)) {
        return jsonResponse({
          error: "当前数据库还没有开放普通用户创建圈子。先执行最新 Supabase migration 后，用户才能自由创建圈子并写入 owner。",
        }, 503);
      }
      return jsonResponse({ error: error.message }, 500);
    }

    return jsonResponse({ circle: data }, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected server error" },
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

    if (!payload) return jsonResponse({ error: "Invalid JSON payload" }, 400);

    const id = String(payload.id ?? "").trim();
    const slug = normalizeCircleSlug(String(payload.slug ?? ""));
    if (!id && !slug) {
      return jsonResponse({ error: "Missing circle id or slug" }, 400);
    }

    const currentCircleQuery = auth.client
      .from("circles")
      .select("id, slug, owner_id")
      .limit(1);
    const { data: currentCircle, error: currentCircleError } = id
      ? await currentCircleQuery.eq("id", id).maybeSingle()
      : await currentCircleQuery.eq("slug", slug).maybeSingle();

    if (currentCircleError) {
      return jsonResponse({ error: currentCircleError.message }, 500);
    }
    if (!currentCircle) {
      return jsonResponse({ error: "Circle not found" }, 404);
    }
    if (!isCircleManager(currentCircle.owner_id, auth.user.id, auth.profile.role)) {
      return jsonResponse({ error: "你没有权限修改这个圈子。仅圈子 owner 或管理员可修改。" }, 403);
    }

    const updates: Record<string, string | null> = {};
    if ("name" in payload) {
      const nextName = String(payload.name ?? "").trim();
      if (nextName.length < 2 || nextName.length > 40) {
        return jsonResponse({ error: "Circle name must be 2-40 characters" }, 400);
      }
      const duplicate = await findDuplicateCircle(auth.client, { name: nextName, excludeId: currentCircle.id });
      if (duplicate) return jsonResponse({ error: duplicate.error }, duplicate.status ?? 500);
      updates.name = nextName;
    }
    if ("description" in payload) {
      const nextDescription = typeof payload.description === "string" ? payload.description.trim() : "";
      if (nextDescription.length > 200) {
        return jsonResponse({ error: "Circle description must be <=200 characters" }, 400);
      }
      updates.description = nextDescription || null;
    }
    if ("image_path" in payload) {
      const imagePath = typeof payload.image_path === "string" ? payload.image_path.trim() : null;
      if (imagePath && imagePath.length > 500) {
        return jsonResponse({ error: "Circle image path is too long" }, 400);
      }
      updates.image_path = imagePath;
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ error: "Nothing to update" }, 400);
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
        return jsonResponse({ error: "当前数据库还没有启用圈子 owner / image_path 字段，请先执行最新 Supabase migration。" }, 503);
      }
      return jsonResponse({ error: error.message }, 500);
    }

    return jsonResponse({ circle: data });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected server error" },
      500,
    );
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
