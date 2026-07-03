import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildNotificationHref,
  buildNotificationMessage,
  buildNotificationPreview,
  isSystemNotificationType,
} from "../src/lib/notifications.ts";
import {
  notifyCommentModerated,
  notifyPostModerated,
} from "../src/lib/server/moderation-notifications.server.ts";
import {
  buildLegacyReason,
  normalizeReportPriority,
  normalizeReportStatus,
  parseUserReportPayload,
  sanitizeReportReasonText,
} from "../src/lib/server/reports.server.ts";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.resolve(root, relativePath), "utf8");
}

async function main() {
  const validPayload = parseUserReportPayload({
    target_type: "post",
    target_id: "00000000-0000-0000-0000-000000000001",
    reason_code: "spam",
    reason_text: "这是重复广告内容",
  });
  assert.equal(validPayload.ok, true);

  const invalidType = parseUserReportPayload({
    target_type: "device",
    target_id: "00000000-0000-0000-0000-000000000001",
    reason_code: "spam",
  });
  assert.equal(invalidType.ok, false);

  const invalidReason = parseUserReportPayload({
    target_type: "post",
    target_id: "00000000-0000-0000-0000-000000000001",
    reason_code: "unknown",
  });
  assert.equal(invalidReason.ok, false);

  const invalidTargetId = parseUserReportPayload({
    target_type: "post",
    target_id: "not-a-uuid",
    reason_code: "spam",
  });
  assert.equal(invalidTargetId.ok, false);

  assert.equal(sanitizeReportReasonText("x".repeat(1205)).length, 1000);
  assert.equal(buildLegacyReason("privacy", "泄露手机号"), "隐私泄露：泄露手机号");
  assert.equal(normalizeReportStatus("reviewed"), "actioned");
  assert.equal(normalizeReportPriority("high"), "high");
  assert.equal(normalizeReportPriority("weird"), "normal");
  assert.equal(buildNotificationMessage("post_like", "Alice"), "Alice 赞了你的帖子");
  assert.equal(buildNotificationMessage("post_moderated", "Alice"), "Your post was removed after review.");
  assert.equal(buildNotificationPreview("post_moderated", "should not render"), null);
  assert.equal(buildNotificationHref("post_moderated", "00000000-0000-0000-0000-000000000010", null), "/notifications/");
  assert.equal(isSystemNotificationType("user_restricted"), true);

  const rpcCalls = [];
  const fakeClient = {
    async rpc(name, payload) {
      rpcCalls.push({ name, payload });
      return { error: null };
    },
  };

  assert.equal(await notifyPostModerated({
    client: fakeClient,
    recipientId: "00000000-0000-0000-0000-000000000011",
    postId: "00000000-0000-0000-0000-000000000012",
    actingAdminId: "00000000-0000-0000-0000-000000000013",
  }), true);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "insert_forum_notification");
  assert.equal(rpcCalls[0].payload.p_actor_id, null);
  assert.equal(rpcCalls[0].payload.p_type, "post_moderated");

  assert.equal(await notifyCommentModerated({
    client: fakeClient,
    recipientId: "",
    commentId: "00000000-0000-0000-0000-000000000014",
    postId: "00000000-0000-0000-0000-000000000015",
    actingAdminId: "00000000-0000-0000-0000-000000000016",
  }), false);
  assert.equal(rpcCalls.length, 1);

  assert.equal(await notifyPostModerated({
    client: fakeClient,
    recipientId: "00000000-0000-0000-0000-000000000017",
    postId: "00000000-0000-0000-0000-000000000018",
    actingAdminId: "00000000-0000-0000-0000-000000000017",
  }), false);
  assert.equal(rpcCalls.length, 1);

  const userApi = await read("src/pages/api/forum/reports.ts");
  const adminListApi = await read("src/pages/api/admin/reports.ts");
  const adminDetailApi = await read("src/pages/api/admin/reports/[id].ts");
  const adminActionApi = await read("src/pages/api/admin/reports/[id]/action.ts");
  const reportTrigger = await read("src/components/reports/ReportTrigger.tsx");
  const postModerationActions = await read("src/components/forum/PostModerationActions.tsx");
  const commentsSection = await read("src/components/forum/CommentsSection.tsx");
  const circlePage = await read("src/pages/circles/[slug].astro");
  const profilePage = await read("src/components/profile/MyProfilePage.tsx");
  const helperSource = await read("src/lib/server/reports.server.ts");
  const notificationHelperSource = await read("src/lib/server/moderation-notifications.server.ts");
  const notificationSource = await read("src/lib/notifications.ts");

  assert(/countRecentReportsByUser/.test(userApi), "user reports API should rate-limit reporters");
  assert(/resolveReportTargetPreview/.test(userApi), "user reports API should verify target exists");
  assert(/duplicate/.test(userApi), "user reports API should support duplicate-friendly response");

  assert(/requireModerator/.test(adminListApi), "admin reports list should require moderator");
  assert(/fetchAdminReportsQueue/.test(adminListApi), "admin reports list should use reports helper");
  assert(/fetchAdminReportDetail/.test(adminDetailApi), "admin reports detail should load detail");
  assert(/applyAdminReportAction/.test(adminActionApi), "admin reports actions should use reports helper");

  assert(/targetType="post"/.test(postModerationActions), "post detail should expose report trigger");
  assert(/targetType="comment"/.test(commentsSection), "comment item should expose report trigger");
  assert(/targetType="circle"/.test(circlePage), "circle page should expose report trigger");
  assert(/targetType="user"/.test(profilePage), "public profile should expose report trigger");
  assert(/off_platform_contact/.test(reportTrigger), "report trigger should expose required reason codes");

  assert(/warn_user/.test(helperSource) && /ban_user/.test(helperSource), "report helper should integrate user safety actions");
  assert(/hide_target/.test(helperSource) && /reject_target/.test(helperSource), "report helper should integrate moderation actions");
  assert(/notifyPostModerated/.test(helperSource), "report helper should notify moderated post authors");
  assert(/notifyCommentModerated/.test(helperSource), "report helper should notify moderated comment authors");
  assert(/post_moderated/.test(notificationSource) && /user_restricted/.test(notificationSource), "notification types should include moderation variants");
  assert(/p_actor_id:\s*null/.test(notificationHelperSource), "moderation notifications should not expose admin identity");
  assert(!/reporter/i.test(notificationHelperSource), "moderation notification helper should not expose reporter identity");
  assert(!/note:|reason:|metadata:/i.test(notificationHelperSource), "moderation notification helper should avoid admin notes and raw metadata");

  console.log("REPORTS TEST PASSED");
}

main().catch((error) => {
  console.error("REPORTS TEST FAILED");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
