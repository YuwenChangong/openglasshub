import { createClient } from "@supabase/supabase-js";

type Env = {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
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

export async function onRequestGet({ env, request }: { env: Env; request: Request }): Promise<Response> {
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return json({ error: "Missing Supabase config" }, 500);
    }

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return json({ error: "Missing id parameter" }, 400);
    }

    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

    const { data, error } = await supabase
      .from("posts")
      .select(
        `id,title,type,body,status,created_at,last_activity_at,author_id,circle_id,
         profiles:author_id(display_name),
         circles:circle_id(name,slug)`
      )
      .eq("id", id)
      .eq("status", "published")
      .maybeSingle();

    if (error) {
      return json({ error: error.message }, 500);
    }

    if (!data) {
      return json({ error: "Post not found" }, 404);
    }

    return json({ post: data });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Server error" },
      500
    );
  }
}