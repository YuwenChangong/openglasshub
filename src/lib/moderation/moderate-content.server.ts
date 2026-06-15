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
import { resolveModerationProvider, runProviderFallback, type ModerationRuntimeEnv } from "./moderation-provider.server.ts";
import type {
  ModerationInput,
  ModerationReasonCode,
  ModerationResult,
} from "./moderation-types.ts";

function buildResult(
  decision: ModerationResult["decision"],
  reason: ModerationReasonCode | null,
  score: number,
  matchedRules: string[],
  provider: ModerationResult["provider"],
): ModerationResult {
  return { decision, reason, score, matchedRules, provider };
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
  return trimmed.length <= 6 || (symbols > alnum && trimmed.length < 18);
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
  if (allowlistActive && rulePrefix === "review:sensitiveReview") return [];
  return patterns
    .filter((pattern) => pattern.test(text))
    .map((pattern, index) => `${rulePrefix}:${index + 1}:${pattern.source}`);
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

export async function moderateContent(
  env: ModerationRuntimeEnv,
  input: ModerationInput,
): Promise<ModerationResult> {
  const localResult = evaluateLocalModeration(input);
  const provider = resolveModerationProvider(env);

  if (localResult.decision !== "allow" || provider === "local") {
    return localResult;
  }

  return runProviderFallback(env, input);
}
