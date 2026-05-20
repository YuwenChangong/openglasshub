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

export async function onRequestGet({ env }: { env: Env }): Promise<Response> {
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return json({ error: "Missing Supabase config" }, 500);
    }

    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

    const { data, error } = await supabase
      .from("posts")
      .select(
        `id,title,type,body,created_at,last_activity_at,
         profiles:author_id(display_name),
         circles:circle_id(name,slug)`
      )
      .eq("status", "published")
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return json({ error: error.message }, 500);
    }

    const posts = (data ?? []).map((p: any) => ({
      id: p.id,
      title: p.title,
      post_type: p.type,
      excerpt: (p.body ?? "").slice(0, 200),
      created_at: p.created_at,
      last_activity_at: p.last_activity_at,
      author_name: p.profiles?.display_name ?? "匿名用户",
      circle_name: p.circles?.name ?? null,
      circle_slug: p.circles?.slug ?? null,
    }));

    return json({ posts });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Server error" },
      500
    );
  }
}