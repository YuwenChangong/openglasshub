import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createUserClient, getBearerToken, requireEnv, type RuntimeEnv } from "./admin-auth.ts";

export type VerifiedSessionClaims = {
  userId: string;
  sessionId: string;
  amr: readonly { method: string; timestamp?: number }[];
  expiresAt: number;
};

export type VerifiedSession = { claims: VerifiedSessionClaims; client: SupabaseClient; user: User };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalidAuth = () => new Response(JSON.stringify({ error: "INVALID_AUTH" }), { status: 401 });
const unavailable = () => new Response(JSON.stringify({ error: "VERIFICATION_SERVICE_UNAVAILABLE" }), { status: 503 });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function authFailure(error: unknown): Response {
  if (isRecord(error) && typeof error.status === "number") {
    if (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500) return unavailable();
    if (error.status >= 400 && error.status < 500) return invalidAuth();
  }
  if (error instanceof SyntaxError || (isRecord(error) && error.name === "AuthInvalidJwtError")) return invalidAuth();
  return unavailable();
}

function isValidConfirmedAt(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = /^(\d{4}-\d{2}-\d{2})T/.exec(value)?.[1];
  if (!date || !Number.isFinite(Date.parse(value))) return false;
  const midnight = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(midnight) && new Date(midnight).toISOString().slice(0, 10) === date;
}

export async function getTrustedSessionClaims(token: string, env: RuntimeEnv): Promise<VerifiedSessionClaims> {
  if (!token) throw invalidAuth();
  const client = createUserClient(env, token);
  let claims: unknown;
  try {
    const result = await client.auth.getClaims(token);
    if (result.error) throw result.error;
    claims = result.data?.claims;
  } catch (error) {
    throw authFailure(error);
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

export async function getLiveProviderSessionUser(
  token: string, env: RuntimeEnv, claims: VerifiedSessionClaims,
): Promise<User> {
  if (!token) throw invalidAuth();
  let user;
  try {
    const result = await createUserClient(env, token).auth.getUser(token);
    if (result.error) throw result.error;
    user = result.data.user;
  } catch (error) {
    throw authFailure(error);
  }
  if (!user || user.id !== claims.userId) throw invalidAuth();
  return user;
}

export async function getCurrentConfirmedAuthUser(
  token: string, env: RuntimeEnv, claims: VerifiedSessionClaims,
): Promise<{ id: string; email: string }> {
  const user = await getLiveProviderSessionUser(token, env, claims);
  const confirmedAt = user?.email_confirmed_at;
  if (typeof user.email !== "string" || !user.email.trim() ||
      !isValidConfirmedAt(confirmedAt)) {
    throw invalidAuth();
  }
  return { id: user.id, email: user.email };
}

export async function requireVerifiedSession(request: Request, env: RuntimeEnv): Promise<VerifiedSession> {
  const token = getBearerToken(request);
  if (!token) throw invalidAuth();
  const claims = await getTrustedSessionClaims(token, env);
  const user = await getLiveProviderSessionUser(token, env, claims);
  const client = createUserClient(env, token);
  let result;
  try {
    result = await client.rpc("ogh_is_verified_session");
  } catch {
    throw unavailable();
  }
  if (result.error || typeof result.data !== "boolean") throw unavailable();
  if (!result.data) throw new Response(JSON.stringify({ error: "VERIFICATION_REQUIRED" }), { status: 403 });
  return { claims, client, user };
}

export async function verifiedSessionOrResponse(request: Request, env: RuntimeEnv): Promise<VerifiedSession | Response> {
  try {
    return await requireVerifiedSession(request, env);
  } catch (error) {
    const response = error instanceof Response ? error : unavailable();
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
