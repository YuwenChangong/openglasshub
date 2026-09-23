import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildReleaseAHistoryCompatibilityOverlay,
  compareCanonicalMigrationsToReleaseAHistory,
} from "./device-schema-v1-release-a-history-overlay.mjs";

const releaseAFilename = "20260909195640_device_schema_v1_foundation.sql";
const releaseASha256 = "a117631dd7a1ffa848b1df8dfbc8286bc7f901a1375961b3d4fe9ad5b2a2d215";

test("canonical migration directory cannot safely express Release A only against five-row Production history", async () => {
  const comparison = await compareCanonicalMigrationsToReleaseAHistory();

  assert.equal(comparison.remoteRecorded, 5);
  assert.equal(comparison.canonicalMigrationCount, 50);
  assert.equal(comparison.providerAliasVersionsAbsentFromCanonical, true);
  assert(comparison.pending.length > 1);
  assert(comparison.pending.some((entry) => entry.filename === releaseAFilename));
  assert.equal(comparison.directCanonicalTransportSafeForReleaseAOnly, false);
});

test("overlay contains five history-compatible migrations and exactly one pending Release A migration", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-a-history-overlay-"));
  try {
    const report = await buildReleaseAHistoryCompatibilityOverlay({ destinationRoot: root });
    assert.equal(report.remoteRecorded, 5);
    assert.equal(report.overlayMigrationCount, 6);
    assert.equal(report.overlayHistoryVersionCount, 5);
    assert.equal(report.overlayPendingCount, 1);
    assert.deepEqual(report.pending, [releaseAFilename]);
    assert.equal(report.overlayReleaseASha256, releaseASha256);
    assert.equal(report.aliasCoverage, "2/2");
    assert.equal(report.remoteHistoryCoverage, "5/5");
    assert.equal(report.canonicalMigrationDirectoryUnchanged, true);

    const generated = await readdir(join(root, "supabase", "migrations"));
    assert.deepEqual(generated.sort(), [
      "20260518_forum_phase1_schema.sql",
      "20260703_moderation_action_notifications.sql",
      "20260815010632_admin_circle_lifecycle_and_safe_purge.sql",
      "20260902042807_forward_reconcile_devices.sql",
      "20260904101403_forward_reconcile_security_privileges.sql",
      releaseAFilename,
    ]);

    for (const mapping of report.files) {
      assert.equal(mapping.byteIdentical, true);
      assert.equal(mapping.overlaySha256, mapping.canonicalSha256);
      assert((await readFile(join(root, mapping.overlayRelativePath))).equals(await readFile(mapping.canonicalAbsolutePath)));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("overlay builder rejects unsafe inputs and paths fail-closed", async () => {
  await assert.rejects(
    () => buildReleaseAHistoryCompatibilityOverlay({ artifactPath: "docs/ops/missing-release-a-forensic.json" }),
    /FORENSIC_ARTIFACT_UNAVAILABLE/,
  );
  await assert.rejects(
    () => buildReleaseAHistoryCompatibilityOverlay({ destinationRoot: "supabase/migrations" }),
    /OVERLAY_DESTINATION_INSIDE_CANONICAL_MIGRATIONS/,
  );
  await assert.rejects(
    () => buildReleaseAHistoryCompatibilityOverlay({ destinationRoot: join(tmpdir(), "not-owned-release-a-overlay") }),
    /OVERLAY_DESTINATION_NOT_OWNED_TEMP/,
  );
  await assert.rejects(
    () => buildReleaseAHistoryCompatibilityOverlay({ destinationRoot: "release-a-history-overlay-repo-local" }),
    /OVERLAY_DESTINATION_OUTSIDE_OS_TEMP/,
  );
});

test("overlay builder rejects artifact changes that would introduce extra pending migrations", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-a-history-overlay-"));
  const artifact = join(root, "artifact.json");
  const original = JSON.parse(await readFile("docs/ops/device-schema-v1-release-a-migration-history-forensic.json", "utf8"));
  original.rows[4] = {
    ...original.rows[4],
    remoteVersion: "20260909195640",
    remoteName: "device_schema_v1_foundation",
    classification: "SHARED_EXACT_VERSION",
    canonicalLocalPath: "supabase/migrations/20260909195640_device_schema_v1_foundation.sql",
    canonicalLocalVersion: "20260909195640",
    canonicalSha256: releaseASha256,
    equivalence: { method: "EXACT_REMOTE_VERSION_MATCH", fingerprint: "remote-version:20260909195640" },
    evidence: ["READ_ONLY_SELECT:supabase_migrations.schema_migrations ordered by version,name"],
  };
  await writeFile(artifact, `${JSON.stringify(original, null, 2)}\n`);
  try {
    await assert.rejects(
      () => buildReleaseAHistoryCompatibilityOverlay({ artifactPath: artifact, destinationRoot: root }),
      /REMOTE_VERSION_ORDER_OR_VALUE_CHANGED/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("overlay builder never writes alias files into canonical migrations", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-a-history-overlay-"));
  try {
    await buildReleaseAHistoryCompatibilityOverlay({ destinationRoot: root });
    const canonical = await readdir("supabase/migrations");
    assert.equal(canonical.includes("20260815010632_admin_circle_lifecycle_and_safe_purge.sql"), false);
    assert.equal(canonical.includes("20260904101403_forward_reconcile_security_privileges.sql"), false);
    assert.equal(canonical.length, 50);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
