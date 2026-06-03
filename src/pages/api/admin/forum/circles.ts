import type { APIRoute } from "astro";
import { jsonResponse, requireModerator, type RuntimeEnv } from "../../../../lib/server/admin-auth";
import { normalizeCircleSlug } from "../../../../lib/server/circle-management";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

function validateType(type: string) {
  return ["topic", "device", "project"].includes(type);
}

function validateDescription(description: string) {
  return description.length <= 200;
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
    let query = client.from("circles").select("id,name").ilike("name", name).limit(8);
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
    const { data: circles, error } = await client
      .from("circles")
      .select("id,slug,name,description,type,created_at,updated_at,image_path,owner_id,profiles:owner_id(id,username,display_name,avatar_url,role)")
      .order("created_at", { ascending: false });

    if (error) return jsonResponse({ error: error.message }, 500);

    const circleIds = (circles ?? []).map((circle) => circle.id);
    const { data: posts, error: postsError } = circleIds.length
      ? await client.from("posts").select("id,circle_id").in("circle_id", circleIds)
      : { data: [], error: null };
    if (postsError) return jsonResponse({ error: postsError.message }, 500);

    const postCountMap = new Map<string, number>();
    const postIds: string[] = [];
    for (const post of posts ?? []) {
      postIds.push(post.id);
      postCountMap.set(post.circle_id, (postCountMap.get(post.circle_id) ?? 0) + 1);
    }

    const { data: comments, error: commentsError } = postIds.length
      ? await client.from("comments").select("id,post_id").in("post_id", postIds)
      : { data: [], error: null };
    if (commentsError) return jsonResponse({ error: commentsError.message }, 500);

    const postToCircleMap = new Map((posts ?? []).map((post) => [post.id, post.circle_id]));
    const commentCountMap = new Map<string, number>();
    for (const comment of comments ?? []) {
      const circleId = postToCircleMap.get(comment.post_id);
      if (!circleId) continue;
      commentCountMap.set(circleId, (commentCountMap.get(circleId) ?? 0) + 1);
    }

    return jsonResponse({
      circles: (circles ?? []).map((circle) => ({
        id: circle.id,
        slug: circle.slug,
        name: circle.name,
        description: circle.description ?? "",
        type: circle.type,
        created_at: circle.created_at,
        updated_at: circle.updated_at,
        image_path: circle.image_path ?? null,
        owner_id: circle.owner_id ?? null,
        post_count: postCountMap.get(circle.id) ?? 0,
        comment_count: commentCountMap.get(circle.id) ?? 0,
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
      | { name?: string; slug?: string; description?: string | null; type?: string; image_path?: string | null; owner_id?: string | null }
      | null;

    if (!payload) return jsonResponse({ error: "Invalid JSON payload" }, 400);

    const name = String(payload.name ?? "").trim();
    const slug = normalizeCircleSlug(String(payload.slug ?? payload.name ?? ""));
    const description = typeof payload.description === "string" ? payload.description.trim() : "";
    const type = String(payload.type ?? "").trim();
    const imagePath = typeof payload.image_path === "string" ? payload.image_path.trim() : null;
    const ownerId = typeof payload.owner_id === "string" && payload.owner_id.trim() ? payload.owner_id.trim() : auth.user.id;

    if (name.length < 2 || name.length > 40) return jsonResponse({ error: "Circle name must be 2-40 characters" }, 400);
    if (!slug || slug.length < 2 || slug.length > 80) return jsonResponse({ error: "Invalid circle slug" }, 400);
    if (!validateDescription(description)) return jsonResponse({ error: "Circle description must be <=200 characters" }, 400);
    if (!validateType(type)) return jsonResponse({ error: "Invalid circle type" }, 400);
    if (imagePath && imagePath.length > 500) return jsonResponse({ error: "Circle image path is too long" }, 400);

    const duplicate = await checkDuplicates(auth.client, { name, slug });
    if (duplicate) return jsonResponse({ error: duplicate.error }, duplicate.status ?? 500);

    const { data, error } = await auth.client
      .from("circles")
      .insert({
        name,
        slug,
        description: description || null,
        type,
        image_path: imagePath,
        owner_id: ownerId,
      })
      .select("id,slug,name,description,type,created_at,updated_at,image_path,owner_id")
      .single();

    if (error) {
      if (/circles_name_lower_unique|duplicate key value/i.test(error.message) && /name/i.test(error.message)) {
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
      | { id?: string; name?: string; description?: string | null; type?: string; image_path?: string | null }
      | null;

    const id = String(payload?.id ?? "").trim();
    if (!id) return jsonResponse({ error: "Missing circle id" }, 400);

    const updates: Record<string, string | null> = {};
    if (payload && "name" in payload) {
      const name = String(payload.name ?? "").trim();
      if (name.length < 2 || name.length > 40) return jsonResponse({ error: "Circle name must be 2-40 characters" }, 400);
      const duplicate = await checkDuplicates(auth.client, { name, excludeId: id });
      if (duplicate) return jsonResponse({ error: duplicate.error }, duplicate.status ?? 500);
      updates.name = name;
    }
    if (payload && "description" in payload) {
      const description = typeof payload.description === "string" ? payload.description.trim() : "";
      if (!validateDescription(description)) return jsonResponse({ error: "Circle description must be <=200 characters" }, 400);
      updates.description = description || null;
    }
    if (payload && "type" in payload) {
      const type = String(payload.type ?? "").trim();
      if (!validateType(type)) return jsonResponse({ error: "Invalid circle type" }, 400);
      updates.type = type;
    }
    if (payload && "image_path" in payload) {
      const imagePath = typeof payload.image_path === "string" ? payload.image_path.trim() : null;
      if (imagePath && imagePath.length > 500) return jsonResponse({ error: "Circle image path is too long" }, 400);
      updates.image_path = imagePath;
    }

    if (Object.keys(updates).length === 0) return jsonResponse({ error: "Nothing to update" }, 400);

    const { data, error } = await auth.client
      .from("circles")
      .update(updates)
      .eq("id", id)
      .select("id,slug,name,description,type,created_at,updated_at,image_path,owner_id")
      .single();

    if (error) {
      if (/circles_name_lower_unique|duplicate key value/i.test(error.message) && /name/i.test(error.message)) {
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
