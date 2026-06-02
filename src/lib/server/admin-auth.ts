import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type RuntimeEnv = Record<string, string | undefined>;

export type ModeratorAuthResult = {
  user: { id: string; email: string | null };
  client: SupabaseClient;
};

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function requireEnv(env: RuntimeEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

export function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

export function createUserClient(env: RuntimeEnv, bearerToken: string): SupabaseClient {
  return createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${bearerToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireModerator(request: Request, env: RuntimeEnv): Promise<ModeratorAuthResult> {
  const token = getBearerToken(request);
  if (!token) {
    throw jsonResponse({ error: "Missing bearer token" }, 401);
  }

  const client = createUserClient(env, token);
  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData.user) {
    throw jsonResponse({ error: "Invalid auth token" }, 401);
  }

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    throw jsonResponse({ error: profileError.message }, 500);
  }

  if (!profile || (profile.role !== "moderator" && profile.role !== "admin")) {
    throw jsonResponse({ error: "Forbidden" }, 403);
  }

  return {
    user: { id: authData.user.id, email: authData.user.email ?? null },
    client,
  };
}
