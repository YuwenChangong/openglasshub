import type { ModerationFailMode, ModerationInput, ModerationResult } from "./moderation-types.ts";

export type ModerationRuntimeEnv = Record<string, string | undefined>;

function resolveFailMode(env: ModerationRuntimeEnv): ModerationFailMode {
  const raw = String(env.MODERATION_FAIL_MODE ?? "review").trim().toLowerCase();
  return raw === "allow" || raw === "reject" ? raw : "review";
}

export function resolveModerationProvider(env: ModerationRuntimeEnv): "local" | "mock" | "tencent" {
  const raw = String(env.MODERATION_PROVIDER ?? "local").trim().toLowerCase();
  return raw === "mock" || raw === "tencent" ? raw : "local";
}

export async function runProviderFallback(
  env: ModerationRuntimeEnv,
  input: ModerationInput,
): Promise<ModerationResult> {
  const provider = resolveModerationProvider(env);
  if (provider === "mock") {
    const decision = String(input.metadata?.mockDecision ?? "allow").trim().toLowerCase();
    if (decision === "review") {
      return {
        decision: "review",
        reason: "sensitive_review",
        score: 0.45,
        matchedRules: ["mock:review"],
        provider: "mock",
      };
    }
    if (decision === "reject") {
      return {
        decision: "reject",
        reason: "spam",
        score: 0.98,
        matchedRules: ["mock:reject"],
        provider: "mock",
      };
    }
    return {
      decision: "allow",
      reason: null,
      score: 0.04,
      matchedRules: ["mock:allow"],
      provider: "mock",
    };
  }

  const failMode = resolveFailMode(env);
  if (failMode === "allow") {
    return {
      decision: "allow",
      reason: null,
      score: 0.08,
      matchedRules: ["tencent-disabled:allow"],
      provider: "tencent-disabled",
    };
  }
  if (failMode === "reject") {
    return {
      decision: "reject",
      reason: "sensitive_review",
      score: 0.92,
      matchedRules: ["tencent-disabled:reject"],
      provider: "tencent-disabled",
    };
  }
  return {
    decision: "review",
    reason: "sensitive_review",
    score: 0.55,
    matchedRules: ["tencent-disabled:review"],
    provider: "tencent-disabled",
  };
}
