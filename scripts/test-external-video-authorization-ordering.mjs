import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const root = process.cwd();
const ACTOR_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_USER_ID = "00000000-0000-0000-0000-000000000002";
const POST_ID = "00000000-0000-0000-0000-000000000003";

let createExternalVideoUploadPost;

function makePost(authorId, calls) {
  if (authorId === null) return null;

  const post = { id: POST_ID };
  Object.defineProperty(post, "author_id", {
    enumerable: true,
    get() {
      calls.push("ownership comparison");
      return authorId;
    },
  });
  return post;
}

async function runScenario({
  authenticated = true,
  safetyAllowed = true,
  postAuthorId = ACTOR_ID,
  turnstileRequired = true,
  turnstileResult = { ok: true },
  malformedPostId = false,
  consentOutcome = "current",
  postLookupError = null,
  signingError = null,
  rateLimitResult = { allowed: true, backendAvailable: true },
  mimeType = "video/mp4",
  sizeBytes = 1024,
} = {}) {
  const calls = [];
  const logs = [];
  const effects = {
    turnstile: 0,
    cloudflareFetch: 0,
    rateAttemptInsert: 0,
    r2Signing: 0,
    directMutation: 0,
    keyBuild: 0,
  };
  const post = makePost(postAuthorId, calls);

  const client = {
    auth: {
      async getUser() {
        calls.push("authenticate");
        return authenticated
          ? { data: { user: { id: ACTOR_ID } }, error: null }
          : { data: { user: null }, error: { message: "invalid" } };
      },
    },
    from(table) {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        gte() {
          if (table === "forum_upload_attempts") calls.push("daily-rate attempt read");
          if (table === "post_media") calls.push("daily-rate media read");
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle() {
          calls.push("post lookup");
          return Promise.resolve({ data: post, error: postLookupError });
        },
        insert() {
          effects.directMutation += 1;
          throw new Error("Direct route mutation is not expected");
        },
        update() {
          effects.directMutation += 1;
          throw new Error("Direct route mutation is not expected");
        },
        delete() {
          effects.directMutation += 1;
          throw new Error("Direct route mutation is not expected");
        },
      };
      return builder;
    },
  };

  const handler = createExternalVideoUploadPost({
    createClient() {
      return client;
    },
    buildR2PublicUrl() {
      return "https://r2.example/media";
    },
    buildTmpVideoKey(actorId, postId) {
      effects.keyBuild += 1;
      calls.push("post-bound key generation");
      return `tmp/${actorId}/${postId}/test.mp4`;
    },
    async signR2PutUrl() {
      effects.r2Signing += 1;
      calls.push("r2 URL signing");
      if (signingError) throw signingError;
      return "https://r2.example/upload";
    },
    getRequestIp() {
      return "127.0.0.1";
    },
    async enforceUploadRateLimit() {
      effects.rateAttemptInsert += 1;
      calls.push("rate-attempt insert");
      return rateLimitResult;
    },
    async hashRateLimitIp() {
      calls.push("daily-rate hash");
      return "rate-hash";
    },
    shouldRequireUploadTurnstile() {
      return turnstileRequired;
    },
    async validateTurnstileToken() {
      effects.turnstile += 1;
      effects.cloudflareFetch += 1;
      calls.push("Turnstile validation");
      return turnstileResult;
    },
    async assertUserCanWrite() {
      calls.push("safety authorization");
      return safetyAllowed
        ? { allowed: true, state: {} }
        : { allowed: false, code: "USER_BANNED", status: 403, message: "blocked" };
    },
    getSafetyWriteBlockResponse() {
      return new Response(JSON.stringify({ error: "USER_BANNED" }), { status: 403 });
    },
    createLegalConsentReadRepository() {
      calls.push("consent repository");
      return {};
    },
    async requireAuthenticatedLegalConsent({ identity }) {
      calls.push(`consent guard:${identity.userId}`);
      if (consentOutcome === "current") return { ok: true, userId: ACTOR_ID };
      return {
        ok: false,
        response: new Response(JSON.stringify(consentOutcome === "failure"
          ? { error: "LEGAL_CONSENT_UNAVAILABLE" }
          : { error: "LEGAL_CONSENT_REQUIRED", consentUrl: "/legal-consent/" }), { status: consentOutcome === "failure" ? 503 : 403 }),
      };
    },
  });

  const headers = authenticated ? { authorization: "Bearer test-token" } : {};
  const request = new Request("https://local.test/api/forum/external-video-upload", {
    method: "POST",
    headers,
    body: JSON.stringify({
      post_id: malformedPostId ? "not-a-uuid" : POST_ID,
      file_name: "test.mp4",
      mime_type: mimeType,
      size_bytes: sizeBytes,
      turnstile_token: "offline-token",
    }),
  });
  const originalWarn = console.warn;
  console.warn = (...args) => logs.push(args);
  try {
    const response = await handler({
      request,
      locals: {
        runtime: {
          env: {
            SUPABASE_URL: "https://supabase.example",
            SUPABASE_ANON_KEY: "anon-key",
            RATE_LIMIT_SALT: "rate-salt",
          },
        },
      },
    });
    return { response, calls, effects, logs };
  } finally {
    console.warn = originalWarn;
  }
}

function assertNoLaterEffects(result) {
  assert.equal(result.effects.turnstile, 0);
  assert.equal(result.effects.cloudflareFetch, 0);
  assert.equal(result.effects.rateAttemptInsert, 0);
  assert.equal(result.effects.r2Signing, 0);
  assert.equal(result.effects.directMutation, 0);
  assert.equal(result.effects.keyBuild, 0);
  assert(!result.calls.some((call) => call.startsWith("daily-rate")));
}

function assertSanitizedFailure(result, expectedStatus, markers) {
  assert.equal(result.response.status, expectedStatus);
  return result.response.json().then((body) => {
    const serialized = JSON.stringify(body);
    assert.equal(body.error, "EXTERNAL_VIDEO_UPLOAD_FAILED");
    for (const marker of markers) assert.doesNotMatch(serialized, new RegExp(marker));
    assert.doesNotMatch(serialized, /stage|stack|details|hint|service.?role/i);
    assert.equal(JSON.stringify(result.logs).includes(markers.join("")), false);
    for (const marker of markers) assert.equal(JSON.stringify(result.logs).includes(marker), false);
  });
}

async function main() {
  const vite = await createServer({
    root,
    logLevel: "error",
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    ({ createExternalVideoUploadPost } = await vite.ssrLoadModule("/src/pages/api/forum/external-video-upload.ts"));
  const source = await fs.readFile(path.join(root, "src/pages/api/forum/external-video-upload.ts"), "utf8");
  const deployedPostSelectPolicy = await fs.readFile(path.join(root, "supabase/migrations/20260611_forum_permission_lockdown.sql"), "utf8");
  const authoredPostSelectPolicy = await fs.readFile(path.join(root, "supabase/migrations/20260713_comment_read_circle_visibility_authorization.sql"), "utf8");
  const postIdValidation = source.indexOf("if (!postId || !/^[0-9a-f-]{36}$/i.test(postId))");
  const consent = source.indexOf("const consent = await requireAuthenticatedLegalConsent");
  const postLookup = source.indexOf('stage = "post.lookup";');
  const ownershipComparison = source.indexOf("if (post.author_id !== authData.user.id)");
  const keyBuild = source.indexOf("const objectKey = buildTmpVideoKey(authData.user.id, postId, fileNameRaw);");
  const turnstile = source.indexOf('stage = "turnstile";');
  const rateReads = source.indexOf('stage = "rate.ip";');
  const r2Signing = source.indexOf('stage = "r2.sign";');
  const rateConsume = source.indexOf('stage = "rate.consume";');
  assert(consent >= 0 && consent < postIdValidation && postIdValidation < postLookup);
  assert(postLookup < ownershipComparison && ownershipComparison < keyBuild && keyBuild < turnstile);
  assert(turnstile < rateReads && rateReads < rateConsume && rateConsume < r2Signing);
  assert.doesNotMatch(source, /forum_upload_attempts/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|createServiceClient|service_role/);
  assert.doesNotMatch(source, /formatDbError|error\.message|error\.details|error\.hint|\[\$\{stage\}\]/);
  assert.match(source, /function unavailableResponse\(\)/);
  assert.match(source, /function logUnavailableFailure\(stage: string, quotaReserved: boolean\)/);
  assert.doesNotMatch(source, /console\.warn\([^\n]*error/);
  assert(/create policy "posts_select_published_public"[\s\S]*?status = 'published'[\s\S]*?or author_id = auth\.uid\(\)[\s\S]*?or \(select public\.is_moderator_or_admin\(\)\)/.test(deployedPostSelectPolicy));
  assert(/create policy "posts_select_published_public"[\s\S]*?moderation_status = 'published'[\s\S]*?public\.can_access_public_circle\(circle_id\)[\s\S]*?or author_id = auth\.uid\(\)/.test(authoredPostSelectPolicy));

  const missing = await runScenario({ postAuthorId: null });
  assert.equal(missing.response.status, 404);
  assert.deepEqual(missing.calls, ["authenticate", "consent repository", `consent guard:${ACTOR_ID}`, "safety authorization", "post lookup"]);
  assertNoLaterEffects(missing);

  const rawMarkers = [
    "R5L_DATABASE_MESSAGE_SENTINEL",
    "R5L_DATABASE_CODE_SENTINEL",
    "R5L_DATABASE_DETAILS_SENTINEL",
    "R5L_DATABASE_HINT_SENTINEL",
    "R5L_DATABASE_STACK_SENTINEL",
    "R5L_DATABASE_NESTED_SENTINEL",
    "r5l-project.supabase.example",
    ACTOR_ID,
    "r5l-ip-hash-sentinel",
    "r5l-signed-upload-sentinel",
    "service_role",
  ];
  const rawDatabaseFailure = await runScenario({
    postLookupError: {
      message: "R5L_DATABASE_MESSAGE_SENTINEL https://r5l-project.supabase.example service_role",
      code: "R5L_DATABASE_CODE_SENTINEL",
      details: `R5L_DATABASE_DETAILS_SENTINEL ${ACTOR_ID} r5l-ip-hash-sentinel`,
      hint: "R5L_DATABASE_HINT_SENTINEL r5l-signed-upload-sentinel",
      stack: "R5L_DATABASE_STACK_SENTINEL",
      nested: { message: "R5L_DATABASE_NESTED_SENTINEL" },
    },
  });
  await assertSanitizedFailure(rawDatabaseFailure, 500, rawMarkers);
  assert.deepEqual(rawDatabaseFailure.calls, [
    "authenticate",
    "consent repository",
    `consent guard:${ACTOR_ID}`,
    "safety authorization",
    "post lookup",
  ]);
  assertNoLaterEffects(rawDatabaseFailure);

  const signingFailure = await runScenario({
    signingError: Object.assign(new Error("R5L_SIGNING_MESSAGE_SENTINEL https://r5l-project.supabase.example"), {
      code: "R5L_SIGNING_CODE_SENTINEL",
      details: "R5L_SIGNING_DETAILS_SENTINEL",
      hint: "R5L_SIGNING_HINT_SENTINEL",
      stack: "R5L_SIGNING_STACK_SENTINEL",
    }),
  });
  await assertSanitizedFailure(signingFailure, 500, [
    "R5L_SIGNING_MESSAGE_SENTINEL",
    "R5L_SIGNING_CODE_SENTINEL",
    "R5L_SIGNING_DETAILS_SENTINEL",
    "R5L_SIGNING_HINT_SENTINEL",
    "R5L_SIGNING_STACK_SENTINEL",
    "r5l-project.supabase.example",
  ]);
  assert.equal(signingFailure.effects.rateAttemptInsert, 1);
  assert.equal(signingFailure.effects.r2Signing, 1);
  assert.equal(signingFailure.effects.directMutation, 0);

  const wrongOwner = await runScenario({ postAuthorId: OTHER_USER_ID });
  assert.equal(wrongOwner.response.status, 403);
  assert.deepEqual(wrongOwner.calls, ["authenticate", "consent repository", `consent guard:${ACTOR_ID}`, "safety authorization", "post lookup", "ownership comparison"]);
  assertNoLaterEffects(wrongOwner);

  const malformed = await runScenario({ malformedPostId: true });
  assert.equal(malformed.response.status, 400);
  assert.deepEqual(malformed.calls, ["authenticate", "consent repository", `consent guard:${ACTOR_ID}`, "safety authorization"]);
  assertNoLaterEffects(malformed);

  const unsupportedType = await runScenario({ mimeType: "application/octet-stream" });
  assert.equal(unsupportedType.response.status, 400);
  assertNoLaterEffects(unsupportedType);

  const oversized = await runScenario({ sizeBytes: 150 * 1024 * 1024 + 1 });
  assert.equal(oversized.response.status, 400);
  assertNoLaterEffects(oversized);

  const unauthenticated = await runScenario({ authenticated: false });
  assert.equal(unauthenticated.response.status, 401);
  assert.deepEqual(unauthenticated.calls, []);
  assertNoLaterEffects(unauthenticated);

  const safetyDenied = await runScenario({ safetyAllowed: false });
  assert.equal(safetyDenied.response.status, 403);
  assert.deepEqual(safetyDenied.calls, ["authenticate", "consent repository", `consent guard:${ACTOR_ID}`, "safety authorization"]);

  for (const consentOutcome of ["missing", "outdated", "failure"]) {
    const denied = await runScenario({ consentOutcome });
    assert.equal(denied.response.status, consentOutcome === "failure" ? 503 : 403);
    assert.deepEqual(await denied.response.json(), consentOutcome === "failure"
      ? { error: "LEGAL_CONSENT_UNAVAILABLE" }
      : { error: "LEGAL_CONSENT_REQUIRED", consentUrl: "/legal-consent/" });
    assert.deepEqual(denied.calls, ["authenticate", "consent repository", `consent guard:${ACTOR_ID}`]);
    assertNoLaterEffects(denied);
  }
  assertNoLaterEffects(safetyDenied);

  const invalidTurnstile = await runScenario({ turnstileResult: { ok: false, code: "TURNSTILE_INVALID" } });
  assert.equal(invalidTurnstile.response.status, 400);
  assert.deepEqual(invalidTurnstile.calls, [
    "authenticate",
    "consent repository",
    `consent guard:${ACTOR_ID}`,
    "safety authorization",
    "post lookup",
    "ownership comparison",
    "post-bound key generation",
    "Turnstile validation",
  ]);
  assert.equal(invalidTurnstile.effects.rateAttemptInsert, 0);
  assert.equal(invalidTurnstile.effects.r2Signing, 0);
  assert.equal(invalidTurnstile.effects.directMutation, 0);

  for (const reason of ["RATE_LIMIT_TIMEOUT", "RATE_LIMIT_MALFORMED_RESULT", "RATE_LIMIT_CONFIGURATION_MISSING", "RATE_LIMIT_SERVICE_UNAVAILABLE"]) {
    const rateUnavailable = await runScenario({ rateLimitResult: { allowed: false, reason } });
    assert.equal(rateUnavailable.response.status, 503);
    assert.deepEqual(await rateUnavailable.response.json(), { error: "Rate limit service temporarily unavailable", code: reason });
    assert.equal(rateUnavailable.effects.r2Signing, 0);
    assert.equal(rateUnavailable.effects.directMutation, 0);
    assert.equal(rateUnavailable.effects.rateAttemptInsert, 1);
  }

  const rateLimited = await runScenario({ rateLimitResult: { allowed: false, reason: "RATE_LIMITED" } });
  assert.equal(rateLimited.response.status, 429);
  assert.deepEqual(await rateLimited.response.json(), { error: "Too many upload attempts from this IP", code: "RATE_LIMITED" });
  assert.equal(rateLimited.effects.r2Signing, 0);
  assert.equal(rateLimited.effects.directMutation, 0);
  assert.equal(rateLimited.effects.rateAttemptInsert, 1);

  const owner = await runScenario();
  assert.equal(owner.response.status, 200);
  assert.deepEqual(owner.calls, [
    "authenticate",
    "consent repository",
    `consent guard:${ACTOR_ID}`,
    "safety authorization",
    "post lookup",
    "ownership comparison",
    "post-bound key generation",
    "Turnstile validation",
    "daily-rate hash",
    "rate-attempt insert",
    "r2 URL signing",
  ]);
  assert.equal(owner.effects.rateAttemptInsert, 1);
  assert.equal(owner.effects.r2Signing, 1);
  assert.equal(owner.effects.directMutation, 0);
  assert.equal(owner.effects.keyBuild, 1);

  const turnstileDisabled = await runScenario({ turnstileRequired: false });
  assert.equal(turnstileDisabled.response.status, 200);
  assert.equal(turnstileDisabled.effects.turnstile, 0);
  assert(turnstileDisabled.calls.indexOf("ownership comparison") < turnstileDisabled.calls.indexOf("daily-rate hash"));
  assert(turnstileDisabled.calls.indexOf("ownership comparison") < turnstileDisabled.calls.indexOf("r2 URL signing"));

  console.log(JSON.stringify({
    missingTargetTurnstileCalls: missing.effects.turnstile,
    wrongOwnerTurnstileCalls: wrongOwner.effects.turnstile,
    invalidTurnstileRateAttemptInserts: invalidTurnstile.effects.rateAttemptInsert,
    consentDenials: [403, 503],
    r5lRawDatabaseErrorExposure: false,
    r5lSanitizedFailureClasses: ["database", "signing", "rate-limit-timeout", "rate-limit-malformed", "rate-limit-configuration", "rate-limit-unavailable"],
    successfulOrder: owner.calls,
    turnstileDisabledOwnershipBeforeLaterProcessing: true,
    deployedPostSelectPolicy: "published-or-own-or-staff",
    authoredPostSelectPolicy: "published-visible-circle-or-own-or-staff",
    realNetworkStorageDatabaseRequests: 0,
  }));
  } finally {
    await vite.close();
  }
}

await main();
