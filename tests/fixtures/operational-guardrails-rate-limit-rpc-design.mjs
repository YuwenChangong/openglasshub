export const trustedIdentity = {
  classification: "SERVICE_ROLE_CONFIGURATION_PARTIALLY_READY",
  previewBindingStatus: "PREVIEW_SERVICE_ROLE_BINDING_READY",
  productionBindingStatus: "BINDING_ABSENT_PRODUCTION_BLOCKED",
  proofEvidence: "operator-held-metadata-only-outside-git",
  sourceServiceRoleFactories: [
    "src/lib/server/legal-consent-repository.server.ts#createLegalConsentServiceClient",
    "src/lib/server/moderation-notifications.server.ts#createModerationNotificationServiceClient",
  ],
  activeRateLimitServiceRoleCaller: null,
  declaredRuntimeBindings: ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
  missingDocumentedBinding: "SUPABASE_SERVICE_ROLE_KEY",
  conclusion:
    "The approved metadata-only Preview proof records one encrypted SUPABASE_SERVICE_ROLE_KEY binding with no conflict, but local configuration remains unproven and Production remains binding-absent. No current rate-limit caller uses the key, so the server-only rate-limit boundary remains unimplemented.",
};

export const rateLimitRpcContract = {
  schema: "public",
  functionName: "consume_forum_rate_limit",
  signature: [
    ["p_user_id", "uuid"],
    ["p_ip_hash", "text"],
    ["p_purpose", "text"],
    ["p_bytes", "bigint"],
  ],
  returns: [
    ["allowed", "boolean"],
    ["decision", "text"],
  ],
  resultPairs: [
    [true, "ALLOWED"],
    [false, "RATE_LIMITED"],
  ],
  purposes: {
    post_create: { scope: "user", maxAttempts: 10, windowSeconds: 3600, bytes: "zero" },
    comment_create: { scope: "user", maxAttempts: 60, windowSeconds: 3600, bytes: "zero" },
    circle_create: { scope: "user", maxAttempts: 5, windowSeconds: 86400, bytes: "zero" },
    post_media_upload: { scope: "shared_upload_ip", maxAttempts: 10, windowSeconds: 3600, bytes: "1..157286400" },
    external_video_upload: { scope: "shared_upload_ip", maxAttempts: 10, windowSeconds: 3600, bytes: "1..157286400", dailyByteMaximum: 314572800, dailyWindowSeconds: 86400 },
  },
  requiredIdentity: "both_user_uuid_and_sha256_ip_hash",
  rejected: ["verification_email_resend", "null_user_id", "blank_ip_hash", "invalid_ip_hash", "negative_bytes", "unknown_purpose"],
  timestampAuthority: "database_clock",
  concurrency: "transaction_scoped_advisory_lock_per_fixed_scope",
  security: {
    mode: "SECURITY DEFINER",
    proposedOwner: "postgres_pending_production_approval",
    searchPath: "pg_catalog, public, pg_temp",
    publicExecute: false,
    anonExecute: false,
    authenticatedExecute: false,
    serviceRoleExecute: "pending_trusted_identity_configuration_and_approval",
    volatility: "VOLATILE",
    parallel: "UNSAFE",
    leakproof: false,
  },
  r2Status: "COMPLETE_STATICALLY_VALID",
  r3Eligible: true,
  timeoutContract: { lockTimeout: "1s", statementTimeout: "3s", runtimeDeadlineMs: 4000 },
  retryPolicy: "NO_AUTOMATIC_RETRY",
  idempotencyPolicy: "NO_V1_IDEMPOTENCY_GUARANTEE",
  unresolvedDecisions: ["trusted_server_identity_deployment_binding", "production_function_owner_confirmation"],
};

export const rateLimitRouteInventory = [
  { route: "src/pages/api/forum/posts.ts#POST", purpose: "post_create", identity: "user+ip", bytes: 0, failure: "fails_open", denyStatus: 429, errorStatus: 503 },
  { route: "src/pages/api/forum/comments.ts#POST", purpose: "comment_create", identity: "user+ip", bytes: 0, failure: "fails_open", denyStatus: 429, errorStatus: 503 },
  { route: "src/pages/api/forum/circles.ts#POST", purpose: "circle_create", identity: "user+ip", bytes: 0, failure: "fails_open", denyStatus: 429, errorStatus: 503 },
  { route: "src/pages/api/forum/media-upload-guard.ts#POST", purpose: "post_media_upload", identity: "user+ip", bytes: "request.size_bytes", failure: "fails_open", denyStatus: 429, errorStatus: 503 },
  { route: "src/pages/api/forum/external-video-upload.ts#POST", purpose: "external_video_upload", identity: "user+ip", bytes: "request.size_bytes", failure: "fails_open_and_daily_attempt_bytes_zero", denyStatus: 429, errorStatus: 503 },
];

export const implementationStages = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"];
