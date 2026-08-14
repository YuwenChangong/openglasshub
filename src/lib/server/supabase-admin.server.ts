import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse, requireAdmin, type AdminAuthResult, type RuntimeEnv } from "./admin-auth";
import {
  createServerAdminSupabaseClient,
  TrustedAdminRuntimeError,
} from "./supabase-admin-client.server";

type CapabilityDependencies = {
  authorize?: (request: Request, env: RuntimeEnv) => Promise<AdminAuthResult>;
  createAdminClient?: (env: RuntimeEnv) => SupabaseClient;
};

async function runReadOnlyCapabilityProbe(client: SupabaseClient): Promise<void> {
  const { error } = await client.from("circles").select("id").limit(1);
  if (error) {
    throw new Error("TRUSTED_ADMIN_RUNTIME_CAPABILITY_PROBE_FAILED");
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
    const client = createAdminClient(env);
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
    return jsonResponse({ error: "Trusted admin runtime capability probe failed" }, 500);
  }
}
