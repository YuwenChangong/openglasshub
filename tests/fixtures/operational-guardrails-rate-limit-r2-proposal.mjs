export const r2Function = {
  identity: "public.consume_forum_rate_limit(uuid, text, text, bigint)",
  name: "consume_forum_rate_limit",
  arguments: [
    ["p_user_id", "uuid"],
    ["p_ip_hash", "text"],
    ["p_purpose", "text"],
    ["p_bytes", "bigint"],
  ],
  returns: "TABLE(allowed boolean, decision text)",
  owner: "postgres",
  security: "SECURITY DEFINER",
  volatility: "VOLATILE",
  parallel: "PARALLEL UNSAFE",
  leakproof: false,
  searchPath: "pg_catalog, public, pg_temp",
  trustedRole: "service_role",
  rejectedRoles: ["PUBLIC", "anon", "authenticated"],
};

export const r2PurposeMatrix = [
  { purpose: "post_create", caller: "src/pages/api/forum/posts.ts#POST", subject: "verified user", bytes: "exactly 0", maximum: 10, windowSeconds: 3600, status: "APPROVED" },
  { purpose: "comment_create", caller: "src/pages/api/forum/comments.ts#POST", subject: "verified user", bytes: "exactly 0", maximum: 60, windowSeconds: 3600, status: "APPROVED" },
  { purpose: "circle_create", caller: "src/pages/api/forum/circles.ts#POST", subject: "verified user", bytes: "exactly 0", maximum: 5, windowSeconds: 86400, status: "APPROVED" },
  { purpose: "post_media_upload", caller: "src/pages/api/forum/media-upload-guard.ts#POST", subject: "shared upload IP", bytes: "nonnegative; generic per-upload cap unresolved", maximum: 10, windowSeconds: 3600, status: "HUMAN_DECISION_REQUIRED" },
  { purpose: "external_video_upload", caller: "src/pages/api/forum/external-video-upload.ts#POST", subject: "shared upload IP", bytes: "1..157286400; separate 300 MiB daily cross-table quota unresolved", maximum: 10, windowSeconds: 3600, status: "HUMAN_DECISION_REQUIRED" },
  { purpose: "verification_email_resend", caller: "src/pages/api/auth/resend-confirmation.ts#POST", subject: "shared IP", bytes: "exactly 0", maximum: 5, windowSeconds: 86400, status: "SOURCE_PROVEN_SEPARATE_RPC" },
];

export const r2ExecutionStatus = {
  r2StaticDesign: "COMPLETE_BUT_NOT_EXECUTABLE",
  r3Eligible: false,
  stageC: "BLOCKED_RUNTIME_MIGRATION_REQUIRED",
  productionIdentity: "BINDING_ABSENT_PRODUCTION_BLOCKED",
  unresolvedDecisions: [
    "post_media_upload_generic_byte_cap",
    "external_video_upload_daily_cross_table_quota",
    "duplicate_request_idempotency",
    "lock_and_statement_timeout",
    "production_function_owner_confirmation",
  ],
};

export const negativeFixtureNames = [
  "missing-public-revoke",
  "anon-grant",
  "authenticated-grant",
  "public-grant",
  "unsafe-search-path",
  "unqualified-table",
  "security-invoker",
  "unexpected-owner",
  "wrong-signature",
  "overload-ambiguity",
  "guessed-post-media-cap",
  "todo-quota",
  "non-atomic-count-insert",
  "session-advisory-lock",
  "inconsistent-lock-order",
  "leaking-result",
];
