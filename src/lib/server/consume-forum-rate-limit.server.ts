import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv, type RuntimeEnv } from "./admin-auth.ts";

export const RATE_LIMIT_RUNTIME_DEADLINE_MS = 4_000;

export type ConsumeForumRateLimitInput = {
  userId: string;
  ipHash: string;
  purpose: "post_create" | "comment_create" | "circle_create" | "post_media_upload" | "external_video_upload";
  bytes: number;
};

export type ConsumeForumRateLimitDecision =
  | { allowed: true; reason: "ALLOWED" }
  | { allowed: false; reason: "RATE_LIMITED" };

export type RateLimitServiceFailureCode =
  | "RATE_LIMIT_SERVICE_UNAVAILABLE"
  | "RATE_LIMIT_CONFIGURATION_MISSING"
  | "RATE_LIMIT_MALFORMED_RESULT"
  | "RATE_LIMIT_TIMEOUT";

export class RateLimitServiceError extends Error {
  readonly code: RateLimitServiceFailureCode;

  constructor(code: RateLimitServiceFailureCode) {
    super(code);
    this.name = "RateLimitServiceError";
    this.code = code;
  }
}

type RateLimitRpcClient = Pick<SupabaseClient, "rpc">;
type RateLimitRpcDependencies = {
  createClient?: (env: RuntimeEnv, signal: AbortSignal) => RateLimitRpcClient;
  timeoutMs?: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{64}$/;

function createRateLimitRpcClient(env: RuntimeEnv, signal: AbortSignal): RateLimitRpcClient {
  return createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal }),
    },
  });
}

function assertInput(input: ConsumeForumRateLimitInput) {
  if (!uuidPattern.test(input.userId) || !hashPattern.test(input.ipHash) || !Number.isSafeInteger(input.bytes) || input.bytes < 0) {
    throw new RateLimitServiceError("RATE_LIMIT_SERVICE_UNAVAILABLE");
  }
}

function parseDecision(data: unknown): ConsumeForumRateLimitDecision {
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== "object") {
    throw new RateLimitServiceError("RATE_LIMIT_MALFORMED_RESULT");
  }
  const row = data[0] as { allowed?: unknown; decision?: unknown };
  if (row.allowed === true && row.decision === "ALLOWED") return { allowed: true, reason: "ALLOWED" };
  if (row.allowed === false && row.decision === "RATE_LIMITED") return { allowed: false, reason: "RATE_LIMITED" };
  throw new RateLimitServiceError("RATE_LIMIT_MALFORMED_RESULT");
}

// This is the only service-role boundary for the forum rate-limit RPC. It never
// exposes the client or key to callers, and it has no retry or fallback path.
export async function consumeForumRateLimit(
  env: RuntimeEnv,
  input: ConsumeForumRateLimitInput,
  dependencies: RateLimitRpcDependencies = {},
): Promise<ConsumeForumRateLimitDecision> {
  assertInput(input);
  const controller = new AbortController();
  const timeoutMs = dependencies.timeoutMs ?? RATE_LIMIT_RUNTIME_DEADLINE_MS;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new RateLimitServiceError("RATE_LIMIT_TIMEOUT"));
    }, timeoutMs);
  });

  try {
    const client = (dependencies.createClient ?? createRateLimitRpcClient)(env, controller.signal);
    const { data, error } = await Promise.race([client.rpc("consume_forum_rate_limit", {
      p_user_id: input.userId,
      p_ip_hash: input.ipHash,
      p_purpose: input.purpose,
      p_bytes: input.bytes,
    }), deadline]);
    if (error) throw new RateLimitServiceError("RATE_LIMIT_SERVICE_UNAVAILABLE");
    return parseDecision(data);
  } catch (error) {
    if (error instanceof RateLimitServiceError) throw error;
    if (timedOut || controller.signal.aborted) throw new RateLimitServiceError("RATE_LIMIT_TIMEOUT");
    if (error instanceof Error && /Missing required env var/.test(error.message)) {
      throw new RateLimitServiceError("RATE_LIMIT_CONFIGURATION_MISSING");
    }
    throw new RateLimitServiceError("RATE_LIMIT_SERVICE_UNAVAILABLE");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
