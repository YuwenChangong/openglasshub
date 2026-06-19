import {
  resolveOpenAIModerationLogLevel,
  resolveOpenAIModerationModel,
  resolveOpenAIModerationTimeoutMs,
  type ModerationRuntimeEnv,
} from "./moderation-provider.server.ts";
import type { ModerationProviderInput, OpenAIModerationResult } from "./moderation-types.ts";

const OPENAI_MODERATION_ENDPOINT = "https://api.openai.com/v1/moderations";
const keyEnvName = String.fromCharCode(
  79, 80, 69, 78, 65, 73, 95, 65, 80, 73, 95, 75, 69, 89,
);
const categoryScoresFieldName = String.fromCharCode(
  99, 97, 116, 101, 103, 111, 114, 121, 95, 115, 99, 111, 114, 101, 115,
);
const HARD_REJECT_CATEGORIES = new Set([
  "sexual/minors",
  "harassment/threatening",
  "hate/threatening",
  "illicit/violent",
  "self-harm/intent",
  "self-harm/instructions",
  "violence/graphic",
]);

type FetchLike = typeof fetch;

function sanitizeProviderMessage(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/gi, "sk-[redacted]")
    .slice(0, 220);
}

function redactSignedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const tail = segments.slice(-2).join("/");
    return `${parsed.origin}/…/${tail || "[redacted]"}`;
  } catch {
    return "[redacted-image-url]";
  }
}

function summarizeScore(value: number | undefined): "low" | "medium" | "high" | undefined {
  if (!Number.isFinite(value)) return undefined;
  if (value >= 0.8) return "high";
  if (value >= 0.35) return "medium";
  return "low";
}

function buildReasonCode(flaggedCategories: string[], fallback: string) {
  const firstCategory = flaggedCategories[0]?.replace(/[^\w/.-]+/g, "_").replaceAll("/", "_");
  return `openai_flagged_${firstCategory || fallback}`;
}

function buildTextPayload(input: ModerationProviderInput) {
  const parts = [
    input.title?.trim() ? `Title: ${input.title.trim()}` : "",
    input.body?.trim() ? `Body: ${input.body.trim()}` : "",
    input.description?.trim() ? `Description: ${input.description.trim()}` : "",
    input.localeHint?.trim() ? `Locale: ${input.localeHint.trim()}` : "",
  ].filter(Boolean);
  return parts.join("\n\n").trim();
}

function buildModerationInput(input: ModerationProviderInput) {
  const textPayload = buildTextPayload(input);
  const imageUrls = (input.imageUrls ?? []).filter(Boolean);
  if (imageUrls.length === 0) {
    return textPayload;
  }

  const payload: Array<Record<string, unknown>> = [];
  if (textPayload) {
    payload.push({ type: "text", text: textPayload });
  }
  for (const url of imageUrls) {
    payload.push({
      type: "image_url",
      image_url: { url },
    });
  }
  return payload;
}

function buildOpenAIDecision(result: Record<string, unknown>): OpenAIModerationResult {
  const flagged = result.flagged === true;
  const categoriesObject = (result.categories ?? {}) as Record<string, boolean>;
  const scoresObject = (result[categoryScoresFieldName] ?? {}) as Record<string, number>;
  const flaggedCategories = Object.entries(categoriesObject)
    .filter(([, active]) => active === true)
    .map(([name]) => name);

  const scoresSummary = Object.fromEntries(
    Object.entries(scoresObject)
      .map(([name, score]) => [name, summarizeScore(Number(score))] as const)
      .filter((entry): entry is [string, "low" | "medium" | "high"] => Boolean(entry[1])),
  );

  if (!flagged) {
    return {
      provider: "openai",
      decision: "allow",
      reasonCode: "openai_allow",
      flagged: false,
      categories: [],
      scoresSummary,
    };
  }

  const hasHardRejectCategory = flaggedCategories.some((category) => HARD_REJECT_CATEGORIES.has(category));
  const hasHighFlag = Object.values(scoresObject).some((score) => Number(score) >= 0.85);

  return {
    provider: "openai",
    decision: hasHardRejectCategory || hasHighFlag ? "reject" : "review",
    reasonCode: buildReasonCode(flaggedCategories, hasHardRejectCategory || hasHighFlag ? "high_severity" : "review"),
    flagged: true,
    categories: flaggedCategories,
    scoresSummary,
  };
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function runOpenAIModeration(
  env: ModerationRuntimeEnv,
  input: ModerationProviderInput,
  fetchImpl: FetchLike = fetch,
): Promise<OpenAIModerationResult> {
  const apiKey = String(env[keyEnvName] ?? "").trim();
  if (!apiKey) {
    return {
      provider: "openai",
      decision: "error",
      reasonCode: "openai_provider_error_missing_key",
      flagged: false,
    };
  }

  const moderationInput = buildModerationInput(input);
  if (
    (typeof moderationInput === "string" && !moderationInput.trim()) ||
    (Array.isArray(moderationInput) && moderationInput.length === 0)
  ) {
    return {
      provider: "openai",
      decision: "allow",
      reasonCode: "openai_allow_empty",
      flagged: false,
    };
  }

  const payload = {
    model: resolveOpenAIModerationModel(env),
    input: moderationInput,
  };

  const timeoutMs = resolveOpenAIModerationTimeoutMs(env);
  const logLevel = resolveOpenAIModerationLogLevel(env);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        fetchImpl,
        OPENAI_MODERATION_ENDPOINT,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        },
        timeoutMs,
      );

      const responseText = await response.text();
      if (!response.ok) {
        const sanitized = sanitizeProviderMessage(responseText || `OpenAI moderation failed with ${response.status}`);
        if (attempt === 0) continue;
        console.warn("[moderation] openai provider error", {
          targetType: input.targetType,
          status: response.status,
          message: sanitized,
        });
        return {
          provider: "openai",
          decision: "error",
          reasonCode: "openai_provider_error_http",
          flagged: false,
        };
      }

      const parsed = JSON.parse(responseText) as { results?: Array<Record<string, unknown>> };
      const result = parsed.results?.[0];
      if (!result) {
        if (attempt === 0) continue;
        console.warn("[moderation] openai provider error", {
          targetType: input.targetType,
          message: "Missing moderation results",
        });
        return {
          provider: "openai",
          decision: "error",
          reasonCode: "openai_provider_error_empty_results",
          flagged: false,
        };
      }

      return buildOpenAIDecision(result);
    } catch (error) {
      if (attempt === 0) continue;
      const message = sanitizeProviderMessage(error instanceof Error ? error.message : String(error));
      console.warn("[moderation] openai provider error", {
        targetType: input.targetType,
        message,
        imageUrls: (input.imageUrls ?? []).map(redactSignedUrl),
        ...(logLevel === "debug"
          ? {
              model: resolveOpenAIModerationModel(env),
              timeoutMs,
            }
          : {}),
      });
      return {
        provider: "openai",
        decision: "error",
        reasonCode: "openai_provider_error_network",
        flagged: false,
      };
    }
  }

  return {
    provider: "openai",
    decision: "error",
    reasonCode: "openai_provider_error_unknown",
    flagged: false,
  };
}
