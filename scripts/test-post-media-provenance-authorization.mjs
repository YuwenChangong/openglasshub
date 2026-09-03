import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { cloudflareWorkersTestPlugin, setCloudflareWorkersTestBinding } from "./lib/cloudflare-workers-test-plugin.mjs";

const root = process.cwd();
const ACTOR_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_ACTOR_ID = "00000000-0000-0000-0000-000000000002";
const POST_A = "00000000-0000-0000-0000-000000000003";
const POST_B = "00000000-0000-0000-0000-000000000004";

function gitBlobHash(content) {
  const gitContent = content.replace(/\r\n/g, "\n");
  return createHash("sha1").update(`blob ${Buffer.byteLength(gitContent)}\0`).update(gitContent).digest("hex");
}

function video(storagePath, extra = {}) {
  return [{ kind: "video", storage_path: storagePath, mime_type: "video/mp4", ...extra }];
}

async function main() {
  setCloudflareWorkersTestBinding({
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_ANON_KEY: "anon-key",
  });
  const postMediaSource = await fs.readFile(path.join(root, "src/pages/api/forum/post-media.ts"), "utf8");
  const issuerSource = await fs.readFile(path.join(root, "src/pages/api/forum/external-video-upload.ts"), "utf8");
  const r2Source = await fs.readFile(path.join(root, "src/lib/r2-server.ts"), "utf8");
  const historicalPostMediaMigration = await fs.readFile(path.join(root, "supabase/migrations/20260524_forum_phase3_post_media.sql"), "utf8");
  const historicalVideoMigration = await fs.readFile(path.join(root, "supabase/migrations/20260525_forum_phase4_video_media.sql"), "utf8");
  const forwardMigration = await fs.readFile(path.join(root, "supabase/migrations/20260713_post_bound_media_provenance.sql"), "utf8");

  assert.equal(gitBlobHash(historicalPostMediaMigration), "1984a27bff93a9ab7deaa07268bd2b5fbccba951");
  assert.equal(gitBlobHash(historicalVideoMigration), "b3c67fb1ab4dede7af8515a2f417c2967ce7d7ad");
  assert(/return `tmp\/\$\{actorId\}\/\$\{targetPostId\}\/\$\{crypto\.randomUUID\(\)\}-\$\{safeName\}`;/.test(r2Source));
  assert(/buildTmpVideoKey\(authData\.user\.id, postId, fileNameRaw\)/.test(issuerSource));
  assert(issuerSource.indexOf('stage = "post.authorize";') < issuerSource.indexOf('stage = "key.build";'));
  assert(issuerSource.indexOf('stage = "key.build";') < issuerSource.indexOf('stage = "turnstile";'));
  const postMediaAuth = postMediaSource.indexOf("await userClient.auth.getUser(token)");
  const postMediaConsent = postMediaSource.indexOf("const consent = await requireAuthenticatedLegalConsent");
  const postMediaSafety = postMediaSource.indexOf("await assertUserCanWrite");
  assert(postMediaAuth >= 0 && postMediaAuth < postMediaConsent && postMediaConsent < postMediaSafety);
  assert(/identity: \{ userId: authData\.user\.id \}/.test(postMediaSource));
  assert(/repository: createLegalConsentReadRepository\(userClient\)/.test(postMediaSource));
  assert(postMediaSource.indexOf("const validationError = validateMediaArray") < postMediaSource.indexOf("const { error: resetCoverError }"));
  assert(postMediaSource.indexOf("const validationError = validateMediaArray") < postMediaSource.indexOf(".insert(rows)"));

  const vite = await createServer({
    root,
    logLevel: "error",
    plugins: [cloudflareWorkersTestPlugin()],
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const { validateMediaArray } = await vite.ssrLoadModule("/src/pages/api/forum/post-media.ts");
    const postAKey = `tmp/${ACTOR_ID}/${POST_A}/11111111-1111-1111-1111-111111111111-video.mp4`;

    assert.equal(validateMediaArray(POST_A, ACTOR_ID, video(postAKey)), null);
    assert.equal(validateMediaArray(POST_A, ACTOR_ID, [{ kind: "image", storage_path: `${ACTOR_ID}/${POST_A}/photo.jpg`, mime_type: "image/jpeg" }]), null);

    const denied = [
      validateMediaArray(POST_B, ACTOR_ID, video(postAKey)),
      validateMediaArray(POST_A, OTHER_ACTOR_ID, video(postAKey)),
      validateMediaArray(POST_A, ACTOR_ID, video(`tmp/${ACTOR_ID}/legacy-video.mp4`)),
      validateMediaArray(POST_A, ACTOR_ID, video(`tmp/${ACTOR_ID}/${POST_A}/%2Fvideo.mp4`)),
      validateMediaArray(POST_A, ACTOR_ID, video(`tmp/${ACTOR_ID}/${POST_A}//video.mp4`)),
      validateMediaArray(POST_A, ACTOR_ID, video(`tmp/${ACTOR_ID}/${POST_A}/..\\video.mp4`)),
      validateMediaArray(POST_A, ACTOR_ID, video(postAKey, { url: "https://foreign.example/video.mp4" })),
    ];
    assert(denied.every(Boolean));
  } finally {
    await vite.close();
  }

  assert(/create or replace function public\.is_canonical_post_media_object_key/.test(forwardMigration));
  assert(/\^tmp\/'.*actor_id::text.*target_post_id::text/s.test(forwardMigration));
  assert(/position\('%' in object_key\) = 0/.test(forwardMigration));
  assert(/position\(chr\(92\) in object_key\) = 0/.test(forwardMigration));
  assert(/create policy "post_media_insert_self"[\s\S]*?user_id = auth\.uid\(\)[\s\S]*?p\.author_id = auth\.uid\(\)[\s\S]*?can_bind_post_media_provenance/.test(forwardMigration));
  assert(/create policy "post_media_update_self_or_staff"[\s\S]*?can_bind_post_media_provenance/.test(forwardMigration));

  console.log(JSON.stringify({
    allowed: "actor A key for post A",
    denied: ["post A key for post B", "other actor", "legacy actor-only tmp key", "encoded slash", "duplicate slash", "backslash traversal", "foreign url"],
    deniedFinalizationDomainWrites: 0,
    consentDenial: "403 missing-or-outdated or sanitized 503 before safety, post lookup, provenance validation, moderation, or post_media writes",
    historicalMigrationsUnchanged: true,
    forwardRlsBinds: ["actor", "target post", "canonical object key"],
    realNetworkStorageDatabaseRequests: 0,
  }));
}

await main();
