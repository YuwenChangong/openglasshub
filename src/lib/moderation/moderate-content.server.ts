import {
  MODERATION_MAX_LINKS_REJECT,
  MODERATION_MAX_LINKS_REVIEW,
  MODERATION_MIN_TEXT_LENGTH,
  MODERATION_REPEAT_REJECT_THRESHOLD,
  MODERATION_REPEAT_REVIEW_THRESHOLD,
} from "./moderation-policy.ts";
import {
  moderationAllowlistPatterns,
  moderationBlocklistPatterns,
  moderationReviewPatterns,
} from "./sensitive-terms.server.ts";
import {
  buildModerationProviderInput,
  resolveModerationProvider,
  resolveOpenAIFailMode,
  runMockModerationProvider,
  runTencentDisabledFallback,
  type ModerationRuntimeEnv,
} from "./moderation-provider.server.ts";
import { runOpenAIModeration } from "./openai-moderation-provider.server.ts";
import type {
  ModerationDecision,
  ModerationInput,
  ModerationLocalInput,
  ModerationProviderInput,
  ModerationReasonCode,
  ModerationResult,
} from "./moderation-types.ts";

function buildResult(
  decision: ModerationDecision,
  reason: ModerationReasonCode | null,
  score: number,
  matchedRules: string[],
  provider: ModerationResult["provider"],
  providerDetails?: ModerationResult["providerDetails"],
): ModerationResult {
  return { decision, reason, score, matchedRules, provider, providerDetails };
}

function extractLinks(text: string): string[] {
  return Array.from(text.matchAll(/https?:\/\/[^\s<>"')]+/gi)).map((match) => match[0]);
}

function repeatedCharacterCount(text: string): number {
  let maxRun = 1;
  let currentRun = 1;
  for (let index = 1; index < text.length; index += 1) {
    if (text[index] === text[index - 1]) {
      currentRun += 1;
      maxRun = Math.max(maxRun, currentRun);
    } else {
      currentRun = 1;
    }
  }
  return maxRun;
}

function looksGibberish(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  const alnum = (trimmed.match(/[a-z0-9\u4e00-\u9fff]/gi) ?? []).length;
  const symbols = trimmed.length - alnum;
  if (alnum === 0) return true;
  if (trimmed.length <= 4) return alnum <= 1;
  if (trimmed.length <= 6) return symbols > alnum && alnum <= 2;
  return symbols > alnum && trimmed.length < 18;
}

function hasRepeatedContent(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (normalized.length < 6) return false;
  const counts = new Map<string, number>();
  for (const token of normalized) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return Array.from(counts.values()).some((count) => count >= 6);
}

function matchPatternGroup(
  text: string,
  patterns: readonly RegExp[],
  rulePrefix: string,
  allowlistActive: boolean,
): string[] {
  if (allowlistActive && rulePrefix === "review:sensitive_review") return [];
  return patterns
    .filter((pattern) => pattern.test(text))
    .map((pattern, index) => `${rulePrefix}:${index + 1}:${pattern.source}`);
}

function buildDefaultProviderInput(input: ModerationInput): ModerationProviderInput {
  const targetType =
    input.contentType === "comment_body"
      ? "comment"
      : input.contentType === "circle_name" || input.contentType === "circle_description"
        ? "circle"
        : input.contentType === "profile_text"
          ? "profile"
          : "post";

  if (input.providerInput) {
    return {
      ...input.providerInput,
      metadata: {
        ...(input.providerInput.metadata ?? {}),
        ...(input.metadata ?? {}),
      },
    };
  }

  return buildModerationProviderInput({
    targetType,
    text: input.text,
    localeHint: "zh-CN",
    metadata: input.metadata,
  });
}

function localInputToModerationInput(baseInput: ModerationInput, localInput: ModerationLocalInput): ModerationInput {
  return {
    contentType: localInput.contentType,
    userId: baseInput.userId,
    text: localInput.text,
    links: localInput.links,
    metadata: localInput.metadata,
  };
}

export function evaluateLocalModeration(input: ModerationInput): ModerationResult {
  const rawText = String(input.text ?? "");
  const text = rawText.trim();
  const links = input.links?.length ? input.links : extractLinks(text);
  const allowlistActive = moderationAllowlistPatterns.some((pattern) => pattern.test(text));
  const matchedRules: string[] = [];

  const blockMatches: Array<{ reason: ModerationReasonCode; rules: string[]; score: number }> = [
    { reason: "spam", rules: matchPatternGroup(text, moderationBlocklistPatterns.spam, "block:spam", false), score: 0.99 },
    { reason: "scam", rules: matchPatternGroup(text, moderationBlocklistPatterns.scam, "block:scam", false), score: 0.98 },
    { reason: "sexual", rules: matchPatternGroup(text, moderationBlocklistPatterns.sexual, "block:sexual", false), score: 0.99 },
    { reason: "harassment", rules: matchPatternGroup(text, moderationBlocklistPatterns.harassment, "block:harassment", false), score: 0.97 },
    { reason: "violence", rules: matchPatternGroup(text, moderationBlocklistPatterns.violence, "block:violence", false), score: 0.99 },
    { reason: "illegal_goods", rules: matchPatternGroup(text, moderationBlocklistPatterns.illegalGoods, "block:illegal_goods", false), score: 0.99 },
    { reason: "malicious_link", rules: matchPatternGroup(text, moderationBlocklistPatterns.maliciousLink, "block:malicious_link", false), score: 0.98 },
  ];

  for (const match of blockMatches) {
    if (match.rules.length > 0) {
      matchedRules.push(...match.rules);
      return buildResult("reject", match.reason, match.score, matchedRules, "local");
    }
  }

  if (links.length >= MODERATION_MAX_LINKS_REJECT) {
    matchedRules.push(`reject:excessive_links:${links.length}`);
    return buildResult("reject", "excessive_links", 0.94, matchedRules, "local");
  }

  const repeatCount = repeatedCharacterCount(text);
  if (repeatCount >= MODERATION_REPEAT_REJECT_THRESHOLD) {
    matchedRules.push(`reject:repeated_characters:${repeatCount}`);
    return buildResult("reject", "repeated_content", 0.91, matchedRules, "local");
  }

  if (text.length < MODERATION_MIN_TEXT_LENGTH || looksGibberish(text)) {
    matchedRules.push("review:gibberish");
    return buildResult("review", "gibberish", 0.52, matchedRules, "local");
  }

  const reviewMatches: Array<{ reason: ModerationReasonCode; rules: string[]; score: number }> = [
    { reason: "sensitive_review", rules: matchPatternGroup(text, moderationReviewPatterns.sensitiveReview, "review:sensitive_review", allowlistActive), score: 0.58 },
    { reason: "personal_info", rules: matchPatternGroup(text, moderationReviewPatterns.personalInfo, "review:personal_info", false), score: 0.56 },
  ];

  for (const match of reviewMatches) {
    if (match.rules.length > 0) {
      matchedRules.push(...match.rules);
      return buildResult("review", match.reason, match.score, matchedRules, "local");
    }
  }

  if (links.length >= MODERATION_MAX_LINKS_REVIEW) {
    matchedRules.push(`review:excessive_links:${links.length}`);
    return buildResult("review", "excessive_links", 0.51, matchedRules, "local");
  }

  if (repeatCount >= MODERATION_REPEAT_REVIEW_THRESHOLD) {
    matchedRules.push(`review:repeated_characters:${repeatCount}`);
    return buildResult("review", "repeated_content", 0.5, matchedRules, "local");
  }

  if (hasRepeatedContent(text)) {
    matchedRules.push("review:repeated_content");
    return buildResult("review", "repeated_content", 0.49, matchedRules, "local");
  }

  return buildResult("allow", null, 0.02, [], "local");
}

export function mergeModerationResults(results: ModerationResult[]): ModerationResult {
  const priority = { reject: 3, review: 2, allow: 1 } as const;
  return results.reduce<ModerationResult>((current, result) => {
    if (priority[result.decision] > priority[current.decision]) return result;
    if (priority[result.decision] === priority[current.decision] && result.score > current.score) return result;
    if (priority[result.decision] === priority[current.decision] && result.score === current.score) {
      return {
        ...current,
        matchedRules: Array.from(new Set([...current.matchedRules, ...result.matchedRules])),
      };
    }
    return current;
  }, buildResult("allow", null, 0, [], "local"));
}

function mapOpenAIResultToModerationResult(
  decision: "allow" | "review" | "reject",
  reason: string | null,
  score: number,
  matchedRules: string[],
  categories?: string[],
  scoresSummary?: Record<string, "low" | "medium" | "high">,
  providerError?: string | null,
): ModerationResult {
  return buildResult(decision, reason as ModerationReasonCode | null, score, matchedRules, "local+openai", {
    categories,
    scoresSummary,
    providerError,
  });
}

export async function moderateContent(
  env: ModerationRuntimeEnv,
  input: ModerationInput,
  options?: {
    openaiRunner?: typeof runOpenAIModeration;
  },
): Promise<ModerationResult> {
  const localInputs =
    input.localInputs?.length
      ? input.localInputs.map((item) => evaluateLocalModeration(localInputToModerationInput(input, item)))
      : [evaluateLocalModeration(input)];
  const localResult = mergeModerationResults(localInputs);
  const provider = resolveModerationProvider(env);

  if (localResult.decision === "reject" || provider === "local") {
    return localResult;
  }

  const providerInput = buildDefaultProviderInput(input);

  if (provider === "mock") {
    const mockResult = await runMockModerationProvider(providerInput);
    if (localResult.decision === "review") {
      if (mockResult.decision === "reject") return mockResult;
      return {
        ...localResult,
        provider: "local+openai",
        matchedRules: Array.from(new Set([...localResult.matchedRules, ...mockResult.matchedRules])),
        providerDetails: mockResult.providerDetails,
      };
    }
    return mockResult;
  }

  if (provider === "tencent-disabled") {
    const fallbackResult = runTencentDisabledFallback(env);
    if (localResult.decision === "review") {
      return {
        ...localResult,
        provider: "local",
        matchedRules: Array.from(new Set([...localResult.matchedRules, ...fallbackResult.matchedRules])),
      };
    }
    return fallbackResult;
  }

  const openaiRunner = options?.openaiRunner ?? runOpenAIModeration;
  const openaiResult = await openaiRunner(env, providerInput);
  if (openaiResult.decision === "error") {
    const failMode = resolveOpenAIFailMode(env);
    if (localResult.decision === "review") {
      return {
        ...localResult,
        provider: "local+openai",
        providerDetails: { providerError: openaiResult.reasonCode },
      };
    }
    if (failMode === "local_only") {
      return {
        ...localResult,
        provider: "local+openai",
        matchedRules: Array.from(new Set([...localResult.matchedRules, openaiResult.reasonCode])),
        providerDetails: { providerError: openaiResult.reasonCode },
      };
    }
    return mapOpenAIResultToModerationResult(
      failMode === "reject" ? "reject" : "review",
      failMode === "reject" ? "openai_provider_error_reject" : "openai_provider_error_review",
      failMode === "reject" ? 0.93 : 0.61,
      [openaiResult.reasonCode],
      undefined,
      undefined,
      openaiResult.reasonCode,
    );
  }

  if (localResult.decision === "review") {
    if (openaiResult.decision === "reject") {
      return mapOpenAIResultToModerationResult(
        "reject",
        openaiResult.reasonCode,
        0.93,
        [`openai:${openaiResult.reasonCode}`],
        openaiResult.categories,
        openaiResult.scoresSummary,
      );
    }
    return {
      ...localResult,
      provider: "local+openai",
      matchedRules: Array.from(new Set([...localResult.matchedRules, ...(openaiResult.decision === "review" ? [`openai:${openaiResult.reasonCode}`] : [])])),
      providerDetails: {
        categories: openaiResult.categories,
        scoresSummary: openaiResult.scoresSummary,
      },
    };
  }

  if (openaiResult.decision === "allow") {
    return {
      ...localResult,
      provider: "local+openai",
      providerDetails: {
        categories: openaiResult.categories,
        scoresSummary: openaiResult.scoresSummary,
      },
    };
  }

  return mapOpenAIResultToModerationResult(
    openaiResult.decision,
    openaiResult.reasonCode,
    openaiResult.decision === "reject" ? 0.94 : 0.62,
    [`openai:${openaiResult.reasonCode}`],
    openaiResult.categories,
    openaiResult.scoresSummary,
  );
}
