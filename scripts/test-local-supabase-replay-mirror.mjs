import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import {
  ORDERED_MIGRATION_FILENAMES,
  buildLocalSupabaseReplayMirror,
  inspectMigrationBytes,
} from "./build-local-supabase-replay-mirror.mjs";

const root = process.cwd();
const canonicalDirectory = path.join(root, "supabase", "migrations");
const expectedOrder = [
  "20260518_forum_phase1_schema.sql",
  "20260519_forum_phase2_grants.sql",
  "20260524_forum_phase3_post_media.sql",
  "20260525_forum_phase4_video_media.sql",
  "20260525_forum_phase5_publish_posts_rls.sql",
  "20260525_forum_phase5_circle_creator_and_images.sql",
  "20260531_forum_phase6_upload_guardrails.sql",
  "20260603_forum_comments_interactions.sql",
  "20260603_forum_hot_sort_and_circle_name_guard.sql",
  "20260603_forum_circle_owner_management.sql",
  "20260604_forum_circle_soft_delete_and_management.sql",
  "20260604_circle_cover_storage_policy.sql",
  "20260605_circle_cover_public_select.sql",
  "20260605_forum_rate_limit_purposes.sql",
  "20260605_forum_posts_body_short_content.sql",
  "20260606_profile_banner_and_storage.sql",
  "20260606_forum_notifications_mvp.sql",
  "20260607_auth_resend_confirmation_limit.sql",
  "20260607_enable_forum_realtime.sql",
  "20260607_fix_notification_relike_update_guard.sql",
  "20260611_fix_forum_notification_realtime.sql",
  "20260611_stabilize_forum_notifications_realtime_permissions.sql",
  "20260611_forum_permission_lockdown.sql",
  "20260612_hot_news_mvp.sql",
  "20260612_news_view_count_and_pagination.sql",
  "20260612_news_media_storage_policy.sql",
  "20260616_community_moderation_mvp.sql",
  "20260620_lock_profile_role_updates.sql",
  "20260620_admin_qa_role_grant_path.sql",
  "20260626_user_safety_states_and_bans.sql",
  "20260627_reports_optimization_mvp.sql",
  "20260703_moderation_action_notifications.sql",
  "20260712_legal_policy_acceptances.sql",
  "20260713_comment_creation_circle_authorization.sql",
  "20260713_comment_reaction_visibility_authorization.sql",
  "20260713_comment_read_circle_visibility_authorization.sql",
  "20260713_forum_posts_circle_authorization.sql",
  "20260713_forum_report_target_authorization.sql",
  "20260713_post_bound_media_provenance.sql",
  "20260714_circle_cover_public_visibility_authorization.sql",
  "20260715_post_media_delivery_visibility_authorization.sql",
  "20260716_profile_media_delivery_authorization.sql",
  "20260717_security_definer_execute_hardening.sql",
  "20260814_admin_circle_lifecycle_and_safe_purge.sql",
  "20260829_device_library_admin.sql",
  "20260829_device_slug_lock.sql",
  "20260829054707_device_service_role_bootstrap_grants.sql",
  "20260902042807_forward_reconcile_devices.sql",
  "20260904054013_forward_reconcile_security_privileges.sql",
];

async function disposableBuild(canonicalDirectoryForBuild = canonicalDirectory) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "openglass-local-supabase-mirror-"));
  try {
    const outputDirectory = path.join(temporaryRoot, "migrations");
    const mappingPath = path.join(temporaryRoot, "mapping.json");
    return await buildLocalSupabaseReplayMirror({
      canonicalDirectory: canonicalDirectoryForBuild,
      outputDirectory,
      mappingPath,
      repositoryRoot: root,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function copiedCanonicalDirectory({ omit, extra, mutate } = {}) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "openglass-canonical-migrations-"));
  const copied = path.join(temporaryRoot, "migrations");
  await mkdir(copied);
  for (const filename of expectedOrder) {
    if (filename !== omit) await writeFile(
      path.join(copied, filename),
      execFileSync("git", ["-C", root, "cat-file", "blob", `HEAD:supabase/migrations/${filename}`]),
    );
  }
  if (extra) await writeFile(path.join(copied, extra), "select 1;\n");
  if (mutate) await writeFile(path.join(copied, mutate), Buffer.concat([await readFile(path.join(copied, mutate)), Buffer.from("-- mutation\n")]));
  return { copied, temporaryRoot };
}

test("accepts the current 49-file canonical inventory in its reviewed replay order", async () => {
  const report = await disposableBuild();
  assert.equal(report.migrationCount, 49);
  assert.equal(report.temporaryVersionCount, 49);
  assert.deepEqual(report.mappings.map((entry) => entry.canonicalFile), expectedOrder);
  assert.deepEqual(report.bomTransformedFiles, [
    "20260603_forum_comments_interactions.sql",
    "20260605_forum_posts_body_short_content.sql",
  ]);
  assert.deepEqual(report.legalPrerequisites.at(-1), "20260717_security_definer_execute_hardening.sql");
  assert.equal(new Set(report.mappings.map((entry) => entry.temporaryVersion)).size, ORDERED_MIGRATION_FILENAMES.length);
  assert.equal(
    report.mappings.find(({ canonicalFile }) => canonicalFile === "20260902042807_forward_reconcile_devices.sql")?.canonicalSha256,
    "2f98fea88b4b5619dce82a0e48c0653c96f4db3e212d6f52a85fbab083405e65",
    "P10 replay must use its canonical Git/LF byte identity rather than Windows checkout bytes",
  );
});

test("rejects removal of a required canonical migration", async () => {
  const fixture = await copiedCanonicalDirectory({ omit: "20260902042807_forward_reconcile_devices.sql" });
  try {
    await assert.rejects(() => disposableBuild(fixture.copied), /deterministic 49-file manifest/);
  } finally {
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("rejects an unexpected canonical migration", async () => {
  const fixture = await copiedCanonicalDirectory({ extra: "20260903_unapproved.sql" });
  try {
    await assert.rejects(() => disposableBuild(fixture.copied), /deterministic 49-file manifest/);
  } finally {
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("rejects canonical migration identity drift", async () => {
  const fixture = await copiedCanonicalDirectory({ mutate: "20260902042807_forward_reconcile_devices.sql" });
  try {
    await assert.rejects(() => disposableBuild(fixture.copied), /canonical SHA-256 differs from the deterministic manifest/);
  } finally {
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("rejects byte drift for every reviewed canonical migration", async () => {
  for (const filename of expectedOrder) {
    const fixture = await copiedCanonicalDirectory({ mutate: filename });
    try {
      await assert.rejects(
        () => disposableBuild(fixture.copied),
        /canonical SHA-256 differs from the deterministic manifest/,
        `${filename} must be anchored even outside the Git canonical root`,
      );
    } finally {
      await rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  }
});

test("rejects a dirty tracked migration in the real canonical root", async () => {
  const filename = "20260518_forum_phase1_schema.sql";
  const migrationPath = path.join(canonicalDirectory, filename);
  const original = await readFile(migrationPath);
  try {
    await writeFile(migrationPath, Buffer.concat([original, Buffer.from("-- test-only dirty working tree mutation\\n")]));
    await assert.rejects(
      () => disposableBuild(),
      /worktree content differs from the canonical Git migration identity/,
    );
  } finally {
    await writeFile(migrationPath, original);
  }
});

test("replay mapping applies the device foundation and slug lock before service-role grants", async () => {
  const report = await disposableBuild();
  assert.deepEqual(
    report.mappings
      .filter(({ canonicalFile }) => canonicalFile === "20260829_device_library_admin.sql" || canonicalFile === "20260829_device_slug_lock.sql" || canonicalFile === "20260829054707_device_service_role_bootstrap_grants.sql" || canonicalFile === "20260902042807_forward_reconcile_devices.sql")
      .map(({ canonicalFile, canonicalVersion, temporaryVersion, temporaryFile }) => ({ canonicalFile, canonicalVersion, temporaryVersion, temporaryFile })),
    [
      {
        canonicalFile: "20260829_device_library_admin.sql",
        canonicalVersion: "20260829",
        temporaryVersion: "20260829000001",
        temporaryFile: "20260829000001_device_library_admin.sql",
      },
      {
        canonicalFile: "20260829_device_slug_lock.sql",
        canonicalVersion: "20260829",
        temporaryVersion: "20260829000002",
        temporaryFile: "20260829000002_device_slug_lock.sql",
      },
      {
        canonicalFile: "20260829054707_device_service_role_bootstrap_grants.sql",
        canonicalVersion: "20260829",
        temporaryVersion: "20260829000003",
        temporaryFile: "20260829000003_device_service_role_bootstrap_grants.sql",
      },
      {
        canonicalFile: "20260902042807_forward_reconcile_devices.sql",
        canonicalVersion: "20260902",
        temporaryVersion: "20260902000001",
        temporaryFile: "20260902000001_forward_reconcile_devices.sql",
      },
    ],
    "14-digit source versions normalize to their canonical date before deterministic replay sequencing",
  );
  assert(
    report.mappings.findIndex(({ canonicalFile }) => canonicalFile === "20260829_device_library_admin.sql")
      < report.mappings.findIndex(({ canonicalFile }) => canonicalFile === "20260829054707_device_service_role_bootstrap_grants.sql"),
    "the device table must exist before the service-role grant is applied",
  );
  assert.deepEqual(report.mappings
    .filter(({ duplicateGroupCount }) => duplicateGroupCount > 1)
    .map(({ canonicalFile, temporaryVersion }) => ({ canonicalFile, temporaryVersion })), [
      { canonicalFile: "20260525_forum_phase4_video_media.sql", temporaryVersion: "20260525000001" },
      { canonicalFile: "20260525_forum_phase5_publish_posts_rls.sql", temporaryVersion: "20260525000002" },
      { canonicalFile: "20260525_forum_phase5_circle_creator_and_images.sql", temporaryVersion: "20260525000003" },
      { canonicalFile: "20260603_forum_comments_interactions.sql", temporaryVersion: "20260603000001" },
      { canonicalFile: "20260603_forum_hot_sort_and_circle_name_guard.sql", temporaryVersion: "20260603000002" },
      { canonicalFile: "20260603_forum_circle_owner_management.sql", temporaryVersion: "20260603000003" },
      { canonicalFile: "20260604_forum_circle_soft_delete_and_management.sql", temporaryVersion: "20260604000001" },
      { canonicalFile: "20260604_circle_cover_storage_policy.sql", temporaryVersion: "20260604000002" },
      { canonicalFile: "20260605_circle_cover_public_select.sql", temporaryVersion: "20260605000001" },
      { canonicalFile: "20260605_forum_rate_limit_purposes.sql", temporaryVersion: "20260605000002" },
      { canonicalFile: "20260605_forum_posts_body_short_content.sql", temporaryVersion: "20260605000003" },
      { canonicalFile: "20260606_profile_banner_and_storage.sql", temporaryVersion: "20260606000001" },
      { canonicalFile: "20260606_forum_notifications_mvp.sql", temporaryVersion: "20260606000002" },
      { canonicalFile: "20260607_auth_resend_confirmation_limit.sql", temporaryVersion: "20260607000001" },
      { canonicalFile: "20260607_enable_forum_realtime.sql", temporaryVersion: "20260607000002" },
      { canonicalFile: "20260607_fix_notification_relike_update_guard.sql", temporaryVersion: "20260607000003" },
      { canonicalFile: "20260611_fix_forum_notification_realtime.sql", temporaryVersion: "20260611000001" },
      { canonicalFile: "20260611_stabilize_forum_notifications_realtime_permissions.sql", temporaryVersion: "20260611000002" },
      { canonicalFile: "20260611_forum_permission_lockdown.sql", temporaryVersion: "20260611000003" },
      { canonicalFile: "20260612_hot_news_mvp.sql", temporaryVersion: "20260612000001" },
      { canonicalFile: "20260612_news_view_count_and_pagination.sql", temporaryVersion: "20260612000002" },
      { canonicalFile: "20260612_news_media_storage_policy.sql", temporaryVersion: "20260612000003" },
      { canonicalFile: "20260620_lock_profile_role_updates.sql", temporaryVersion: "20260620000001" },
      { canonicalFile: "20260620_admin_qa_role_grant_path.sql", temporaryVersion: "20260620000002" },
      { canonicalFile: "20260713_comment_creation_circle_authorization.sql", temporaryVersion: "20260713000001" },
      { canonicalFile: "20260713_comment_reaction_visibility_authorization.sql", temporaryVersion: "20260713000002" },
      { canonicalFile: "20260713_comment_read_circle_visibility_authorization.sql", temporaryVersion: "20260713000003" },
      { canonicalFile: "20260713_forum_posts_circle_authorization.sql", temporaryVersion: "20260713000004" },
      { canonicalFile: "20260713_forum_report_target_authorization.sql", temporaryVersion: "20260713000005" },
      { canonicalFile: "20260713_post_bound_media_provenance.sql", temporaryVersion: "20260713000006" },
      { canonicalFile: "20260829_device_library_admin.sql", temporaryVersion: "20260829000001" },
      { canonicalFile: "20260829_device_slug_lock.sql", temporaryVersion: "20260829000002" },
      { canonicalFile: "20260829054707_device_service_role_bootstrap_grants.sql", temporaryVersion: "20260829000003" },
    ]);
});

test("rejects malformed migration byte streams", () => {
  assert.throws(() => inspectMigrationBytes("invalid.sql", Buffer.from([0xc3, 0x28])), /invalid UTF-8/);
  assert.throws(() => inspectMigrationBytes("nul.sql", Buffer.from([0x2d, 0x2d, 0x00])), /NUL byte/);
  assert.throws(() => inspectMigrationBytes("interior-bom.sql", Buffer.from([0x2d, 0x2d, 0xef, 0xbb, 0xbf])), /away from byte offset zero/);
});
