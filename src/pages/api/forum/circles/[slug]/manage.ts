import type { APIRoute } from "astro";
import { requireManagedCircleBySlug, jsonResponse } from "../../../../../lib/server/circle-management";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: Record<string, string | undefined> } };

export const GET: APIRoute = async ({ request, params, locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
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

    return jsonResponse({
      can_manage: true,
      role: auth.profile.role,
      is_owner: auth.circle.owner_id === auth.user.id,
      circle: {
        ...auth.circle,
        description: auth.circle.description ?? "",
        image_path: auth.circle.image_path ?? null,
        owner_id: auth.circle.owner_id ?? null,
        post_count: postCount ?? 0,
        comment_count: totalComments,
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    const slug = String(params.slug ?? "").trim().toLowerCase();
    if (!env) return jsonResponse({ error: "RUNTIME_ENV_MISSING" }, 500);
    if (!slug) return jsonResponse({ error: "MISSING_CIRCLE_SLUG" }, 400);

    const auth = await requireManagedCircleBySlug({ request, env, slug });
    const payload = (await request.json().catch(() => null)) as
      | { name?: string; description?: string | null; image_path?: string | null }
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
    if (Object.keys(updates).length === 0) {
      return jsonResponse({ error: "NOTHING_TO_UPDATE" }, 400);
    }

    const { data, error } = await auth.client
      .from("circles")
      .update(updates)
      .eq("id", auth.circle.id)
      .select("id, slug, name, description, type, created_at, updated_at, image_path, owner_id")
      .single();

    if (error) {
      if (/circles_name_lower_unique|duplicate key value/i.test(error.message) && /name/i.test(error.message)) {
        return jsonResponse({ error: "CIRCLE_NAME_ALREADY_EXISTS" }, 409);
      }
      return jsonResponse({ error: "CIRCLE_MANAGE_QUERY_FAILED", details: error.message }, 500);
    }

    return jsonResponse({ circle: data });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: "CIRCLE_MANAGE_QUERY_FAILED", details: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
