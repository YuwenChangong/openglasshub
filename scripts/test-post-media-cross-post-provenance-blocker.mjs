import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function main() {
  const postMedia = await fs.readFile(path.join(root, "src/pages/api/forum/post-media.ts"), "utf8");
  const uploadIssuer = await fs.readFile(path.join(root, "src/pages/api/forum/external-video-upload.ts"), "utf8");
  const r2 = await fs.readFile(path.join(root, "src/lib/r2-server.ts"), "utf8");
  const policies = await fs.readFile(path.join(root, "supabase/migrations/20260524_forum_phase3_post_media.sql"), "utf8");

  const issuerLookup = uploadIssuer.indexOf('stage = "post.lookup"');
  const issuerAuthorization = uploadIssuer.indexOf('stage = "post.authorize"');
  const issuerKey = uploadIssuer.indexOf("buildTmpVideoKey(authData.user.id, fileNameRaw)");
  assert(issuerLookup >= 0 && issuerLookup < issuerAuthorization && issuerAuthorization < issuerKey);
  assert(/return `tmp\/\$\{userId\}\/\$\{crypto\.randomUUID\(\)\}-\$\{safeName\}`;/.test(r2));

  const temporaryPathCheck = postMedia.indexOf("const isUserTempPath = storagePath.startsWith(`tmp/${userId}/`);");
  const targetPostCheck = postMedia.indexOf("const isUserPostPath = storagePath.startsWith(`${userId}/${postId}/`);");
  const temporaryAcceptance = postMedia.indexOf("if (!isUserPostPath && !isUserTempPath)");
  assert(targetPostCheck >= 0 && temporaryPathCheck > targetPostCheck && temporaryAcceptance > temporaryPathCheck);
  assert(!postMedia.slice(temporaryPathCheck, temporaryAcceptance).includes("postId"));

  const insertPolicy = policies.match(/create policy "post_media_insert_self"[\s\S]*?\n\);/);
  assert(insertPolicy);
  assert(/user_id = auth\.uid\(\)/.test(insertPolicy[0]));
  assert(/p\.author_id = auth\.uid\(\)/.test(insertPolicy[0]));
  assert(!/storage_path|tmp\/|upload_session|nonce|provenance/i.test(insertPolicy[0]));
  const storageInsertPolicy = policies.match(/create policy "post_media_objects_insert_self"[\s\S]*?\n\);/);
  assert(storageInsertPolicy);
  assert(/owner = auth\.uid\(\)/.test(storageInsertPolicy[0]));
  assert(/name like auth\.uid\(\)::text \|\| '\/%'/.test(storageInsertPolicy[0]));
  assert(!/post_id|upload_session|nonce|provenance/i.test(storageInsertPolicy[0]));

  console.log(JSON.stringify({
    uploadKey: "tmp/<actor-id>/<uuid>-<normalized-file-name>",
    uploadAuthorizationContext: "selected owned post",
    attachAcceptance: "same actor tmp prefix without original post binding",
    rlsBinding: "actor and target post ownership only",
    replay: "post A to owned post B possible",
    runtimeRemediationRequired: true,
    forwardRlsRemediationRequired: true,
  }));
}

await main();
