import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createDefaultUserSafetyState,
  validateFutureIsoTimestamp,
} from "../src/lib/server/user-safety.server.ts";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.resolve(root, relativePath), "utf8");
}

async function main() {
  const defaultState = createDefaultUserSafetyState("00000000-0000-0000-0000-000000000001");
  assert.equal(defaultState.status, "active");
  assert.equal(defaultState.effective_status, "active");
  assert.equal(defaultState.warning_count, 0);

  const future = new Date(Date.now() + 60_000).toISOString();
  const futureResult = validateFutureIsoTimestamp(future);
  assert.equal(futureResult.ok, true);

  const past = new Date(Date.now() - 60_000).toISOString();
  const pastResult = validateFutureIsoTimestamp(past);
  assert.equal(pastResult.ok, false);

  const postsApi = await read("src/pages/api/forum/posts.ts");
  const commentsApi = await read("src/pages/api/forum/comments.ts");
  const circlesApi = await read("src/pages/api/forum/circles.ts");
  const circleManageApi = await read("src/pages/api/forum/circles/[slug]/manage.ts");
  const postMediaApi = await read("src/pages/api/forum/post-media.ts");
  const uploadGuardApi = await read("src/pages/api/forum/media-upload-guard.ts");
  const externalVideoApi = await read("src/pages/api/forum/external-video-upload.ts");
  const profileApi = await read("src/pages/api/users/me/profile.ts");
  const usersApi = await read("src/pages/api/admin/users.ts");
  const safetyHelper = await read("src/lib/server/user-safety.server.ts");

  assert(/assertUserCanWrite/.test(postsApi), "posts API should enforce user safety");
  assert(/assertUserCanWrite/.test(commentsApi), "comments API should enforce user safety on create");
  assert(/assertUserCanWrite/.test(circlesApi), "circles API should enforce user safety");
  assert(/assertUserCanWrite/.test(circleManageApi), "circle manage API should enforce user safety");
  assert(/assertUserCanWrite/.test(postMediaApi), "post media API should enforce user safety");
  assert(/assertUserCanWrite/.test(uploadGuardApi), "media upload guard should enforce user safety");
  assert(/assertUserCanWrite/.test(externalVideoApi), "external video upload should enforce user safety");
  assert(/assertUserCanWrite/.test(profileApi), "profile update should enforce user safety");

  assert(/USER_BANNED/.test(safetyHelper), "user safety helper should expose USER_BANNED");
  assert(/USER_SUSPENDED/.test(safetyHelper), "user safety helper should expose USER_SUSPENDED");
  assert(/USER_SAFETY_SELF_ACTION_FORBIDDEN/.test(safetyHelper), "self-ban should be forbidden");

  assert(!/email/i.test(usersApi), "admin users list must not expose email");

  const warnApi = await read("src/pages/api/admin/users/[id]/warn.ts");
  const suspendApi = await read("src/pages/api/admin/users/[id]/suspend.ts");
  const banApi = await read("src/pages/api/admin/users/[id]/ban.ts");
  const unbanApi = await read("src/pages/api/admin/users/[id]/unban.ts");
  assert(/REASON_REQUIRED/.test(warnApi), "warn route should require reason");
  assert(/REASON_REQUIRED/.test(suspendApi), "suspend route should require reason");
  assert(/REASON_REQUIRED/.test(banApi), "ban route should require reason");
  assert(/applyUserSafetyAction/.test(unbanApi), "unban route should exist");

  console.log("USER SAFETY TEST PASSED");
}

main().catch((error) => {
  console.error("USER SAFETY TEST FAILED");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
