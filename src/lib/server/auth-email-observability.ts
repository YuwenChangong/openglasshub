export type AuthEmailEvent = {
  flow: "RESEND";
  stage: "provider";
  outcome: "accepted" | "rate_limited" | "rejected" | "unavailable";
  durationMs: number;
};

export function classifyAuthEmailFailure(error: unknown): AuthEmailEvent["outcome"] {
  if (typeof error !== "object" || error === null || !("status" in error)) return "unavailable";
  const status = error.status;
  if (status === 429) return "rate_limited";
  if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status < 500) return "rejected";
  return "unavailable";
}
