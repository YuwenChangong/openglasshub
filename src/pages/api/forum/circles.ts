import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { isPublicVisibleCircle } from "../../../lib/site-navigation";
import { fetchCirclesWithFallback } from "../../../lib/circle-data";

export const prerender = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

function createUserClient(env: Record<string, string | undefined>, bearerToken: string) {
  return createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_ANON_KEY"), {
    global: {
      headers: { Authorization: `Bearer ${bearerToken}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isStaffRole(role: string | null | undefined): boolean {
  return role === "moderator" || role === "admin";
}

async function getActorProfile(client: ReturnType<typeof createUserClient>, userId: string) {
  const { data, error } = await client
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Profile not found for current user");
  }

  return data as { id: string; role: string | null };
}

export const GET: APIRoute = async ({ locals }) => {
  try {
    const env = (locals as { runtime?: { env?: Record<string, string | undefined> } }).runtime?.env;
    if (!env) {
      return json({ error: "Runtime environment not available" }, 500);
    }

    const supabase = createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_ANON_KEY"));
    const { circles, error, supportsExtendedSchema } = await fetchCirclesWithFallback(supabase);

    if (error) {
      return json({ error: error.message }, 500);
    }

    return json({
      circles: circles.filter((circle) => isPublicVisibleCircle(circle)),
      supports_extended_schema: supportsExtendedSchema,
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Unexpected server error" },
      500,
    );
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as { runtime?: { env?: Record<string, string | undefined> } }).runtime?.env;
    if (!env) {
      return json({ error: "Runtime environment not available" }, 500);
    }

    const token = getBearerToken(request);
    if (!token) {
      return json({ error: "Missing bearer token" }, 401);
    }

    const supabase = createUserClient(env, token);
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return json({ error: "Invalid auth token" }, 401);
    }

    const payload = (await request.json().catch(() => null)) as
      | { slug?: string; name?: string; description?: string; type?: string; image_path?: string | null }
      | null;

    const slug = String(payload?.slug ?? "").trim().toLowerCase();
    const name = String(payload?.name ?? "").trim();
    const description = String(payload?.description ?? "").trim();
    const type = String(payload?.type ?? "").trim();
    const imagePath = payload?.image_path ? String(payload.image_path).trim() : null;

    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return json({ error: "Invalid circle slug" }, 400);
    }
    if (name.length < 2 || name.length > 60) {
      return json({ error: "Circle name must be 2-60 characters" }, 400);
    }
    if (description.length < 6 || description.length > 280) {
      return json({ error: "Circle description must be 6-280 characters" }, 400);
    }
    if (!["topic", "device", "project"].includes(type)) {
      return json({ error: "Invalid circle type" }, 400);
    }
    if (imagePath && imagePath.length > 500) {
      return json({ error: "Circle image path is too long" }, 400);
    }

    const { data: existingSlug, error: existingSlugError } = await supabase
      .from("circles")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (existingSlugError) {
      return json({ error: existingSlugError.message }, 500);
    }
    if (existingSlug) {
      return json({ error: "CIRCLE_SLUG_ALREADY_EXISTS" }, 409);
    }

    const { data: existingName, error: existingNameError } = await supabase
      .from("circles")
      .select("id, name")
      .ilike("name", name)
      .limit(1);

    if (existingNameError) {
      return json({ error: existingNameError.message }, 500);
    }
    if ((existingName ?? []).some((circle) => String(circle.name ?? "").trim().toLowerCase() === name.toLowerCase())) {
      return json({ error: "CIRCLE_NAME_ALREADY_EXISTS" }, 409);
    }

    const { data: inserted, error: insertError } = await supabase
      .from("circles")
      .insert({
        slug,
        name,
        description,
        type,
        owner_id: authData.user.id,
        image_path: imagePath,
      })
      .select("id, slug, name, description, type, image_path, owner_id")
      .single();

    if (insertError) {
      if (/circles_name_lower_unique_idx|duplicate key value/i.test(insertError.message) && /name/i.test(insertError.message)) {
        return json({ error: "CIRCLE_NAME_ALREADY_EXISTS" }, 409);
      }
      if (/circles_slug_key|duplicate key value/i.test(insertError.message) && /slug/i.test(insertError.message)) {
        return json({ error: "CIRCLE_SLUG_ALREADY_EXISTS" }, 409);
      }
      if (/owner_id|image_path/i.test(insertError.message)) {
        const fallbackInsert = await supabase
          .from("circles")
          .insert({
            slug,
            name,
            description,
            type,
          })
          .select("id, slug, name, description, type")
          .single();

        if (!fallbackInsert.error) {
          return json({ circle: fallbackInsert.data }, 201);
        }

        if (/row-level security|permission/i.test(fallbackInsert.error.message)) {
          return json({ error: "当前数据库还没有开放普通用户创建圈子。先执行最新 Supabase migration 后，用户才能自由创建圈子并上传圈子图片。" }, 503);
        }

        return json({ error: fallbackInsert.error.message }, 500);
      }
      return json({ error: insertError.message }, 500);
    }

    return json({ circle: inserted }, 201);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Unexpected server error" },
      500,
    );
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as { runtime?: { env?: Record<string, string | undefined> } }).runtime?.env;
    if (!env) {
      return json({ error: "Runtime environment not available" }, 500);
    }

    const token = getBearerToken(request);
    if (!token) {
      return json({ error: "Missing bearer token" }, 401);
    }

    const supabase = createUserClient(env, token);
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return json({ error: "Invalid auth token" }, 401);
    }

    const payload = (await request.json().catch(() => null)) as
      | { id?: string; slug?: string; image_path?: string | null; name?: string; description?: string }
      | null;

    const id = String(payload?.id ?? "").trim();
    const slug = String(payload?.slug ?? "").trim().toLowerCase();
    const imagePathRaw = payload?.image_path;
    const imagePath = typeof imagePathRaw === "string" ? imagePathRaw.trim() : null;
    const nextName = typeof payload?.name === "string" ? payload.name.trim() : "";
    const nextDescription = typeof payload?.description === "string" ? payload.description.trim() : "";

    if (!id && !slug) {
      return json({ error: "Missing circle id or slug" }, 400);
    }
    if (imagePath && imagePath.length > 500) {
      return json({ error: "Circle image path is too long" }, 400);
    }
    if (payload && "name" in payload && (nextName.length < 2 || nextName.length > 60)) {
      return json({ error: "Circle name must be 2-60 characters" }, 400);
    }
    if (payload && "description" in payload && (nextDescription.length < 6 || nextDescription.length > 280)) {
      return json({ error: "Circle description must be 6-280 characters" }, 400);
    }

    const actorProfile = await getActorProfile(supabase, authData.user.id);
    const currentCircleQuery = supabase
      .from("circles")
      .select("id, slug, owner_id")
      .limit(1);
    const { data: currentCircle, error: currentCircleError } = id
      ? await currentCircleQuery.eq("id", id).maybeSingle()
      : await currentCircleQuery.eq("slug", slug).maybeSingle();

    if (currentCircleError) {
      return json({ error: currentCircleError.message }, 500);
    }
    if (!currentCircle) {
      return json({ error: "Circle not found" }, 404);
    }
    if (!isStaffRole(actorProfile.role) && currentCircle.owner_id !== authData.user.id) {
      return json({ error: "你没有权限修改这个圈子。仅圈子 owner 或管理员可修改。" }, 403);
    }

    if (payload && "name" in payload) {
      const { data: existingName, error: existingNameError } = await supabase
        .from("circles")
        .select("id, name")
        .ilike("name", nextName)
        .neq("id", currentCircle.id)
        .limit(1);

      if (existingNameError) {
        return json({ error: existingNameError.message }, 500);
      }
      if ((existingName ?? []).some((circle) => String(circle.name ?? "").trim().toLowerCase() === nextName.toLowerCase())) {
        return json({ error: "CIRCLE_NAME_ALREADY_EXISTS" }, 409);
      }
    }

    const updates: Record<string, string | null> = {};
    if (payload && "name" in payload) updates.name = nextName;
    if (payload && "description" in payload) updates.description = nextDescription;
    if (payload && "image_path" in payload) updates.image_path = imagePath;

    if (Object.keys(updates).length === 0) {
      return json({ error: "Nothing to update" }, 400);
    }

    const query = supabase
      .from("circles")
      .update(updates)
      .select("id, slug, name, description, image_path, owner_id")
      .limit(1);

    const { data, error } = id ? await query.eq("id", id).single() : await query.eq("slug", slug).single();

    if (error) {
      if (/circles_name_lower_unique_idx|duplicate key value/i.test(error.message) && /name/i.test(error.message)) {
        return json({ error: "CIRCLE_NAME_ALREADY_EXISTS" }, 409);
      }
      if (/image_path/i.test(error.message)) {
        return json({ error: "当前数据库还没有启用圈子图片字段，请先执行最新 Supabase migration。" }, 503);
      }
      if (/row-level security|permission/i.test(error.message)) {
        return json({ error: "你没有权限修改这个圈子。仅圈子 owner 或管理员可修改。" }, 403);
      }
      return json({ error: error.message }, 500);
    }

    return json({ circle: data }, 200);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Unexpected server error" },
      500,
    );
  }
};
