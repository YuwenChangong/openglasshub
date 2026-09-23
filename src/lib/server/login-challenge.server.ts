import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RuntimeEnv } from "./admin-auth.ts";
import { getCurrentConfirmedAuthUser, getTrustedSessionClaims, type VerifiedSessionClaims } from "./verified-session.server.ts";
import { challengeError, sendFreshLoginCode, type ChallengeError } from "./brevo-challenge.server.ts";

type StartInput = { token: string; ipHash: string; body?: unknown };
type VerifyInput = { token: string; challengeId: string; code: string };
type ChallengeResult = { status: "SENT"; challengeId: string } | { status: "PENDING" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = () => challengeError("VERIFICATION_SERVICE_UNAVAILABLE", 503);
const invalidAuth = () => challengeError("INVALID_AUTH", 401);
const authError = (error: unknown) => error instanceof Response && error.status === 503 ? unavailable() : invalidAuth();

function serviceClient(env: RuntimeEnv): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw unavailable();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function validateBody(body: unknown): void {
  if (body === undefined) return;
  if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length !== 0) {
    throw challengeError("INVALID_REQUEST", 400);
  }
}

async function signedClaims(token: string, env: RuntimeEnv): Promise<VerifiedSessionClaims> {
  try { return await getTrustedSessionClaims(token, env); }
  catch (error) { throw authError(error); }
}

async function digest(env: RuntimeEnv, challengeId: string, claims: VerifiedSessionClaims, code: string): Promise<string> {
  const pepper = env.OGH_LOGIN_CODE_PEPPER;
  if (!pepper) throw unavailable();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const data = encoder.encode(JSON.stringify([challengeId, claims.userId, claims.sessionId, code]));
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  return `\\x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function sixDigitCode(): string {
  const limit = Math.floor(0x100000000 / 1000000) * 1000000;
  let value: number;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= limit);
  return String(value % 1000000).padStart(6, "0");
}

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  try {
    const result = await client.rpc(name, args);
    if (result.error) throw result.error;
    return result.data as T;
  } catch { throw unavailable(); }
}

async function finalize(client: SupabaseClient, claims: VerifiedSessionClaims, challengeId: string, accepted: boolean): Promise<void> {
  const result = await rpc<unknown>(client, "ogh_finalize_login_delivery", {
    p_user_id: claims.userId, p_session_id: claims.sessionId,
    p_challenge_id: challengeId, p_accepted: accepted,
  });
  if (result !== true) throw unavailable();
}

async function issue(input: StartInput, env: RuntimeEnv, fetchImpl: typeof fetch, resend: boolean): Promise<ChallengeResult> {
  validateBody(input.body);
  const claims = await signedClaims(input.token, env);
  if (!claims.amr.some((entry) => entry.method === "password")) throw invalidAuth();
  if (typeof input.ipHash !== "string" || !/^[0-9a-f]{64}$/.test(input.ipHash)) {
    throw challengeError("INVALID_REQUEST", 400);
  }
  const client = serviceClient(env);
  const challengeId = crypto.randomUUID();
  const code = sixDigitCode();
  const codeDigest = await digest(env, challengeId, claims, code);
  const reserved = await rpc<unknown>(client, "ogh_reserve_login_challenge", {
    p_user_id: claims.userId, p_session_id: claims.sessionId,
    p_challenge_id: challengeId, p_digest: codeDigest,
    p_ip_hash: input.ipHash, p_resend: resend,
  });
  if (reserved === "PENDING") return { status: "PENDING" };
  if (reserved === "SESSION_GONE") throw invalidAuth();
  if (reserved === "RESEND_COOLDOWN") throw challengeError("RESEND_COOLDOWN", 429);
  if (reserved === "EMAIL_BUDGET_EXHAUSTED") throw challengeError("EMAIL_BUDGET_EXHAUSTED", 429);
  if (reserved !== "RESERVED") throw unavailable();

  let email: string;
  try {
    email = (await getCurrentConfirmedAuthUser(input.token, env, claims)).email;
  } catch (error) {
    await finalize(client, claims, challengeId, false);
    throw authError(error);
  }

  try {
    await sendFreshLoginCode({ to: email, code, requestId: challengeId }, env, fetchImpl);
  } catch {
    await finalize(client, claims, challengeId, false);
    throw unavailable();
  }
  await finalize(client, claims, challengeId, true);
  return { status: "SENT", challengeId };
}

export function startChallenge(input: StartInput, env: RuntimeEnv, fetchImpl: typeof fetch = fetch): Promise<ChallengeResult> {
  return issue(input, env, fetchImpl, false);
}

export function resendChallenge(input: StartInput, env: RuntimeEnv, fetchImpl: typeof fetch = fetch): Promise<ChallengeResult> {
  return issue(input, env, fetchImpl, true);
}

export async function verifyChallenge(input: VerifyInput, env: RuntimeEnv): Promise<{ status: "VERIFIED" }> {
  const claims = await signedClaims(input.token, env);
  if (!uuid.test(input.challengeId) || !/^\d{6}$/.test(input.code)) throw challengeError("CHALLENGE_INVALID", 400);
  const codeDigest = await digest(env, input.challengeId, claims, input.code);
  const result = await rpc<unknown>(serviceClient(env), "ogh_consume_login_challenge", {
    p_user_id: claims.userId, p_session_id: claims.sessionId,
    p_challenge_id: input.challengeId, p_digest: codeDigest,
  });
  if (result === "VERIFIED") return { status: "VERIFIED" };
  const errors: Record<string, { code: ChallengeError["code"]; status: number }> = {
    CHALLENGE_INVALID: { code: "CHALLENGE_INVALID", status: 400 },
    CHALLENGE_EXPIRED: { code: "CHALLENGE_EXPIRED", status: 400 },
    CHALLENGE_SUPERSEDED: { code: "CHALLENGE_SUPERSEDED", status: 400 },
    CHALLENGE_EXHAUSTED: { code: "CHALLENGE_EXHAUSTED", status: 400 },
    SESSION_GONE: { code: "SESSION_GONE", status: 401 },
  };
  if (typeof result === "string" && errors[result]) throw challengeError(errors[result].code, errors[result].status);
  throw unavailable();
}
