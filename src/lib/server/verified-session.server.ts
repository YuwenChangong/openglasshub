import type { SupabaseClient } from "@supabase/supabase-js";
import { createUserClient, getBearerToken, requireEnv, type RuntimeEnv } from "./admin-auth.ts";

export type VerifiedSessionClaims = {
  userId: string;
  sessionId: string;
  amr: readonly { method: string; timestamp?: number }[];
  expiresAt: number;
};

export type VerifiedSession = { claims: VerifiedSessionClaims; client: SupabaseClient };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalidAuth = () => new Response(JSON.stringify({ error: "INVALID_AUTH" }), { status: 401 });
const unavailable = () => new Response(JSON.stringify({ error: "VERIFICATION_SERVICE_UNAVAILABLE" }), { status: 503 });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function getTrustedSessionClaims(token: string, env: RuntimeEnv): Promise<VerifiedSessionClaims> {
  if (!token) throw invalidAuth();
  const client = createUserClient(env, token);
  let claims: unknown;
  try {
    const result = await client.auth.getClaims(token);
    if (result.error) throw result.error;
    claims = result.data?.claims;
  } catch {
    throw invalidAuth();
  }

  const expectedIssuer = `${new URL(requireEnv(env, "SUPABASE_URL")).origin}/auth/v1`;
  if (!isRecord(claims)) throw invalidAuth();
  const audience = claims.aud;
  const validAudience = audience === "authenticated" ||
    (Array.isArray(audience) && audience.includes("authenticated") && audience.every((item) => typeof item === "string"));
  if (claims.iss !== expectedIssuer || !validAudience || claims.role !== "authenticated" ||
      typeof claims.sub !== "string" || !uuid.test(claims.sub) ||
      typeof claims.session_id !== "string" || !uuid.test(claims.session_id) ||
      typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000 ||
      (claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || claims.nbf > Date.now() / 1000)) ||
      claims.is_anonymous !== false || !Array.isArray(claims.amr) || claims.amr.length === 0 ||
      !claims.amr.every((entry) => isRecord(entry) && typeof entry.method === "string" && entry.method.trim().length > 0 &&
        (entry.timestamp === undefined || (typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp))))) {
    throw invalidAuth();
  }
  return {
    userId: claims.sub,
    sessionId: claims.session_id,
    amr: claims.amr.map((entry) => ({ method: entry.method, ...(entry.timestamp === undefined ? {} : { timestamp: entry.timestamp }) })),
    expiresAt: claims.exp,
  };
}

export async function getCurrentConfirmedAuthUser(
  token: string, env: RuntimeEnv, claims: VerifiedSessionClaims,
): Promise<{ id: string; email: string }> {
  if (!token) throw invalidAuth();
  let user;
  try {
    const result = await createUserClient(env, token).auth.getUser(token);
    if (result.error) throw result.error;
    user = result.data.user;
  } catch {
    throw invalidAuth();
  }
  const confirmedAt = user?.email_confirmed_at;
  if (user?.id !== claims.userId || typeof user.email !== "string" || !user.email.trim() ||
      typeof confirmedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(confirmedAt) ||
      !Number.isFinite(Date.parse(confirmedAt))) {
    throw invalidAuth();
  }
  return { id: user.id, email: user.email };
}

export async function requireVerifiedSession(request: Request, env: RuntimeEnv): Promise<VerifiedSession> {
  const token = getBearerToken(request);
  if (!token) throw invalidAuth();
  const claims = await getTrustedSessionClaims(token, env);
  const client = createUserClient(env, token);
  let result;
  try {
    result = await client.rpc("ogh_is_verified_session");
  } catch {
    throw unavailable();
  }
  if (result.error || typeof result.data !== "boolean") throw unavailable();
  if (!result.data) throw new Response(JSON.stringify({ error: "VERIFICATION_REQUIRED" }), { status: 403 });
  return { claims, client };
}
