import {
  resolveModerationProvider,
  resolveOpenAIFailMode,
  runMockModerationProvider,
  runTencentDisabledFallback,
  type ModerationRuntimeEnv,
} from "./moderation-provider.server.ts";
import { runOpenAIModeration } from "./openai-moderation-provider.server.ts";
import type {
  ModerationFailMode,
  ModerationProviderInput,
  ModerationProviderStatus,
  ModerationResult,
} from "./moderation-types.ts";

function shouldFallbackToLocalOnlyOnProviderError(status: ModerationProviderStatus | undefined): boolean {
  return (
    status === "missing_key" ||
    status === "disabled" ||
    status === "http_error" ||
    status === "invalid_response" ||
    status === "network_error" ||
    status === "timeout"
  );
}

function buildResult(
  decision: ModerationResult["decision"],
  reason: ModerationResult["reason"],
  score: number,
  matchedRules: string[],
  provider: ModerationResult["provider"],
  providerDetails?: ModerationResult["providerDetails"],
): ModerationResult {
  return {
    decision,
    reason,
    score,
    matchedRules,
    provider,
    providerDetails,
  };
}

function mapProviderError(
  failMode: Extract<ModerationFailMode, "review" | "reject" | "local_only">,
  providerError: string,
  providerStatus?: ModerationProviderStatus,
  safeSummary?: string | null,
): ModerationResult {
  if (failMode === "local_only") {
    return buildResult("allow", null, 0.03, [providerError], "local+openai", {
      decisionSource: "fallback",
      decisionPath: "allow",
      reasonCode: providerError,
      providerStatus,
      safeSummary: safeSummary ?? null,
      localDecision: "allow",
      openaiDecision: "error",
      providerError,
    });
  }

  const decision = failMode === "reject" ? "reject" : "review";
  const reason = failMode === "reject" ? "openai_provider_error_reject" : "openai_provider_error_review";
  const score = failMode === "reject" ? 0.93 : 0.61;
  return buildResult(decision, reason, score, [providerError], "local+openai", {
    decisionSource: "provider_error",
    decisionPath: decision,
    reasonCode: reason,
    providerStatus,
    safeSummary: safeSummary ?? null,
    localDecision: "allow",
    openaiDecision: "error",
    providerError,
  });
}

export async function moderateAsset(
  env: ModerationRuntimeEnv,
  providerInput: ModerationProviderInput,
  options?: {
    failMode?: Extract<ModerationFailMode, "review" | "reject" | "local_only">;
    openaiRunner?: typeof runOpenAIModeration;
  },
): Promise<ModerationResult> {
  const provider = resolveModerationProvider(env);

  if (provider === "local") {
    return buildResult("allow", null, 0.02, [], "local");
  }

  if (provider === "mock") {
    return runMockModerationProvider(providerInput);
  }

  if (provider === "tencent-disabled") {
    return runTencentDisabledFallback(env);
  }

  const openaiRunner = options?.openaiRunner ?? runOpenAIModeration;
  const result = await openaiRunner(env, providerInput);

  if (result.decision === "error") {
    const failMode =
      shouldFallbackToLocalOnlyOnProviderError(result.providerStatus)
        ? "local_only"
        : options?.failMode ?? resolveOpenAIFailMode(env);
    return mapProviderError(failMode, result.reasonCode, result.providerStatus, result.safeSummary ?? null);
  }

  if (result.decision === "allow") {
    return buildResult("allow", null, 0.02, [], "local+openai", {
      decisionSource: "openai",
      decisionPath: "allow",
      reasonCode: result.reasonCode,
      providerStatus: result.providerStatus,
      safeSummary: result.safeSummary ?? null,
      localDecision: "allow",
      openaiDecision: result.decision,
      categories: result.categories,
      scoresSummary: result.scoresSummary,
    });
  }

  return buildResult(
    result.decision,
    result.reasonCode,
    result.decision === "reject" ? 0.94 : 0.62,
    [`openai:${result.reasonCode}`],
    "local+openai",
    {
      decisionSource: "openai",
      decisionPath: result.decision,
      reasonCode: result.reasonCode,
      providerStatus: result.providerStatus,
      safeSummary: result.safeSummary ?? null,
      localDecision: "allow",
      openaiDecision: result.decision,
      categories: result.categories,
      scoresSummary: result.scoresSummary,
    },
  );
}
