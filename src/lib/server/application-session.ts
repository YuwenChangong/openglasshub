import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export type RuntimeEnv = Record<string, string | undefined>;
function getBearerToken(request: Request): string | null { return /^Bearer[ \t]+([^\s]+)$/i.exec(request.headers.get("authorization")?.trim() ?? "")?.[1] ?? null; }
function jsonResponse(data: unknown, status: number): Response { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
function createUserClient(env: RuntimeEnv, token: string): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new Error("Missing Supabase runtime configuration");
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
}

export type VerifiedApplicationSession = {
  client: SupabaseClient;
  user: User;
  sessionId: string;
  token: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Decodes claims only after auth.getUser has verified the bearer JWT. */
export function sessionIdFromVerifiedJwt(token: string): string | null {
  const encodedPayload = token.split(".")[1];
  if (!encodedPayload) return null;
  try {
    const padded = encodedPayload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encodedPayload.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { session_id?: unknown };
    return typeof payload.session_id === "string" && UUID.test(payload.session_id) ? payload.session_id : null;
  } catch {
    return null;
  }
}

export function passwordProvenFromVerifiedJwt(token: string): boolean {
  const encodedPayload = token.split(".")[1];
  if (!encodedPayload) return false;
  try {
    const padded = encodedPayload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encodedPayload.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { amr?: Array<{ method?: unknown }> };
    return Array.isArray(payload.amr) && payload.amr.some((factor) => factor?.method === "password");
  } catch {
    return false;
  }
}

export async function requireVerifiedApplicationSession(request: Request, env: RuntimeEnv): Promise<VerifiedApplicationSession> {
  const token = getBearerToken(request);
  if (!token) throw jsonResponse({ error: "Missing bearer token" }, 401);
  const client = createUserClient(env, token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw jsonResponse({ error: "Invalid auth token" }, 401);
  const sessionId = sessionIdFromVerifiedJwt(token);
  if (!sessionId) throw jsonResponse({ error: "Invalid auth session" }, 401);
  const { data: allowed, error: gateError } = await client.rpc("is_application_session_verified_v1");
  if (gateError || allowed !== true) throw jsonResponse({ error: "Email verification required" }, 403);
  return { client, user: data.user, sessionId, token };
}

/** Used only by the challenge endpoints. It validates password proof but intentionally does not require activation. */
export async function requirePasswordProvenSession(request: Request, env: RuntimeEnv): Promise<VerifiedApplicationSession> {
  const token = getBearerToken(request);
  if (!token) throw jsonResponse({ error: "Missing bearer token" }, 401);
  const client = createUserClient(env, token);
  const { data, error } = await client.auth.getUser(token);
  const sessionId = sessionIdFromVerifiedJwt(token);
  if (error || !data.user || !sessionId || !passwordProvenFromVerifiedJwt(token)) {
    throw jsonResponse({ error: "Invalid authentication proof" }, 401);
  }
  return { client, user: data.user, sessionId, token };
}
