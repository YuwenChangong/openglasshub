import {
  MODERATION_MAX_LINKS_REJECT,
  MODERATION_MAX_LINKS_REVIEW,
  MODERATION_MIN_TEXT_LENGTH,
  MODERATION_REPEAT_REJECT_THRESHOLD,
  MODERATION_REPEAT_REVIEW_THRESHOLD,
} from "./moderation-policy.ts";
import {
  evaluateLocalSensitiveLexicon,
} from "./local-sensitive-lexicon.server.ts";
import {
  buildModerationProviderInput,
  isOpenAIForumPolicyClassifierEnabled,
  resolveModerationProvider,
  resolveOpenAIFailMode,
  resolveOpenAIForumPolicyFailMode,
  resolveModerationProviderUnavailablePolicy,
  runMockModerationProvider,
  runTencentDisabledFallback,
  type ModerationRuntimeEnv,
} from "./moderation-provider.server.ts";
import { runOpenAIModeration } from "./openai-moderation-provider.server.ts";
import {
  runOpenAIForumPolicyClassifier,
  type ForumPolicyClassifierInput,
} from "./openai-forum-policy-classifier.server.ts";
import type {
  ForumPolicyClassifierResult,
  ModerationDecision,
  ModerationInput,
  ModerationLocalInput,
  ModerationProviderInput,
  ModerationProviderStatus,
  ModerationReasonCode,
  ModerationResult,
  ModerationProviderUnavailablePolicy,
  OpenAIModerationResult,
} from "./moderation-types.ts";

function buildResult(
  decision: ModerationDecision,
  reason: ModerationReasonCode | null,
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

function localInputToModerationInput(baseInput: ModerationInput, localInput: ModerationLocalInput): ModerationInput {
  return {
    contentType: localInput.contentType,
    userId: baseInput.userId,
    text: localInput.text,
    links: localInput.links,
    metadata: localInput.metadata,
  };
}

function buildDefaultProviderInput(input: ModerationInput): ModerationProviderInput {
  const targetType =
    input.contentType === "comment_body"
      ? "comment_text"
      : input.contentType === "circle_name" || input.contentType === "circle_description"
        ? "circle_text"
        : input.contentType === "profile_text"
          ? "profile_text"
          : "post_text";

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

function buildForumPolicyInput(
  input: ModerationInput,
  providerInput: ModerationProviderInput,
  localResult: ModerationResult,
): ForumPolicyClassifierInput {
  return {
    targetType: providerInput.targetType,
    title: providerInput.title,
    body: providerInput.body,
    description: providerInput.description,
    localeHint: providerInput.localeHint,
    localSignals: {
      categories: localResult.providerDetails?.categories ?? [],
      matchedRules: localResult.matchedRules,
      safeSummary: localResult.providerDetails?.safeSummary ?? null,
    },
    metadata: {
      ...(input.metadata ?? {}),
      media: providerInput.imageUrls?.length ? { imageCount: providerInput.imageUrls.length } : null,
      linkFlags: {
        count: input.links?.length ?? extractLinks(input.text).length,
      },
    },
  };
}

function mergeModerationProvider(base: ModerationResult["provider"], incoming: ModerationResult["provider"]) {
  if (base === incoming) return base;
  if (base === "local" && incoming === "layered") return "layered";
  if (base === "layered" || incoming === "layered") return "layered";
  if (base === "local" && incoming !== "local") return "layered";
  if (incoming === "local") return base;
  return "layered";
}

function mergeProviderDetails(
  current: ModerationResult["providerDetails"] | undefined,
  next: ModerationResult["providerDetails"] | undefined,
): ModerationResult["providerDetails"] {
  return {
    ...(current ?? {}),
    ...(next ?? {}),
    categories: Array.from(
      new Set([...(current?.categories ?? []), ...(next?.categories ?? [])]),
    ),
    scoresSummary: {
      ...(current?.scoresSummary ?? {}),
      ...(next?.scoresSummary ?? {}),
    },
  };
}

export function evaluateLocalModeration(input: ModerationInput): ModerationResult {
  const rawText = String(input.text ?? "");
  const text = rawText.trim();
  const links = input.links?.length ? input.links : extractLinks(text);
  const matchedRules: string[] = [];
  const lexiconResult = evaluateLocalSensitiveLexicon(text);

  if (lexiconResult.decision === "reject") {
    return buildResult("reject", lexiconResult.reasonCode, lexiconResult.confidence, lexiconResult.matchedRules, "local", {
      decisionSource: "local",
      decisionPath: "reject",
      reasonCode: lexiconResult.reasonCode,
      safeSummary: lexiconResult.safeSummary,
      categories: lexiconResult.categories,
    });
  }

  if (links.length >= MODERATION_MAX_LINKS_REJECT) {
    matchedRules.push(`reject:excessive_links:${links.length}`);
    return buildResult("reject", "suspicious_external_link", 0.94, matchedRules, "local", {
      decisionSource: "local",
      decisionPath: "reject",
      reasonCode: "suspicious_external_link",
      safeSummary: "Local hard rule matched excessive links.",
      categories: ["suspicious_external_link"],
    });
  }

  const repeatCount = repeatedCharacterCount(text);
  if (repeatCount >= MODERATION_REPEAT_REJECT_THRESHOLD) {
    matchedRules.push(`reject:repeated_characters:${repeatCount}`);
    return buildResult("reject", "low_quality_spam", 0.91, matchedRules, "local", {
      decisionSource: "local",
      decisionPath: "reject",
      reasonCode: "low_quality_spam",
      safeSummary: "Local hard rule matched repeated characters.",
      categories: ["low_quality_spam"],
    });
  }

  if (text.length < MODERATION_MIN_TEXT_LENGTH || looksGibberish(text)) {
    matchedRules.push("review:gibberish");
    return buildResult("review", "gibberish", 0.52, matchedRules, "local", {
      decisionSource: "local",
      decisionPath: "review",
      reasonCode: "gibberish",
      safeSummary: "Local hard rule matched low-signal content.",
      categories: ["low_quality_spam"],
    });
  }

  if (lexiconResult.decision === "review") {
    return buildResult("review", lexiconResult.reasonCode, lexiconResult.confidence, lexiconResult.matchedRules, "local", {
      decisionSource: "local",
      decisionPath: "review",
      reasonCode: lexiconResult.reasonCode,
      safeSummary: lexiconResult.safeSummary,
      categories: lexiconResult.categories,
    });
  }

  if (links.length >= MODERATION_MAX_LINKS_REVIEW) {
    matchedRules.push(`review:excessive_links:${links.length}`);
    return buildResult("review", "suspicious_external_link", 0.51, matchedRules, "local", {
      decisionSource: "local",
      decisionPath: "review",
      reasonCode: "suspicious_external_link",
      safeSummary: "Local rule matched suspicious link density.",
      categories: ["suspicious_external_link"],
    });
  }

  if (repeatCount >= MODERATION_REPEAT_REVIEW_THRESHOLD) {
    matchedRules.push(`review:repeated_characters:${repeatCount}`);
    return buildResult("review", "low_quality_spam", 0.5, matchedRules, "local", {
      decisionSource: "local",
      decisionPath: "review",
      reasonCode: "low_quality_spam",
      safeSummary: "Local rule matched repeated characters.",
      categories: ["low_quality_spam"],
    });
  }

  if (hasRepeatedContent(text)) {
    matchedRules.push("review:repeated_content");
    return buildResult("review", "low_quality_spam", 0.49, matchedRules, "local", {
      decisionSource: "local",
      decisionPath: "review",
      reasonCode: "low_quality_spam",
      safeSummary: "Local rule matched repeated content.",
      categories: ["low_quality_spam"],
    });
  }

  return buildResult("allow", null, 0.02, [], "local", {
    decisionSource: "local",
    decisionPath: "allow",
    reasonCode: null,
    categories: [],
  });
}

export function mergeModerationResults(results: ModerationResult[]): ModerationResult {
  const priority = { reject: 3, review: 2, allow: 1 } as const;
  return results.reduce<ModerationResult>((current, result) => {
    if (priority[result.decision] > priority[current.decision]) return result;
    if (priority[result.decision] === priority[current.decision] && result.score > current.score) return result;
    if (priority[result.decision] === priority[current.decision] && result.score === current.score) {
      return {
        ...current,
        provider: mergeModerationProvider(current.provider, result.provider),
        matchedRules: Array.from(new Set([...current.matchedRules, ...result.matchedRules])),
        providerDetails: mergeProviderDetails(current.providerDetails, result.providerDetails),
      };
    }
    return current;
  }, buildResult("allow", null, 0, [], "local"));
}

function mapOpenAIResultToModerationResult(result: OpenAIModerationResult): ModerationResult {
  const decision = result.decision === "reject" ? "reject" : result.decision === "review" ? "review" : "allow";
  return buildResult(
    decision,
    result.reasonCode as ModerationReasonCode,
    decision === "reject" ? 0.94 : decision === "review" ? 0.62 : 0.03,
    result.reasonCode ? [`openai:${result.reasonCode}`] : [],
    "layered",
    {
      decisionSource: "openai",
      decisionPath: decision,
      reasonCode: result.reasonCode,
      providerStatus: result.providerStatus,
      safeSummary: result.safeSummary ?? null,
      localDecision: "allow",
      openaiDecision: result.decision === "error" ? "error" : decision,
      categories: result.categories,
      scoresSummary: result.scoresSummary,
      providerError: result.decision === "error" ? result.reasonCode : null,
    },
  );
}

function mapForumPolicyResultToModerationResult(result: ForumPolicyClassifierResult): ModerationResult {
  const decision = result.decision === "reject" ? "reject" : result.decision === "review" ? "review" : "allow";
  return buildResult(
    decision,
    result.reasonCode,
    decision === "reject" ? 0.9 : decision === "review" ? 0.61 : 0.03,
    result.matchedPolicy ? [`forum_policy:${result.matchedPolicy}`] : [],
    "layered",
    {
      decisionSource: "forum_policy",
      decisionPath: decision,
      reasonCode: result.reasonCode,
      providerStatus: result.providerStatus,
      safeSummary: result.safeSummary ?? null,
      providerError: result.decision === "error" ? result.reasonCode : null,
    },
  );
}

function mapProviderErrorResult(
  reason: ModerationReasonCode,
  providerStatus: ModerationProviderStatus | undefined,
  safeSummary: string | null | undefined,
  source: "openai" | "forum_policy",
  failMode: "review" | "reject",
): ModerationResult {
  const decision = failMode === "reject" ? "reject" : "review";
  return buildResult(
    decision,
    reason,
    decision === "reject" ? 0.91 : 0.6,
    [source === "openai" ? `openai:${reason}` : `forum_policy:${reason}`],
    "layered",
    {
      decisionSource: "provider_error",
      decisionPath: decision,
      reasonCode: reason,
      providerStatus,
      safeSummary: safeSummary ?? null,
      openaiDecision: source === "openai" ? "error" : undefined,
      providerError: String(reason),
    },
  );
}

function isProviderUnavailableStatus(status: ModerationProviderStatus | undefined): boolean {
  return (
    status === "http_429" ||
    status === "http_5xx" ||
    status === "timeout" ||
    status === "network_error" ||
    status === "circuit_open"
  );
}

function applyUnavailablePolicy(params: {
  localResult: ModerationResult;
  providerResult: ModerationResult;
  policy: ModerationProviderUnavailablePolicy;
  source: "openai" | "forum_policy";
}): ModerationResult {
  const { localResult, providerResult, policy, source } = params;
  const providerStatus = providerResult.providerDetails?.providerStatus;
  if (!isProviderUnavailableStatus(providerStatus)) {
    return mergeModerationResults([localResult, providerResult]);
  }

  if (localResult.decision === "reject" || localResult.decision === "review") {
    return mergeModerationResults([localResult, providerResult]);
  }

  if (policy !== "local_only_safe") {
    return mergeModerationResults([localResult, providerResult]);
  }

  return buildResult(
    "allow",
    "openai_provider_unavailable_local_allow",
    0.08,
    [
      ...localResult.matchedRules,
      `${source}:openai_provider_unavailable_local_allow`,
    ],
    source === "openai" ? "local_degraded" : "layered_degraded",
    {
      decisionSource: "local_degraded",
      decisionPath: "allow",
      reasonCode: "openai_provider_unavailable_local_allow",
      providerStatus,
      safeSummary:
        providerResult.providerDetails?.safeSummary ??
        "Provider unavailable; local-only degraded moderation allow applied.",
      localDecision: localResult.decision,
      openaiDecision: providerResult.providerDetails?.openaiDecision ?? "error",
      categories: providerResult.providerDetails?.categories ?? [],
      scoresSummary: providerResult.providerDetails?.scoresSummary ?? {},
      providerError: providerResult.providerDetails?.providerError ?? null,
    },
  );
}

export async function moderateContent(
  env: ModerationRuntimeEnv,
  input: ModerationInput,
  options?: {
    openaiRunner?: typeof runOpenAIModeration;
    forumClassifierRunner?: typeof runOpenAIForumPolicyClassifier;
  },
): Promise<ModerationResult> {
  const localInputs =
    input.localInputs?.length
      ? input.localInputs.map((item) => evaluateLocalModeration(localInputToModerationInput(input, item)))
      : [evaluateLocalModeration(input)];
  let finalResult = mergeModerationResults(localInputs);
  const provider = resolveModerationProvider(env);
  const providerInput = buildDefaultProviderInput(input);
  const unavailablePolicy = resolveModerationProviderUnavailablePolicy(env);

  if (provider === "mock") {
    const mockResult = await runMockModerationProvider(providerInput);
    const mapped = mergeModerationResults([finalResult, mockResult]);
    return {
      ...mapped,
      provider: mergeModerationProvider(finalResult.provider, mapped.provider),
    };
  }

  if (provider === "tencent-disabled") {
    const fallbackResult = runTencentDisabledFallback(env);
    return mergeModerationResults([finalResult, fallbackResult]);
  }

  if (finalResult.decision !== "reject" && provider === "openai") {
    const openaiRunner = options?.openaiRunner ?? runOpenAIModeration;
    const openaiResult = await openaiRunner(env, providerInput);

    if (openaiResult.decision === "error") {
      return applyUnavailablePolicy({
        localResult: finalResult,
        providerResult: mapProviderErrorResult(
          openaiResult.reasonCode as ModerationReasonCode,
          openaiResult.providerStatus,
          openaiResult.safeSummary,
          "openai",
          unavailablePolicy === "block_sensitive" ? "review" : resolveOpenAIFailMode(env),
        ),
        policy: unavailablePolicy,
        source: "openai",
      });
    }

    finalResult = mergeModerationResults([finalResult, mapOpenAIResultToModerationResult(openaiResult)]);
  }

  const forumPolicyClassifierEnabled = isOpenAIForumPolicyClassifierEnabled(env);

  if (finalResult.decision !== "reject" && forumPolicyClassifierEnabled) {
    const forumClassifierRunner = options?.forumClassifierRunner ?? runOpenAIForumPolicyClassifier;
    const forumResult = await forumClassifierRunner(env, buildForumPolicyInput(input, providerInput, finalResult));

    if (forumResult.decision === "error") {
      return applyUnavailablePolicy({
        localResult: finalResult,
        providerResult: mapProviderErrorResult(
          forumResult.reasonCode,
          forumResult.providerStatus,
          forumResult.safeSummary,
          "forum_policy",
          unavailablePolicy === "block_sensitive" ? "review" : resolveOpenAIForumPolicyFailMode(env),
        ),
        policy: unavailablePolicy,
        source: "forum_policy",
      });
    }

    finalResult = mergeModerationResults([finalResult, mapForumPolicyResultToModerationResult(forumResult)]);
  }

  return {
    ...finalResult,
    provider: finalResult.provider === "local" ? "local" : "layered",
  };
}

export function isProviderErrorModerationResult(result: Pick<ModerationResult, "reason">): boolean {
  return Boolean(
    result.reason &&
      (String(result.reason).startsWith("openai_provider_error_") ||
        String(result.reason).startsWith("forum_policy_") && /invalid_json|timeout|error|missing_model/.test(String(result.reason))),
  );
}

export function isLocalDegradedModerationResult(
  result: Pick<ModerationResult, "decision" | "reason" | "provider" | "providerDetails">,
): boolean {
  return (
    result.decision === "allow" &&
    (result.reason === "openai_provider_unavailable_local_allow" ||
      result.provider === "local_degraded" ||
      result.provider === "layered_degraded" ||
      result.providerDetails?.decisionSource === "local_degraded")
  );
}
