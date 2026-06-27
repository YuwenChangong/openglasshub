import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
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

  console.log("REPORTS TEST PASSED");
}

main().catch((error) => {
  console.error("REPORTS TEST FAILED");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
