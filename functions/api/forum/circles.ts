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
      .from("circles")
      .select("id,slug,name,description,type")
      .order("name", { ascending: true });

    if (error) {
      return json({ error: error.message }, 500);
    }

    return json({ circles: data ?? [] });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Server error" },
      500
    );
  }
}