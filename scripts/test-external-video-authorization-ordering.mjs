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
} = {}) {
  const calls = [];
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
          return Promise.resolve({ data: post, error: null });
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
      return "https://r2.example/upload";
    },
    getRequestIp() {
      return "127.0.0.1";
    },
    async enforceUploadRateLimit() {
      effects.rateAttemptInsert += 1;
      calls.push("rate-attempt insert");
      return { allowed: true, backendAvailable: true };
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
  });

  const headers = authenticated ? { authorization: "Bearer test-token" } : {};
  const request = new Request("https://local.test/api/forum/external-video-upload", {
    method: "POST",
    headers,
    body: JSON.stringify({
      post_id: malformedPostId ? "not-a-uuid" : POST_ID,
      file_name: "test.mp4",
      mime_type: "video/mp4",
      size_bytes: 1024,
      turnstile_token: "offline-token",
    }),
  });
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

  return { response, calls, effects };
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
  const postLookup = source.indexOf('stage = "post.lookup";');
  const ownershipComparison = source.indexOf("if (post.author_id !== authData.user.id)");
  const keyBuild = source.indexOf("const objectKey = buildTmpVideoKey(authData.user.id, postId, fileNameRaw);");
  const turnstile = source.indexOf('stage = "turnstile";');
  const rateReads = source.indexOf('stage = "rate.ip";');
  const r2Signing = source.indexOf('stage = "r2.sign";');
  const rateAttemptInsert = source.indexOf('stage = "attempt.insert";');
  assert(postIdValidation >= 0 && postIdValidation < postLookup);
  assert(postLookup < ownershipComparison && ownershipComparison < keyBuild && keyBuild < turnstile);
  assert(turnstile < rateReads && rateReads < r2Signing && r2Signing < rateAttemptInsert);
  assert(/create policy "posts_select_published_public"[\s\S]*?status = 'published'[\s\S]*?or author_id = auth\.uid\(\)[\s\S]*?or \(select public\.is_moderator_or_admin\(\)\)/.test(deployedPostSelectPolicy));
  assert(/create policy "posts_select_published_public"[\s\S]*?moderation_status = 'published'[\s\S]*?public\.can_access_public_circle\(circle_id\)[\s\S]*?or author_id = auth\.uid\(\)/.test(authoredPostSelectPolicy));

  const missing = await runScenario({ postAuthorId: null });
  assert.equal(missing.response.status, 404);
  assert.deepEqual(missing.calls, ["authenticate", "safety authorization", "post lookup"]);
  assertNoLaterEffects(missing);

  const wrongOwner = await runScenario({ postAuthorId: OTHER_USER_ID });
  assert.equal(wrongOwner.response.status, 403);
  assert.deepEqual(wrongOwner.calls, ["authenticate", "safety authorization", "post lookup", "ownership comparison"]);
  assertNoLaterEffects(wrongOwner);

  const malformed = await runScenario({ malformedPostId: true });
  assert.equal(malformed.response.status, 400);
  assert.deepEqual(malformed.calls, ["authenticate", "safety authorization"]);
  assertNoLaterEffects(malformed);

  const unauthenticated = await runScenario({ authenticated: false });
  assert.equal(unauthenticated.response.status, 401);
  assert.deepEqual(unauthenticated.calls, []);
  assertNoLaterEffects(unauthenticated);

  const safetyDenied = await runScenario({ safetyAllowed: false });
  assert.equal(safetyDenied.response.status, 403);
  assert.deepEqual(safetyDenied.calls, ["authenticate", "safety authorization"]);
  assertNoLaterEffects(safetyDenied);

  const invalidTurnstile = await runScenario({ turnstileResult: { ok: false, code: "TURNSTILE_INVALID" } });
  assert.equal(invalidTurnstile.response.status, 400);
  assert.deepEqual(invalidTurnstile.calls, [
    "authenticate",
    "safety authorization",
    "post lookup",
    "ownership comparison",
    "post-bound key generation",
    "Turnstile validation",
  ]);
  assert.equal(invalidTurnstile.effects.rateAttemptInsert, 0);
  assert.equal(invalidTurnstile.effects.r2Signing, 0);
  assert.equal(invalidTurnstile.effects.directMutation, 0);

  const owner = await runScenario();
  assert.equal(owner.response.status, 200);
  assert.deepEqual(owner.calls, [
    "authenticate",
    "safety authorization",
    "post lookup",
    "ownership comparison",
    "post-bound key generation",
    "Turnstile validation",
    "daily-rate hash",
    "daily-rate attempt read",
    "daily-rate media read",
    "r2 URL signing",
    "rate-attempt insert",
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
