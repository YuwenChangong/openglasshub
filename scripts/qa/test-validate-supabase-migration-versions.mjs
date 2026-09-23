import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeMigrations } from "./local-supabase-migration-mirror.mjs";
import { assertMigrationVersionBaseline } from "./validate-supabase-migration-versions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baseline = JSON.parse(await readFile(path.join(root, "tests/fixtures/historical-duplicate-migration-versions.json"), "utf8"));
const current = await analyzeMigrations(path.join(root, "supabase", "migrations"));

assert.equal(current.duplicateGroups.length, 11, "the old unconditional rule sees the historical duplicate groups");
assert.doesNotThrow(() => assertMigrationVersionBaseline({ analysis: current, baseline }), "the exact reviewed historical baseline is accepted");

const temporary = await mkdtemp(path.join(os.tmpdir(), "openglass-migration-version-baseline-"));
try {
  const copiedMigrations = path.join(temporary, "migrations");
  await cp(path.join(root, "supabase", "migrations"), copiedMigrations, { recursive: true });
  const validatorPath = path.join(root, "scripts", "qa", "validate-supabase-migration-versions.mjs");
  const runValidator = () => spawnSync(process.execPath, [validatorPath, copiedMigrations], { cwd: root, encoding: "utf8" });

  await rm(path.join(copiedMigrations, "20260525_forum_phase5_publish_posts_rls.sql"));
  let result = runValidator();
  assert.notEqual(result.status, 0, "the CLI rejects removal from a grandfathered duplicate group");
  assert.match(result.stderr, /baseline hash mismatch: 20260525/, "the CLI identifies the changed known duplicate group");

  await cp(path.join(root, "supabase", "migrations", "20260525_forum_phase5_publish_posts_rls.sql"), path.join(copiedMigrations, "20260525_forum_phase5_publish_posts_rls.sql"));
  await writeFile(path.join(copiedMigrations, "20260525_unreviewed_extra.sql"), "select 1;\n", "utf8");
  result = runValidator();
  assert.notEqual(result.status, 0, "the CLI rejects addition to a grandfathered duplicate group");
  assert.match(result.stderr, /baseline hash mismatch: 20260525/, "the CLI identifies the expanded known duplicate group");

  await writeFile(path.join(temporary, "20260525_forum_phase4_video_media.sql"), "changed", "utf8");
  await writeFile(path.join(temporary, "20260525_forum_phase5_circle_creator_and_images.sql"), "unchanged", "utf8");
  let analysis = await analyzeMigrations(temporary);
  assert.throws(() => assertMigrationVersionBaseline({ analysis, baseline: { duplicateGroups: [{ version: "20260525", files: analysis.duplicateGroups[0].files.map((file, index) => ({ filename: file.filename, sha256: index === 0 ? "0".repeat(64) : file.sha256 })) }] } }), /baseline hash mismatch/, "protected duplicate content drift is rejected");
  await writeFile(path.join(temporary, "20270101_new_a.sql"), "a", "utf8");
  await writeFile(path.join(temporary, "20270101_new_b.sql"), "b", "utf8");
  analysis = await analyzeMigrations(temporary);
  assert.throws(() => assertMigrationVersionBaseline({ analysis, baseline: { duplicateGroups: [] } }), /unknown duplicate version/, "a new duplicate version is rejected");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log("MIGRATION_VERSION_BASELINE_OK");
