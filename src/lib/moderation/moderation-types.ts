export type ModerationDecision = "allow" | "review" | "reject";

export type ModerationReasonCode =
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

export type ModerationContentType = "post_title" | "post_body" | "comment_body" | "profile_text";

export type ModerationProviderName = "local" | "mock" | "tencent-disabled";

export type ModerationFailMode = "review" | "reject" | "allow";

export interface ModerationInput {
  contentType: ModerationContentType;
  userId: string | null;
  text: string;
  links?: string[];
  metadata?: Record<string, unknown>;
}

export interface ModerationResult {
  decision: ModerationDecision;
  reason: ModerationReasonCode | null;
  score: number;
  matchedRules: string[];
  provider: ModerationProviderName;
}

