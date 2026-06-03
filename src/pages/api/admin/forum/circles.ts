import type { APIRoute } from "astro";
import { jsonResponse, requireModerator, type RuntimeEnv } from "../../../../lib/server/admin-auth";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function validateBase(payload: { name?: string; slug?: string; description?: string; type?: string; image_path?: string | null }) {
  const name = String(payload.name ?? "").trim();
  const slug = normalizeSlug(String(payload.slug ?? ""));
  const description = String(payload.description ?? "").trim();
  const type = String(payload.type ?? "").trim();
  const imagePath = typeof payload.image_path === "string" ? payload.image_path.trim() : null;

  if (name.length < 2 || name.length > 60) return { error: "Circle name must be 2-60 characters" };
  if (!slug || slug.length < 2 || slug.length > 80) return { error: "Invalid circle slug" };
  if (description.length < 6 || description.length > 280) return { error: "Circle description must be 6-280 characters" };
  if (!["topic", "device", "project"].includes(type)) return { error: "Invalid circle type" };
  if (imagePath && imagePath.length > 500) return { error: "Circle image path is too long" };

  return { name, slug, description, type, imagePath };
}

async function checkDuplicates(
  client: Awaited<ReturnType<typeof requireModerator>>["client"],
  params: { name?: string; slug?: string; excludeId?: string },
) {
  const { name, slug, excludeId } = params;

  if (slug) {
    let query = client.from("circles").select("id").eq("slug", slug).limit(1);
    if (excludeId) query = query.neq("id", excludeId);
    const { data, error } = await query;
    if (error) return { error: error.message };
    if ((data ?? []).length > 0) return { error: "CIRCLE_SLUG_ALREADY_EXISTS", status: 409 };
  }

  if (name) {
    let query = client.from("circles").select("id,name").ilike("name", name).limit(5);
    if (excludeId) query = query.neq("id", excludeId);
    const { data, error } = await query;
    if (error) return { error: error.message };
    if ((data ?? []).some((circle) => String(circle.name ?? "").trim().toLowerCase() === name.toLowerCase())) {
      return { error: "CIRCLE_NAME_ALREADY_EXISTS", status: 409 };
    }
  }

  return null;
}

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const { client } = await requireModerator(request, env);
    const { data, error } = await client
      .from("circles")
      .select("id,slug,name,description,type,created_at,updated_at,image_path,owner_id,profiles:owner_id(id,username,display_name,avatar_url,role)")
      .order("created_at", { ascending: false });

    if (error) return jsonResponse({ error: error.message }, 500);

    return jsonResponse({
      circles: (data ?? []).map((circle) => ({
        id: circle.id,
        slug: circle.slug,
        name: circle.name,
        description: circle.description,
        type: circle.type,
        created_at: circle.created_at,
        updated_at: circle.updated_at,
        image_path: circle.image_path ?? null,
        owner_id: circle.owner_id ?? null,
        owner_profile: circle.profiles
          ? {
              id: circle.profiles.id ?? circle.owner_id ?? null,
              username: circle.profiles.username ?? null,
              display_name: circle.profiles.display_name ?? null,
              avatar_url: circle.profiles.avatar_url ?? null,
              role: circle.profiles.role ?? null,
            }
          : null,
      })),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const auth = await requireModerator(request, env);
    const payload = (await request.json().catch(() => null)) as
      | { name?: string; slug?: string; description?: string; type?: string; image_path?: string | null; owner_id?: string | null }
      | null;

    if (!payload) return jsonResponse({ error: "Invalid JSON payload" }, 400);
    const parsed = validateBase(payload);
    if ("error" in parsed) return jsonResponse({ error: parsed.error }, 400);

    const duplicate = await checkDuplicates(auth.client, { name: parsed.name, slug: parsed.slug });
    if (duplicate) return jsonResponse({ error: duplicate.error }, duplicate.status ?? 500);

    const { data, error } = await auth.client
      .from("circles")
      .insert({
        slug: parsed.slug,
        name: parsed.name,
        description: parsed.description,
        type: parsed.type,
        image_path: parsed.imagePath,
        owner_id: payload.owner_id?.trim() || auth.user.id,
      })
      .select("id,slug,name,description,type,created_at,updated_at,image_path,owner_id")
      .single();

    if (error) {
      if (/circles_name_lower_unique_idx|duplicate key value/i.test(error.message) && /name/i.test(error.message)) {
        return jsonResponse({ error: "CIRCLE_NAME_ALREADY_EXISTS" }, 409);
      }
      if (/circles_slug_key|duplicate key value/i.test(error.message) && /slug/i.test(error.message)) {
        return jsonResponse({ error: "CIRCLE_SLUG_ALREADY_EXISTS" }, 409);
      }
      return jsonResponse({ error: error.message }, 500);
    }

    return jsonResponse({ circle: data }, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as RuntimeLocals).runtime?.env;
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);

    const auth = await requireModerator(request, env);
    const payload = (await request.json().catch(() => null)) as
      | { id?: string; name?: string; description?: string; type?: string; image_path?: string | null }
      | null;

    const id = String(payload?.id ?? "").trim();
    if (!id) return jsonResponse({ error: "Missing circle id" }, 400);

    const updates: Record<string, string | null> = {};

    if (payload && "name" in payload) {
      const name = String(payload.name ?? "").trim();
      if (name.length < 2 || name.length > 60) return jsonResponse({ error: "Circle name must be 2-60 characters" }, 400);
      updates.name = name;
    }
    if (payload && "description" in payload) {
      const description = String(payload.description ?? "").trim();
      if (description.length < 6 || description.length > 280) return jsonResponse({ error: "Circle description must be 6-280 characters" }, 400);
      updates.description = description;
    }
    if (payload && "type" in payload) {
      const type = String(payload.type ?? "").trim();
      if (!["topic", "device", "project"].includes(type)) return jsonResponse({ error: "Invalid circle type" }, 400);
      updates.type = type;
    }
    if (payload && "image_path" in payload) {
      const imagePath = typeof payload.image_path === "string" ? payload.image_path.trim() : null;
      if (imagePath && imagePath.length > 500) return jsonResponse({ error: "Circle image path is too long" }, 400);
      updates.image_path = imagePath;
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ error: "Nothing to update" }, 400);
    }

    if (typeof updates.name === "string") {
      const duplicate = await checkDuplicates(auth.client, { name: updates.name, excludeId: id });
      if (duplicate) return jsonResponse({ error: duplicate.error }, duplicate.status ?? 500);
    }

    const { data, error } = await auth.client
      .from("circles")
      .update(updates)
      .eq("id", id)
      .select("id,slug,name,description,type,created_at,updated_at,image_path,owner_id")
      .single();

    if (error) {
      if (/circles_name_lower_unique_idx|duplicate key value/i.test(error.message) && /name/i.test(error.message)) {
        return jsonResponse({ error: "CIRCLE_NAME_ALREADY_EXISTS" }, 409);
      }
      return jsonResponse({ error: error.message }, 500);
    }

    return jsonResponse({ circle: data });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
