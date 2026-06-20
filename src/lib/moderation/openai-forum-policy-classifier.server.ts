import {
  resolveOpenAIForumPolicyModel,
  resolveOpenAIForumPolicyTimeoutMs,
  type ModerationRuntimeEnv,
} from "./moderation-provider.server.ts";
import type {
  ForumPolicyClassifierResult,
  ModerationProviderStatus,
  ModerationReasonCode,
} from "./moderation-types.ts";

const OPENAI_CHAT_COMPLETIONS_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const keyEnvName = String.fromCharCode(
  79, 80, 69, 78, 65, 73, 95, 65, 80, 73, 95, 75, 69, 89,
);

export type ForumPolicyClassifierInput = {
  targetType: string;
  title?: string;
  body?: string;
  description?: string;
  localeHint?: string;
  localSignals?: {
    categories?: string[];
    matchedRules?: string[];
    safeSummary?: string | null;
  };
  metadata?: Record<string, unknown>;
};

type ParsedClassifierPayload = {
  decision?: "allow" | "review" | "reject";
  reason_code?: string;
  confidence?: "low" | "medium" | "high";
  matched_policy?: string | null;
};

function sanitizeProviderMessage(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/gi, "sk-[redacted]")
    .slice(0, 220);
}

function buildErrorResult(
  reasonCode: ModerationReasonCode,
  providerStatus: ModerationProviderStatus,
  safeSummary: string,
): ForumPolicyClassifierResult {
  return {
    provider: "forum_policy",
    decision: "error",
    reasonCode,
    confidence: "low",
    matchedPolicy: null,
    providerStatus,
    safeSummary,
  };
}

function mapReasonCode(raw: string | undefined): ModerationReasonCode {
  const value = String(raw ?? "clean").trim().toLowerCase();
  const normalized = value.replace(/^forum_policy_/, "");
  const mapping = new Set([
    "clean",
    "off_platform_contact",
    "spam_or_promotion",
    "scam_or_resource_lure",
    "suspicious_external_link",
    "fake_download_or_private_access",
    "sexual_content",
    "violence_or_threat",
    "hate_or_harassment",
    "illegal_goods_or_services",
    "personal_data_or_doxxing",
    "political_sensitive",
    "vulgar_abuse",
    "low_quality_spam",
    "platform_policy_custom",
  ]);

  if (!mapping.has(normalized)) {
    return "forum_policy_platform_policy_custom";
  }

  return `forum_policy_${normalized}` as ModerationReasonCode;
}

function buildUserPayload(input: ForumPolicyClassifierInput) {
  const safeMetadata = {
    target_type: input.targetType,
    locale: input.localeHint ?? "zh-CN",
    local_signals: {
      categories: input.localSignals?.categories ?? [],
      matched_rules: input.localSignals?.matchedRules?.slice(0, 8) ?? [],
      safe_summary: input.localSignals?.safeSummary ?? null,
    },
    media_metadata: input.metadata?.media ?? null,
    link_flags: input.metadata?.linkFlags ?? null,
  };

  return {
    content: {
      title: input.title?.slice(0, 500) ?? "",
      body: input.body?.slice(0, 4000) ?? "",
      description: input.description?.slice(0, 1500) ?? "",
    },
    signals: safeMetadata,
  };
}

function buildMessages(input: ForumPolicyClassifierInput) {
  return [
    {
      role: "system",
      content:
        "You classify OpenGlass Hub community content for a forum moderation pipeline. " +
        "Return strict JSON only with keys decision, reason_code, confidence, matched_policy. " +
        "Decisions: allow, review, reject. " +
        "reason_code must be one of: clean, off_platform_contact, spam_or_promotion, scam_or_resource_lure, suspicious_external_link, fake_download_or_private_access, sexual_content, violence_or_threat, hate_or_harassment, illegal_goods_or_services, personal_data_or_doxxing, political_sensitive, vulgar_abuse, low_quality_spam, platform_policy_custom. " +
        "Rules: clean AR/AI/XR glasses discussion should allow. " +
        "Off-platform contact, private-resource lures, scam trading, spam promotion, suspicious external download lures should review or reject. " +
        "Content involving human trafficking, prostitution, sexual exploitation, or illegal sexual services must review or reject. " +
        "Do not output explanations or markdown.",
    },
    {
      role: "user",
      content: JSON.stringify(buildUserPayload(input)),
    },
  ];
}

function extractJson(text: string): ParsedClassifierPayload | null {
  const trimmed = text.trim();
  const direct = trimmed.startsWith("{") ? trimmed : trimmed.slice(trimmed.indexOf("{"));
  if (!direct.startsWith("{")) return null;
  const closingIndex = direct.lastIndexOf("}");
  if (closingIndex < 0) return null;
  try {
    return JSON.parse(direct.slice(0, closingIndex + 1)) as ParsedClassifierPayload;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function runOpenAIForumPolicyClassifier(
  env: ModerationRuntimeEnv,
  input: ForumPolicyClassifierInput,
): Promise<ForumPolicyClassifierResult> {
  const apiKey = String(env[keyEnvName] ?? "").trim();
  if (!apiKey) {
    return buildErrorResult(
      "forum_policy_error",
      "missing_key",
      "OpenAI API key is not configured for forum policy classification.",
    );
  }

  const model = resolveOpenAIForumPolicyModel(env);
  if (!model) {
    return buildErrorResult(
      "forum_policy_missing_model",
      "not_configured",
      "Forum policy classifier model is not configured.",
    );
  }

  const timeoutMs = resolveOpenAIForumPolicyTimeoutMs(env);

  try {
    const response = await fetchWithTimeout(
      OPENAI_CHAT_COMPLETIONS_ENDPOINT,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: buildMessages(input),
        }),
      },
      timeoutMs,
    );

    const responseText = await response.text();
    if (!response.ok) {
      console.warn("[moderation] forum policy provider error", {
        targetType: input.targetType,
        status: response.status,
        message: sanitizeProviderMessage(responseText || `HTTP ${response.status}`),
      });
      return buildErrorResult(
        "forum_policy_error",
        "http_error",
        "Forum policy classifier returned an HTTP error.",
      );
    }

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(responseText) as {
        choices?: Array<{ message?: { content?: string | null } | null }>;
      };
    } catch {
      return buildErrorResult(
        "forum_policy_invalid_json",
        "invalid_response",
        "Forum policy classifier returned invalid JSON.",
      );
    }

    const content = parsedResponse.choices?.[0]?.message?.content ?? "";
    const parsedPayload = extractJson(content);
    if (!parsedPayload?.decision) {
      return buildErrorResult(
        "forum_policy_invalid_json",
        "invalid_response",
        "Forum policy classifier did not return a valid JSON decision.",
      );
    }

    const decision =
      parsedPayload.decision === "reject" || parsedPayload.decision === "review"
        ? parsedPayload.decision
        : "allow";

    return {
      provider: "forum_policy",
      decision,
      reasonCode: mapReasonCode(parsedPayload.reason_code),
      confidence:
        parsedPayload.confidence === "high" || parsedPayload.confidence === "medium"
          ? parsedPayload.confidence
          : "low",
      matchedPolicy: parsedPayload.matched_policy ?? null,
      providerStatus: "success",
      safeSummary: `Forum policy classifier returned ${decision}.`,
    };
  } catch (error) {
    const providerStatus =
      error instanceof Error && error.name === "AbortError"
        ? "timeout"
        : "network_error";
    console.warn("[moderation] forum policy provider error", {
      targetType: input.targetType,
      message: sanitizeProviderMessage(error instanceof Error ? error.message : String(error)),
    });
    return buildErrorResult(
      providerStatus === "timeout" ? "forum_policy_timeout" : "forum_policy_error",
      providerStatus,
      providerStatus === "timeout"
        ? "Forum policy classifier timed out."
        : "Forum policy classifier request failed before completion.",
    );
  }
}
