export type ModerationDecision = "allow" | "review" | "reject";

export type LocalModerationReasonCode =
  | "spam"
  | "scam"
  | "sexual"
  | "harassment"
  | "violence"
  | "illegal_goods"
  | "malicious_link"
  | "personal_info"
  | "excessive_links"
  | "repeated_content"
  | "gibberish"
  | "sensitive_review";

export type OpenAIModerationReasonCode =
  | `openai_flagged_${string}`
  | "openai_provider_error_review"
  | "openai_provider_error_reject"
  | "openai_provider_error_local_only"
  | "openai_video_thumbnail_missing_review";

export type ModerationReasonCode = LocalModerationReasonCode | OpenAIModerationReasonCode;

export type ModerationContentType =
  | "post_title"
  | "post_body"
  | "comment_body"
  | "profile_text"
  | "circle_name"
  | "circle_description";

export type ModerationProviderName =
  | "local"
  | "mock"
  | "openai"
  | "local+openai"
  | "manual-admin"
  | "tencent-disabled";

export type ModerationFailMode = "review" | "reject" | "allow" | "local_only";

export type ModerationProviderTargetType =
  | "post_text"
  | "post_image"
  | "post_video_metadata"
  | "comment_text"
  | "circle_text"
  | "circle_cover_image"
  | "profile_text"
  | "profile_avatar_image"
  | "profile_banner_image";

export interface ModerationProviderInput {
  targetType: ModerationProviderTargetType;
  title?: string;
  body?: string;
  description?: string;
  imageUrls?: string[];
  localeHint?: string;
  metadata?: Record<string, unknown>;
}

export interface ModerationLocalInput {
  contentType: ModerationContentType;
  text: string;
  links?: string[];
  metadata?: Record<string, unknown>;
}

export interface ModerationInput {
  contentType: ModerationContentType;
  userId: string | null;
  text: string;
  links?: string[];
  metadata?: Record<string, unknown>;
  localInputs?: ModerationLocalInput[];
  providerInput?: ModerationProviderInput;
}

export interface OpenAIModerationResult {
  provider: "openai";
  decision: "allow" | "review" | "reject" | "error";
  reasonCode: string;
  flagged: boolean;
  categories?: string[];
  scoresSummary?: Record<string, "low" | "medium" | "high">;
}

export interface ModerationResult {
  decision: ModerationDecision;
  reason: ModerationReasonCode | null;
  score: number;
  matchedRules: string[];
  provider: ModerationProviderName;
  providerDetails?: {
    categories?: string[];
    scoresSummary?: Record<string, "low" | "medium" | "high">;
    providerError?: string | null;
  };
}

