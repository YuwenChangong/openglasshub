import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateReleaseAHistoryForensicArtifact } from "./device-schema-v1-release-a-history-forensic.mjs";

const artifactPath = "docs/ops/device-schema-v1-release-a-migration-history-forensic.json";

async function withMutatedArtifact(mutator) {
  const root = await mkdtemp(join(tmpdir(), "release-a-history-forensic-"));
  const tempArtifact = join(root, "artifact.json");
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  mutator(artifact);
  await writeFile(tempArtifact, `${JSON.stringify(artifact, null, 2)}\n`);
  return {
    artifactPath: tempArtifact,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("Release A history forensic artifact is deterministic and maps the five Production rows", async () => {
  const report = await validateReleaseAHistoryForensicArtifact();

  assert.equal(report.remoteMigrationCount, 5);
  assert.equal(report.remoteRowCount, 5);
  assert.equal(report.remoteVersionUniqueCount, 5);
  assert.equal(report.canonicalMappingCount, 5);
  assert.equal(report.unmappedRemoteVersions.length, 0);
  assert.equal(report.ambiguousRemoteVersions.length, 0);
  assert.equal(report.remoteAliasCount, 2);
  assert.equal(report.sharedExactVersionCount, 3);
  assert.equal(report.secretLeaks, 0);
  assert.deepEqual(report.remoteVersions, [
    "20260518",
    "20260703",
    "20260815010632",
    "20260902042807",
    "20260904101403",
  ]);
  assert.deepEqual(report.aliasMappings, [
    {
      remoteVersion: "20260815010632",
      canonicalLocalPath: "supabase/migrations/20260814_admin_circle_lifecycle_and_safe_purge.sql",
      classification: "REMOTE_ALIAS_OF_LOCAL_CANONICAL_MIGRATION",
    },
    {
      remoteVersion: "20260904101403",
      canonicalLocalPath: "supabase/migrations/20260904054013_forward_reconcile_security_privileges.sql",
      classification: "DUPLICATE_PROVIDER_RECORDED_VERSION_OF_EXISTING_CHANGE",
    },
  ]);
});

test("Release A history forensic artifact rejects row count and version changes", async () => {
  const missingRow = await withMutatedArtifact((artifact) => artifact.rows.pop());
  try {
    await assert.rejects(
      () => validateReleaseAHistoryForensicArtifact({ artifactPath: missingRow.artifactPath }),
      /REMOTE_ROW_COUNT_MUST_BE_5/,
    );
  } finally {
    await missingRow.cleanup();
  }

  const changedVersion = await withMutatedArtifact((artifact) => {
    artifact.rows[0].remoteVersion = "20991231235959";
  });
  try {
    await assert.rejects(
      () => validateReleaseAHistoryForensicArtifact({ artifactPath: changedVersion.artifactPath }),
      /REMOTE_VERSION_ORDER_OR_VALUE_CHANGED/,
    );
  } finally {
    await changedVersion.cleanup();
  }
});

test("Release A history forensic artifact rejects alias/classification/hash drift", async () => {
  const changedAlias = await withMutatedArtifact((artifact) => {
    artifact.rows[2].classification = "SHARED_EXACT_VERSION";
  });
  try {
    await assert.rejects(
      () => validateReleaseAHistoryForensicArtifact({ artifactPath: changedAlias.artifactPath }),
      /REMOTE_ROW_METADATA_CHANGED:20260815010632/,
    );
  } finally {
    await changedAlias.cleanup();
  }

  const changedHash = await withMutatedArtifact((artifact) => {
    artifact.rows[3].canonicalSha256 = "0".repeat(64);
  });
  try {
    await assert.rejects(
      () => validateReleaseAHistoryForensicArtifact({ artifactPath: changedHash.artifactPath }),
      /CANONICAL_SHA256_MISMATCH:20260902042807/,
    );
  } finally {
    await changedHash.cleanup();
  }
});

test("Release A history forensic artifact rejects secret-shaped and out-of-tree values", async () => {
  const secret = await withMutatedArtifact((artifact) => {
    artifact.rows[0].evidence.push("postgresql://user:password@example.test/postgres");
  });
  try {
    await assert.rejects(
      () => validateReleaseAHistoryForensicArtifact({ artifactPath: secret.artifactPath }),
      /SECRET_SHAPED_FIELD/,
    );
  } finally {
    await secret.cleanup();
  }

  const outOfTree = await withMutatedArtifact((artifact) => {
    artifact.rows[0].canonicalLocalPath = "docs/ops/not-a-migration.sql";
  });
  try {
    await assert.rejects(
      () => validateReleaseAHistoryForensicArtifact({ artifactPath: outOfTree.artifactPath }),
      /REMOTE_ROW_METADATA_CHANGED:20260518/,
    );
  } finally {
    await outOfTree.cleanup();
  }
});

test("Release A history forensic artifact pins remote row metadata and fingerprints", async () => {
  const changedName = await withMutatedArtifact((artifact) => {
    artifact.rows[1].remoteName = "prompt_supplied_name";
  });
  try {
    await assert.rejects(
      () => validateReleaseAHistoryForensicArtifact({ artifactPath: changedName.artifactPath }),
      /REMOTE_ROW_METADATA_CHANGED:20260703/,
    );
  } finally {
    await changedName.cleanup();
  }

  const changedStatementCount = await withMutatedArtifact((artifact) => {
    artifact.rows[2].remoteStatementCount = 2;
  });
  try {
    await assert.rejects(
      () => validateReleaseAHistoryForensicArtifact({ artifactPath: changedStatementCount.artifactPath }),
      /REMOTE_ROW_METADATA_CHANGED:20260815010632/,
    );
  } finally {
    await changedStatementCount.cleanup();
  }

  const changedFingerprint = await withMutatedArtifact((artifact) => {
    artifact.rows[4].remoteNormalizedStatementFingerprint = "0".repeat(32);
  });
  try {
    await assert.rejects(
      () => validateReleaseAHistoryForensicArtifact({ artifactPath: changedFingerprint.artifactPath }),
      /REMOTE_ROW_METADATA_CHANGED:20260904101403/,
    );
  } finally {
    await changedFingerprint.cleanup();
  }
});

test("Release A history forensic artifact pins alias equivalence and evidence sources", async () => {
  const changedMethod = await withMutatedArtifact((artifact) => {
    artifact.rows[2].equivalence.method = "PROMPT_ASSERTED";
  });
  try {
    await assert.rejects(
      () => validateReleaseAHistoryForensicArtifact({ artifactPath: changedMethod.artifactPath }),
      /ALIAS_EQUIVALENCE_CHANGED:20260815010632/,
    );
  } finally {
    await changedMethod.cleanup();
  }

  const changedAliasFingerprint = await withMutatedArtifact((artifact) => {
    artifact.rows[4].equivalence.fingerprint = "0".repeat(32);
  });
  try {
    await assert.rejects(
      () => validateReleaseAHistoryForensicArtifact({ artifactPath: changedAliasFingerprint.artifactPath }),
      /ALIAS_EQUIVALENCE_CHANGED:20260904101403/,
    );
  } finally {
    await changedAliasFingerprint.cleanup();
  }

  const promptOnlyEvidence = await withMutatedArtifact((artifact) => {
    artifact.rows[2].evidence = ["PROMPT_ONLY"];
  });
  try {
    await assert.rejects(
      () => validateReleaseAHistoryForensicArtifact({ artifactPath: promptOnlyEvidence.artifactPath }),
      /ALIAS_EVIDENCE_CHANGED:20260815010632/,
    );
  } finally {
    await promptOnlyEvidence.cleanup();
  }
});
