import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RuntimeEnv } from "./admin-auth";

export const CANONICAL_SUPABASE_PROJECT_REF = "xcbnxzjlsvtgzixurcof";
export const TRUSTED_ADMIN_CLIENT_AUTH_OPTIONS = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

export class TrustedAdminRuntimeError extends Error {
  public readonly code:
    | "TRUSTED_ADMIN_RUNTIME_SECRET_MISSING"
    | "TRUSTED_ADMIN_RUNTIME_PROJECT_MISMATCH"
    | "TRUSTED_ADMIN_RUNTIME_CLIENT_CREATE_FAILED";

  constructor(code: TrustedAdminRuntimeError["code"]) {
    super(code);
    this.code = code;
  }
}

export function assertCanonicalSupabaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TrustedAdminRuntimeError("TRUSTED_ADMIN_RUNTIME_PROJECT_MISMATCH");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== `${CANONICAL_SUPABASE_PROJECT_REF}.supabase.co` ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new TrustedAdminRuntimeError("TRUSTED_ADMIN_RUNTIME_PROJECT_MISMATCH");
  }

  return parsed.origin;
}

export function createServerAdminSupabaseClient(env: RuntimeEnv): SupabaseClient {
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new TrustedAdminRuntimeError("TRUSTED_ADMIN_RUNTIME_SECRET_MISSING");
  }

  const url = assertCanonicalSupabaseUrl(env.SUPABASE_URL ?? "");
  return createClient(url, secretKey, {
    auth: TRUSTED_ADMIN_CLIENT_AUTH_OPTIONS,
  });
}
