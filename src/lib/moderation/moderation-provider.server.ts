import type {
  ModerationFailMode,
  ModerationProviderInput,
  ModerationProviderName,
  ModerationProviderUnavailablePolicy,
  ModerationResult,
} from "./moderation-types.ts";

export type ModerationRuntimeEnv = Record<string, string | undefined>;

export function resolveLegacyModerationProvider(env: ModerationRuntimeEnv): "local" | "mock" | "tencent" {
  const raw = String(env.MODERATION_PROVIDER ?? "local").trim().toLowerCase();
  return raw === "mock" || raw === "tencent" ? raw : "local";
}

export function resolveModerationProvider(env: ModerationRuntimeEnv): ModerationProviderName {
  const legacyProvider = resolveLegacyModerationProvider(env);
  if (legacyProvider === "mock") return "mock";
  if (legacyProvider === "tencent") return "tencent-disabled";
  return isOpenAIModerationEnabled(env) ? "openai" : "local";
}

export function isOpenAIModerationEnabled(env: ModerationRuntimeEnv): boolean {
  return String(env.OPENAI_MODERATION_ENABLED ?? "false").trim().toLowerCase() === "true";
}

function resolveBooleanFlag(value: string | undefined, fallback = false): boolean {
  if (typeof value === "undefined") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

export function isOpenAIImageModerationEnabled(env: ModerationRuntimeEnv): boolean {
  return resolveBooleanFlag(env.OPENAI_MODERATION_IMAGE_ENABLED, false);
}

export function isOpenAIPostImageModerationEnabled(env: ModerationRuntimeEnv): boolean {
  return resolveBooleanFlag(env.OPENAI_POST_IMAGE_MODERATION_ENABLED, isOpenAIImageModerationEnabled(env));
}

export function isOpenAIProfileImageModerationEnabled(env: ModerationRuntimeEnv): boolean {
  return resolveBooleanFlag(env.OPENAI_PROFILE_IMAGE_MODERATION_ENABLED, false);
}

export function isOpenAICircleCoverModerationEnabled(env: ModerationRuntimeEnv): boolean {
  return resolveBooleanFlag(env.OPENAI_CIRCLE_COVER_MODERATION_ENABLED, false);
}

export function isOpenAIVideoThumbnailModerationEnabled(env: ModerationRuntimeEnv): boolean {
  return resolveBooleanFlag(env.OPENAI_VIDEO_THUMBNAIL_MODERATION_ENABLED, false);
}

export function doesVideoPostRequireThumbnailModeration(env: ModerationRuntimeEnv): boolean {
  return resolveBooleanFlag(env.VIDEO_POST_REQUIRES_THUMBNAIL_MODERATION, false);
}

export function resolveOpenAIFailMode(env: ModerationRuntimeEnv): Extract<ModerationFailMode, "review" | "reject"> {
  const raw = String(env.OPENAI_MODERATION_FAIL_MODE ?? "review").trim().toLowerCase();
  return raw === "reject" ? "reject" : "review";
}

export function resolveVideoPostFailMode(env: ModerationRuntimeEnv): Extract<ModerationFailMode, "review" | "reject"> {
  const raw = String(env.VIDEO_POST_FAIL_MODE ?? resolveOpenAIFailMode(env)).trim().toLowerCase();
  return raw === "reject" ? "reject" : "review";
}

export function isOpenAIForumPolicyEnabled(env: ModerationRuntimeEnv): boolean {
  return resolveBooleanFlag(env.OPENAI_FORUM_POLICY_ENABLED, false);
}

export function resolveOpenAIForumPolicyModel(env: ModerationRuntimeEnv): string {
  return String(env.OPENAI_FORUM_POLICY_MODEL ?? "").trim();
}

export function resolveOpenAIForumPolicyTimeoutMs(env: ModerationRuntimeEnv): number {
  const raw = Number(env.OPENAI_FORUM_POLICY_TIMEOUT_MS ?? 4000);
  if (!Number.isFinite(raw) || raw < 500) return 4000;
  return Math.min(Math.max(Math.round(raw), 500), 10000);
}

export function resolveOpenAIForumPolicyFailMode(env: ModerationRuntimeEnv): Extract<ModerationFailMode, "review" | "reject"> {
  const raw = String(env.OPENAI_FORUM_POLICY_FAIL_MODE ?? "review").trim().toLowerCase();
  return raw === "reject" ? "reject" : "review";
}

export function resolveModerationProviderUnavailablePolicy(
  env: ModerationRuntimeEnv,
): ModerationProviderUnavailablePolicy {
  const configured = String(env.MODERATION_PROVIDER_UNAVAILABLE_POLICY ?? "").trim().toLowerCase();
  if (!configured) {
    const branch = String(env.CF_PAGES_BRANCH ?? "").trim().toLowerCase();
    if (branch && branch !== "main" && branch !== "master") {
      return "local_only_safe";
    }
    return "review_all";
  }
  const raw = configured;
  if (raw === "local_only_safe" || raw === "block_sensitive") return raw;
  return "review_all";
}

export function resolveOpenAIModerationModel(env: ModerationRuntimeEnv): string {
  const value = String(env.OPENAI_MODERATION_MODEL ?? "omni-moderation-latest").trim();
  return value || "omni-moderation-latest";
}

export function resolveOpenAIModerationTimeoutMs(env: ModerationRuntimeEnv): number {
  const raw = Number(env.OPENAI_MODERATION_TIMEOUT_MS ?? 3500);
  if (!Number.isFinite(raw) || raw < 500) return 3500;
  return Math.min(Math.max(Math.round(raw), 500), 10000);
}

export function resolveOpenAIModerationLogLevel(env: ModerationRuntimeEnv): "minimal" | "debug" {
  return String(env.OPENAI_MODERATION_LOG_LEVEL ?? "minimal").trim().toLowerCase() === "debug"
    ? "debug"
    : "minimal";
}

export function buildModerationProviderInput(input: {
  targetType: ModerationProviderInput["targetType"];
  text?: string;
  title?: string;
  body?: string;
  description?: string;
  imageUrls?: string[];
  localeHint?: string;
  metadata?: Record<string, unknown>;
}): ModerationProviderInput {
  return {
    targetType: input.targetType,
    title: input.title?.trim() || undefined,
    body: input.body?.trim() || input.text?.trim() || undefined,
    description: input.description?.trim() || undefined,
    imageUrls: input.imageUrls?.filter(Boolean) ?? [],
    localeHint: input.localeHint?.trim() || undefined,
    metadata: input.metadata,
  };
}

export async function runMockModerationProvider(
  providerInput: ModerationProviderInput,
): Promise<ModerationResult> {
  const decision = String(providerInput.metadata?.mockDecision ?? "allow").trim().toLowerCase();
  if (decision === "review") {
    return {
      decision: "review",
      reason: "openai_threshold_review",
      score: 0.61,
      matchedRules: ["mock:review"],
      provider: "mock",
      providerDetails: {
        categories: ["mock-review"],
        scoresSummary: { "mock-review": "medium" },
      },
    };
  }
  if (decision === "reject") {
    return {
      decision: "reject",
      reason: "openai_flagged_text",
      score: 0.96,
      matchedRules: ["mock:reject"],
      provider: "mock",
      providerDetails: {
        categories: ["mock-reject"],
        scoresSummary: { "mock-reject": "high" },
      },
    };
  }
  if (decision === "error") {
    return {
      decision: "review",
      reason: "openai_provider_error_review",
      score: 0.6,
      matchedRules: ["mock:error"],
      provider: "mock",
      providerDetails: {
        providerError: "mock provider error",
      },
    };
  }
  return {
    decision: "allow",
    reason: null,
    score: 0.03,
    matchedRules: ["mock:allow"],
    provider: "mock",
  };
}

export function runTencentDisabledFallback(
  env: ModerationRuntimeEnv,
): ModerationResult {
  const failMode = String(env.MODERATION_FAIL_MODE ?? "review").trim().toLowerCase();
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
