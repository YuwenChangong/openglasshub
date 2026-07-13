import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function main() {
  const source = await fs.readFile(path.join(root, "src/pages/api/forum/media-upload-guard.ts"), "utf8");
  const attemptsPolicy = await fs.readFile(path.join(root, "supabase/migrations/20260531_forum_phase6_upload_guardrails.sql"), "utf8");
  const postMediaPolicy = await fs.readFile(path.join(root, "supabase/migrations/20260524_forum_phase3_post_media.sql"), "utf8");

  const bearer = source.indexOf("const token = getBearerToken(request);");
  const authenticatedActor = source.indexOf("await supabase.auth.getUser(token)");
  const payload = source.indexOf("const payload = (await request.json()");
  const safety = source.indexOf("await assertUserCanWrite");
  const turnstile = source.indexOf("await validateTurnstileToken");
  const rate = source.indexOf("await enforceUploadRateLimit");
  assert(bearer >= 0 && bearer < authenticatedActor && authenticatedActor < payload);
  assert(payload < safety && safety < turnstile && turnstile < rate);
  assert(/\{ upload_kind\?: string; size_bytes\?: number; turnstile_token\?: string \}/.test(source));
  assert(!/post_id|circle_id|media_id|user_id|author_id|owner_id|upload_url|storage_path|signR2PutUrl|buildTmpVideoKey/.test(source));
  assert(/return json\(\{ ok: true \}\);/.test(source));
  assert(/purpose: "post_media_upload"/.test(source));
  assert(/with check \(user_id = auth\.uid\(\) or user_id is null\);/.test(attemptsPolicy));
  assert(/create policy "post_media_insert_self"[\s\S]*?user_id = auth\.uid\(\)[\s\S]*?p\.author_id = auth\.uid\(\)/.test(postMediaPolicy));

  console.log(JSON.stringify({
    guardScope: "verified-user-and-upload-purpose-only",
    returnsUploadCredential: false,
    targetIdentifierAccepted: false,
    firstExternalEffect: "validateTurnstileToken when required",
    firstPersistentEffect: "enforceUploadRateLimit forum_upload_attempts insert when under limit",
    directMediaMutation: false,
    ssrfCapablePath: false,
  }));
}

await main();
