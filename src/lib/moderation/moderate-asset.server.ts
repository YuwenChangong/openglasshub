import {
  resolveModerationProvider,
  resolveOpenAIFailMode,
  runMockModerationProvider,
  runTencentDisabledFallback,
  type ModerationRuntimeEnv,
} from "./moderation-provider.server.ts";
import { runOpenAIModeration } from "./openai-moderation-provider.server.ts";
import type { ModerationFailMode, ModerationProviderInput, ModerationResult } from "./moderation-types.ts";

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
): ModerationResult {
  if (failMode === "local_only") {
    return buildResult("allow", null, 0.03, [providerError], "local+openai", {
      providerError,
    });
  }

  const decision = failMode === "reject" ? "reject" : "review";
  const reason = failMode === "reject" ? "openai_provider_error_reject" : "openai_provider_error_review";
  const score = failMode === "reject" ? 0.93 : 0.61;
  return buildResult(decision, reason, score, [providerError], "local+openai", {
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
    return mapProviderError(options?.failMode ?? resolveOpenAIFailMode(env), result.reasonCode);
  }

  if (result.decision === "allow") {
    return buildResult("allow", null, 0.02, [], "local+openai", {
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
      categories: result.categories,
      scoresSummary: result.scoresSummary,
    },
  );
}
