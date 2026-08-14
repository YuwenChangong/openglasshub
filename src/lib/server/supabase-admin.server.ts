import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse, requireAdmin, type AdminAuthResult, type RuntimeEnv } from "./admin-auth";
import {
  createServerAdminSupabaseClient,
  TrustedAdminRuntimeError,
} from "./supabase-admin-client.server";

class TrustedAdminRuntimeProbeError extends Error {
  constructor(
    public readonly code:
      | "TRUSTED_RUNTIME_PROBE_AUTH_FAILED"
      | "TRUSTED_RUNTIME_PROBE_QUERY_FAILED",
  ) {
    super(code);
  }
}

type CapabilityDependencies = {
  authorize?: (request: Request, env: RuntimeEnv) => Promise<AdminAuthResult>;
  createAdminClient?: (env: RuntimeEnv) => SupabaseClient;
};

async function runReadOnlyCapabilityProbe(client: SupabaseClient): Promise<void> {
  const { error } = await client.from("circles").select("id").limit(1);
  if (error) {
    const classification = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
    const authFailure = /api.?key|invalid jwt|unauthorized|permission denied|not allowed/.test(classification);
    throw new TrustedAdminRuntimeProbeError(
      authFailure ? "TRUSTED_RUNTIME_PROBE_AUTH_FAILED" : "TRUSTED_RUNTIME_PROBE_QUERY_FAILED",
    );
  }
}

export async function handleTrustedAdminRuntimeCapability(
  request: Request,
  env: RuntimeEnv,
  dependencies: CapabilityDependencies = {},
): Promise<Response> {
  try {
    const authorize = dependencies.authorize ?? requireAdmin;
    const createAdminClient = dependencies.createAdminClient ?? createServerAdminSupabaseClient;

    await authorize(request, env);
    let client: SupabaseClient;
    try {
      client = createAdminClient(env);
    } catch (error) {
      if (error instanceof TrustedAdminRuntimeError) throw error;
      throw new TrustedAdminRuntimeError("TRUSTED_ADMIN_RUNTIME_CLIENT_CREATE_FAILED");
    }
    await runReadOnlyCapabilityProbe(client);

    return jsonResponse({
      ok: true,
      trustedAdminRuntime: true,
      projectRefMatch: true,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof TrustedAdminRuntimeError) {
      return jsonResponse({ error: "Trusted admin runtime unavailable", code: error.code }, 500);
    }
    if (error instanceof TrustedAdminRuntimeProbeError) {
      return jsonResponse({ error: "Trusted admin runtime capability probe failed", code: error.code }, 500);
    }
    return jsonResponse({ error: "Trusted admin runtime capability probe failed", code: "TRUSTED_RUNTIME_PROBE_QUERY_FAILED" }, 500);
  }
}
