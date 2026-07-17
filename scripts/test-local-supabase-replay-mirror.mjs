import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ORDERED_MIGRATION_FILENAMES,
  buildLocalSupabaseReplayMirror,
  inspectMigrationBytes,
} from "./build-local-supabase-replay-mirror.mjs";

const root = process.cwd();
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "openglass-local-supabase-mirror-"));

try {
  const outputDirectory = path.join(temporaryRoot, "migrations");
  const mappingPath = path.join(temporaryRoot, "mapping.json");
  const report = await buildLocalSupabaseReplayMirror({
    canonicalDirectory: path.join(root, "supabase", "migrations"),
    outputDirectory,
    mappingPath,
    repositoryRoot: root,
  });

  assert.equal(report.migrationCount, 43);
  assert.equal(report.temporaryVersionCount, 43);
  assert.deepEqual(report.bomTransformedFiles, [
    "20260603_forum_comments_interactions.sql",
    "20260605_forum_posts_body_short_content.sql",
  ]);
  assert.deepEqual(report.legalPrerequisites.at(-1), "20260717_security_definer_execute_hardening.sql");
  assert.equal(new Set(report.mappings.map((entry) => entry.temporaryVersion)).size, ORDERED_MIGRATION_FILENAMES.length);

  for (const entry of report.mappings) {
    const canonical = await readFile(path.join(root, "supabase", "migrations", entry.canonicalFile));
    const replay = await readFile(path.join(outputDirectory, entry.temporaryFile));
    const expected = entry.transformation === "REMOVE_LEADING_UTF8_BOM" ? canonical.subarray(3) : canonical;
    assert.deepEqual(replay, expected, `${entry.canonicalFile} must receive only its declared transformation`);
  }

  assert.throws(() => inspectMigrationBytes("invalid.sql", Buffer.from([0xc3, 0x28])), /invalid UTF-8/);
  assert.throws(() => inspectMigrationBytes("nul.sql", Buffer.from([0x2d, 0x2d, 0x00])), /NUL byte/);
  assert.throws(() => inspectMigrationBytes("interior-bom.sql", Buffer.from([0x2d, 0x2d, 0xef, 0xbb, 0xbf])), /away from byte offset zero/);
  console.log(JSON.stringify({ migrationCount: report.migrationCount, bomTransforms: report.bomTransformedFiles.length, canonicalWrites: 0, realOperations: 0 }));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
