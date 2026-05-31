/**
 * @deprecated IGNORED when @astrojs/cloudflare emits dist/_worker.js.
 *
 * In Cloudflare Pages advanced mode, the /functions directory is ignored
 * when _worker.js exists. Active endpoint: src/pages/api/forum/posts.ts
 */
import { createAnonClient, createUserClient } from "../../_lib/supabase";

type Env = {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
};

type PagesContext = {
  request: Request;
  env: Env;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

export async function onRequestGet({ env, request }: PagesContext): Promise<Response> {
  try {
    const url = new URL(request.url);
    const circleSlug = url.searchParams.get("circle");
    const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;

    const client = createAnonClient(env);
    let query = client
      .from("posts")
      .select(
        "id,title,type,status,created_at,last_activity_at,circle_id,author_id,circles:circle_id(slug,name),profiles:author_id(username,display_name)",
      )
      .eq("status", "published")
      .order("last_activity_at", { ascending: false })
      .limit(limit);

    if (circleSlug) {
      const { data: circle, error: circleError } = await client
        .from("circles")
        .select("id")
        .eq("slug", circleSlug)
        .maybeSingle();
      if (circleError) {
        return json({ error: circleError.message }, 500);
      }
      if (!circle) {
        return json({ posts: [], total: 0 }, 200);
      }
      query = query.eq("circle_id", circle.id);
    }

    const { data, error } = await query;
    if (error) {
      return json({ error: error.message }, 500);
    }

    return json({ posts: data ?? [], total: data?.length ?? 0 });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Unexpected server error" },
      500,
    );
  }
}

export async function onRequestPost({ env, request }: PagesContext): Promise<Response> {
  try {
    const token = getBearerToken(request);
    if (!token) {
      return json({ error: "Missing bearer token" }, 401);
    }

    const userClient = createUserClient(env, token);
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) {
      return json({ error: "Invalid auth token" }, 401);
    }

    const payload = (await request.json().catch(() => null)) as
      | { circle_slug?: string; title?: string; body?: string; type?: string }
      | null;

    if (!payload) {
      return json({ error: "Invalid JSON payload" }, 400);
    }

    const circleSlug = (payload.circle_slug ?? "").trim();
    const title = (payload.title ?? "").trim();
    const body = (payload.body ?? "").trim();
    const type = (payload.type ?? "").trim();

    if (!circleSlug || !title || !type) {
      return json({ error: "circle_slug, title, type are required" }, 400);
    }

    if (title.length < 3 || title.length > 180) {
      return json({ error: "title must be 3-180 characters" }, 400);
    }
    if (body.length > 20000) {
      return json({ error: "body must be <=20000 characters" }, 400);
    }
    const normalizedBody = body || "仅媒体内容占位：该帖子包含图片或视频媒体。";

    const allowedTypes = new Set(["experience", "question", "review", "dev", "news", "feedback"]);
    if (!allowedTypes.has(type)) {
      return json({ error: "Invalid post type" }, 400);
    }

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("id")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (profileError) {
      return json({ error: profileError.message }, 500);
    }
    if (!profile) {
      return json({ error: "Profile not found for current user" }, 403);
    }

    const { data: circle, error: circleError } = await userClient
      .from("circles")
      .select("id")
      .eq("slug", circleSlug)
      .maybeSingle();
    if (circleError) {
      return json({ error: circleError.message }, 500);
    }
    if (!circle) {
      return json({ error: "Circle not found" }, 404);
    }

    const { data: inserted, error: insertError } = await userClient
      .from("posts")
      .insert({
        author_id: authData.user.id,
        circle_id: circle.id,
        type,
        title,
        body: normalizedBody,
        status: "published",
      })
      .select("id,author_id,circle_id,type,title,status,created_at")
      .single();
    if (insertError) {
      return json({ error: insertError.message }, 500);
    }

    return json({ post: inserted }, 201);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Unexpected server error" },
      500,
    );
  }
}
