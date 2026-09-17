import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const knownGroup = current.duplicateGroups.find(({ version }) => version === "20260525");
assert.ok(knownGroup, "the fixture contains the reviewed 20260525 duplicate group");
assert.throws(
  () => assertMigrationVersionBaseline({
    analysis: { ...current, duplicateGroups: current.duplicateGroups.map((group) => group.version === knownGroup.version
      ? { ...group, files: group.files.slice(1) }
      : group) },
    baseline,
  }),
  /baseline hash mismatch: 20260525/,
  "removing a member from a grandfathered duplicate group is rejected",
);
assert.throws(
  () => assertMigrationVersionBaseline({
    analysis: { ...current, duplicateGroups: current.duplicateGroups.map((group) => group.version === knownGroup.version
      ? { ...group, files: [...group.files, { filename: "20260525_unreviewed_extra.sql", sha256: "0".repeat(64) }] }
      : group) },
    baseline,
  }),
  /baseline hash mismatch: 20260525/,
  "adding a member to a grandfathered duplicate group is rejected",
);

const temporary = await mkdtemp(path.join(os.tmpdir(), "openglass-migration-version-baseline-"));
try {
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
