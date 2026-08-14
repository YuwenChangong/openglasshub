import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse, requireAdmin, type AdminAuthResult, type RuntimeEnv } from "./admin-auth";
import {
  createServerAdminSupabaseClient,
  TrustedAdminRuntimeError,
} from "./supabase-admin-client.server";

class TrustedAdminRuntimeProbeError extends Error {
  public readonly status: number | null;
  public readonly providerCode: string | null;

  constructor(
    public readonly code:
      | "TRUSTED_RUNTIME_PROBE_KEY_REJECTED"
      | "TRUSTED_RUNTIME_PROBE_DATA_API_FAILED",
    status: number | null,
    providerCode: string | null,
  ) {
    super(code);
    this.status = status;
    this.providerCode = providerCode;
  }
}

type CapabilityDependencies = {
  authorize?: (request: Request, env: RuntimeEnv) => Promise<AdminAuthResult>;
  createAdminClient?: (env: RuntimeEnv, onResponseStatus: (status: number) => void) => SupabaseClient;
};

function safeProviderCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_:-]{1,64}$/.test(value) ? value : null;
}

async function runReadOnlyCapabilityProbe(
  client: SupabaseClient,
  responseStatus: { value: number | null },
): Promise<void> {
  const { error } = await client.from("circles").select("id").limit(1);
  if (error) {
    const classification = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
    const keyRejected =
      responseStatus.value === 401 ||
      responseStatus.value === 403 ||
      /api.?key|invalid jwt|unauthorized|permission denied|not allowed/.test(classification);
    throw new TrustedAdminRuntimeProbeError(
      keyRejected ? "TRUSTED_RUNTIME_PROBE_KEY_REJECTED" : "TRUSTED_RUNTIME_PROBE_DATA_API_FAILED",
      responseStatus.value,
      safeProviderCode(error.code),
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
    const responseStatus = { value: null as number | null };

    await authorize(request, env);
    let client: SupabaseClient;
    try {
      client = createAdminClient(env, (status) => {
        responseStatus.value = status;
      });
    } catch (error) {
      if (error instanceof TrustedAdminRuntimeError) throw error;
      throw new TrustedAdminRuntimeError("TRUSTED_ADMIN_RUNTIME_CLIENT_CREATE_FAILED");
    }
    await runReadOnlyCapabilityProbe(client, responseStatus);

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
      return jsonResponse(
        {
          error: "Trusted admin runtime capability probe failed",
          code: error.code,
          status: error.status,
          providerCode: error.providerCode,
        },
        500,
      );
    }
    return jsonResponse(
      { error: "Trusted admin runtime capability probe failed", code: "TRUSTED_RUNTIME_PROBE_DATA_API_FAILED" },
      500,
    );
  }
}
