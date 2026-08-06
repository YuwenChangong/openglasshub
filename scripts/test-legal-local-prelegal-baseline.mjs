import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LEGAL_LOCAL_PRELEGAL_BOUNDARY_MIGRATION, LEGAL_LOCAL_PRELEGAL_RUNTIME_REQUIRED, resolveLegalPrelegalBaseline, validateLegalPrelegalBaselineCheckpoint, validateLegalPrelegalBaselineManifest } from "./lib/legal-local-prelegal-baseline.mjs";

const root = process.cwd();
const commit = "5b9e29ddcd2d53cfe00033fe9999ac6f2eb4ff94";
const manifest = await resolveLegalPrelegalBaseline({ repositoryRoot: root, implementationCommit: commit, generatedAt: "2026-08-06T00:00:00.000Z" });
assert.equal(manifest.schemaVersion, "legal-local-prelegal-baseline-manifest-v1");
assert.equal(manifest.boundaryMigrationFilename, LEGAL_LOCAL_PRELEGAL_BOUNDARY_MIGRATION);
assert.equal(manifest.migrations.some((entry) => entry.filename === "20260606_forum_notifications_mvp.sql"), true);
assert.equal(manifest.migrations.some((entry) => entry.filename === "20260611_stabilize_forum_notifications_realtime_permissions.sql"), true);
assert.equal(manifest.migrations.some((entry) => entry.filename === LEGAL_LOCAL_PRELEGAL_BOUNDARY_MIGRATION), false);
assert.equal(manifest.runtimeClassification, LEGAL_LOCAL_PRELEGAL_RUNTIME_REQUIRED);
assert.equal(manifest.migrations.every((entry, index) => entry.sequence === index + 1 && /^[a-f0-9]{64}$/.test(entry.canonicalSha256)), true);
assert.equal(validateLegalPrelegalBaselineManifest(manifest, { implementationCommit: commit }).classification, "R6_LOCAL_PRELEGAL_BASELINE_MANIFEST_READY");
const manifestSha256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
const checkpoint = { schemaVersion: "legal-local-prelegal-baseline-checkpoint-v1", taskId: "r6-local-predeployment-11111111-2222-4333-8444-000000000101", implementationCommit: commit, baselineManifestSha256: manifestSha256, classification: "R6_LOCAL_PRELEGAL_BASELINE_CHECKPOINT_READY", relation: "public.forum_notifications", columns: ["recipient_id", "actor_id", "type", "post_id", "comment_id", "circle_id", "read_at", "created_at", "last_event_at"], constraints: ["forum_notifications_type_check"], functions: ["public.insert_forum_notification"] };
assert.equal(validateLegalPrelegalBaselineCheckpoint(checkpoint, { taskId: checkpoint.taskId, implementationCommit: commit, baselineManifestSha256: manifestSha256 }).classification, "R6_LOCAL_PRELEGAL_BASELINE_CHECKPOINT_READY");
assert.throws(() => validateLegalPrelegalBaselineCheckpoint({ ...checkpoint, columns: checkpoint.columns.slice(0, -1) }, { taskId: checkpoint.taskId, implementationCommit: commit, baselineManifestSha256: manifestSha256 }), /R6_LOCAL_PRELEGAL_BASELINE_CHECKPOINT_INCOMPLETE/);
const synthetic = await mkdtemp(path.join(os.tmpdir(), "r6-baseline-resolver-"));
try {
  await mkdir(path.join(synthetic, "supabase", "migrations"), { recursive: true });
  await writeFile(path.join(synthetic, "supabase", "migrations", "20260605_synthetic_predecessor.sql"), "select 1;\n");
  await writeFile(path.join(synthetic, "supabase", "migrations", "20260703_moderation_action_notifications.sql"), "select 1;\n");
  await assert.rejects(() => resolveLegalPrelegalBaseline({ repositoryRoot: synthetic, implementationCommit: commit }), /R6_LOCAL_PRELEGAL_BASELINE_PREREQUISITE_MISSING/);
} finally { await rm(synthetic, { recursive: true, force: true }); }
console.log(JSON.stringify({ classification: "R6_LOCAL_PRELEGAL_BASELINE_RESOLVER_TESTS_READY", baselineMigrationCount: manifest.baselineMigrationCount, runtimeClassification: manifest.runtimeClassification, formalLegalEvidence: false }));
