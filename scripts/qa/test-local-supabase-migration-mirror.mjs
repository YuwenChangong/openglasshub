import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeMigrations, createMirror, validateMirror } from "./local-supabase-migration-mirror.mjs";

const canonical = join(process.cwd(), "supabase", "migrations");
const destination = await mkdtemp(join(tmpdir(), "openglass-p6a2-mirror-test-"));

try {
  const analysis = await analyzeMigrations(canonical);
  assert.equal(analysis.files.length, 34);
  assert.equal(analysis.uniqueVersionCount, 18);
  assert.equal(analysis.duplicateGroups.length, 10);
  assert.deepEqual(analysis.duplicateGroups.find((group) => group.version === "20260525")?.files.map((file) => file.filename), [
    "20260525_forum_phase4_video_media.sql",
    "20260525_forum_phase5_circle_creator_and_images.sql",
    "20260525_forum_phase5_publish_posts_rls.sql",
  ]);
  const manifest = await createMirror({ sourceDirectory: canonical, destinationDirectory: destination });
  const verified = await validateMirror({ sourceDirectory: canonical, destinationDirectory: destination, manifest });
  assert.equal(verified.fileCountMismatch, 0);
  assert.equal(verified.duplicateGroups.length, 0);
  assert.equal(verified.sqlByteParityFailures, 0);
  assert.equal(verified.orderPositionMismatches, 0);
  assert.equal(verified.remoteTargetGuard, "PASS");
  console.log(JSON.stringify({ test: "local-supabase-migration-mirror", status: "PASS", files: analysis.files.length }));
} finally {
  await rm(destination, { recursive: true, force: true });
}
