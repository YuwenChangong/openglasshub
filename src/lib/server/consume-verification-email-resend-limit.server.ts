import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv, type RuntimeEnv } from "./admin-auth.ts";

export const RESEND_LIMIT_DEADLINE_MS = 4_000;

type RpcClient = Pick<SupabaseClient, "rpc">;
type Dependencies = {
  createClient?: (env: RuntimeEnv, signal: AbortSignal) => RpcClient;
  timeoutMs?: number;
};

export type ResendLimitDecision =
  | { allowed: true; reason: "ALLOWED" }
  | { allowed: false; reason: "RATE_LIMITED" | "RATE_LIMIT_SERVICE_UNAVAILABLE" };

function createResendLimitClient(env: RuntimeEnv, signal: AbortSignal): RpcClient {
  return createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal }) },
  });
}

export async function consumeVerificationEmailResendLimit(
  env: RuntimeEnv,
  ipHash: string,
  dependencies: Dependencies = {},
): Promise<ResendLimitDecision> {
  if (!/^[a-f0-9]{64}$/.test(ipHash)) return { allowed: false, reason: "RATE_LIMIT_SERVICE_UNAVAILABLE" };
  const controller = new AbortController();
  const timeoutMs = dependencies.timeoutMs ?? RESEND_LIMIT_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const client = (dependencies.createClient ?? createResendLimitClient)(env, controller.signal);
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("RATE_LIMIT_TIMEOUT"));
      }, timeoutMs);
    });
    const { data, error } = await Promise.race([
      client.rpc("consume_verification_email_resend_limit", {
        input_ip_hash: ipHash,
        max_attempts: 5,
        window_hours: 24,
      }),
      deadline,
    ]);
    if (error || !Array.isArray(data) || data.length !== 1 || typeof data[0]?.allowed !== "boolean") {
      return { allowed: false, reason: "RATE_LIMIT_SERVICE_UNAVAILABLE" };
    }
    return data[0].allowed
      ? { allowed: true, reason: "ALLOWED" }
      : { allowed: false, reason: "RATE_LIMITED" };
  } catch {
    return { allowed: false, reason: "RATE_LIMIT_SERVICE_UNAVAILABLE" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
