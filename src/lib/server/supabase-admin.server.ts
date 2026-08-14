import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse, requireAdmin, type AdminAuthResult, type RuntimeEnv } from "./admin-auth";
import {
  createServerAdminSupabaseClient,
  TrustedAdminRuntimeError,
} from "./supabase-admin-client.server";

export type TrustedAdminRuntimeProbeCode =
  | "TRUSTED_RUNTIME_PROBE_KEY_REJECTED"
  | "TRUSTED_RUNTIME_DIRECT_TABLE_ACCESS_BLOCKED"
  | "TRUSTED_RUNTIME_PROBE_AUTH_ADMIN_API_FAILED";

class TrustedAdminRuntimeProbeError extends Error {
  public readonly status: number | null;
  public readonly providerCode: string | null;

  constructor(
    public readonly code: TrustedAdminRuntimeProbeCode,
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

export function classifyTrustedAdminProbeFailure(params: {
  responseStatus: number | null;
  providerCode: unknown;
  message: unknown;
}): TrustedAdminRuntimeProbeCode {
  const providerCode = safeProviderCode(params.providerCode);
  if (providerCode === "42501") {
    return "TRUSTED_RUNTIME_DIRECT_TABLE_ACCESS_BLOCKED";
  }

  const classification = `${providerCode ?? ""} ${typeof params.message === "string" ? params.message : ""}`.toLowerCase();
  if (
    params.responseStatus === 401 ||
    params.responseStatus === 403 ||
    /api.?key|invalid jwt|unauthorized|permission denied|not allowed/.test(classification)
  ) {
    return "TRUSTED_RUNTIME_PROBE_KEY_REJECTED";
  }

  return "TRUSTED_RUNTIME_PROBE_AUTH_ADMIN_API_FAILED";
}

async function runReadOnlyCapabilityProbe(
  client: SupabaseClient,
  responseStatus: { value: number | null },
): Promise<void> {
  const { error } = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) {
    throw new TrustedAdminRuntimeProbeError(
      classifyTrustedAdminProbeFailure({
        responseStatus: responseStatus.value,
        providerCode: error.code,
        message: error.message,
      }),
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
      { error: "Trusted admin runtime capability probe failed", code: "TRUSTED_RUNTIME_PROBE_AUTH_ADMIN_API_FAILED" },
      500,
    );
  }
}
