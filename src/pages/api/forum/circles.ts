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

    const { data: existing, error: existingError } = await supabase
      .from("circles")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (existingError) {
      return json({ error: existingError.message }, 500);
    }
    if (existing) {
      return json({ error: "Circle slug already exists" }, 409);
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
      .select("id, slug, name, description, type, image_path")
      .single();

    if (insertError) {
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
