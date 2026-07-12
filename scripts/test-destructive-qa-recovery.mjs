import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunManifest, registerArtifact, serializeManifest } from "./qa/destructive-qa-orchestrator.mjs";
import { assertPrivateManifestPath, loadRecoveryManifest, recoverDestructiveQaRun, writeRecoveryManifestAtomic } from "./qa/recovery-manifest.mjs";

const dir = mkdtempSync(join(tmpdir(), "openglass-qa-recovery-"));
try {
  const path = join(dir, "run.json");
  const manifest = { ...createRunManifest({ runId: "qa-recovery-12345", targetClassification: "staging" }), targetBinding: { projectRef: "stagingref123", classification: "staging" }, revision: 0 };
  registerArtifact(manifest, "users", { id: "user-exact-123", creationStep: "createQaUser" });
  writeRecoveryManifestAtomic(path, manifest);
  const loaded = loadRecoveryManifest(path);
  assert.equal(loaded.artifacts.users[0].id, "user-exact-123", "private manifest retains exact IDs");
  assert(!JSON.stringify(serializeManifest(loaded)).includes("user-exact-123"), "normal report redacts exact IDs");
  assert.throws(() => assertPrivateManifestPath(join(process.cwd(), "recovery.json")), /INSIDE_REPO/);
  writeFileSync(`${path}.partial.tmp`, "{");
  assert.equal(loadRecoveryManifest(path).runId, "qa-recovery-12345", "atomic authoritative file remains readable beside partial temp");
  assert.throws(() => writeRecoveryManifestAtomic(path, manifest), /COLLISION/, "existing manifests cannot be overwritten");
  writeFileSync(join(dir, "bad.json"), "{");
  assert.throws(() => loadRecoveryManifest(join(dir, "bad.json")), /QA_RECOVERY_MANIFEST_INVALID/);
  const lifecycle = { ...manifest, artifacts: Object.fromEntries(Object.keys(manifest.artifacts).map((key) => [key, []])), recoveryAttempts: [] };
  lifecycle.artifacts.reports.push({ id: "report-exact-123", residueStatus: "PENDING", cleanupStatus: "PENDING" });
  lifecycle.artifacts.comments.push({ id: "comment-exact-123", residueStatus: "PENDING", cleanupStatus: "PENDING" });
  const events = []; const present = new Set(["report-exact-123", "comment-exact-123"]);
  const adapter = {
    deleteReportById: (id) => { events.push(`delete:${id}`); present.delete(id); },
    deleteCommentById: (id) => { events.push(`delete:${id}`); present.delete(id); },
    verifyArtifactAbsent: (artifact) => ({ absent: !present.has(artifact.id) }),
  };
  const guardedTarget = { actualRef: "stagingref123", expectedRef: "stagingref123", productionTarget: false };
  const recovered = await recoverDestructiveQaRun({ manifest: lifecycle, adapter, guardedTarget, confirmedRunId: "qa-recovery-12345", persist: async () => events.push("persist") });
  assert.equal(recovered.exitCode, 0); assert.deepEqual(events.filter((item) => item.startsWith("delete:")), ["delete:report-exact-123", "delete:comment-exact-123"]);
  const calls = events.length; const inspected = await recoverDestructiveQaRun({ manifest: recovered.manifest, adapter, guardedTarget, confirmedRunId: "qa-recovery-12345", persist: async () => {} });
  assert.equal(inspected.exitCode, 0); assert.equal(events.length, calls, "verified-absent artifacts are not retried");
  const retry = { ...lifecycle, artifacts: { ...lifecycle.artifacts, comments: [{ id: "comment-retry-123", residueStatus: "PENDING", cleanupStatus: "PENDING" }] }, recoveryAttempts: [] };
  let failOnce = true; present.add("comment-retry-123");
  const flaky = { ...adapter, deleteCommentById: (id) => { if (failOnce) { failOnce = false; throw new Error("fake failure"); } present.delete(id); } };
  assert.equal((await recoverDestructiveQaRun({ manifest: retry, adapter: flaky, guardedTarget, confirmedRunId: "qa-recovery-12345" })).exitCode, 1);
  assert.equal((await recoverDestructiveQaRun({ manifest: retry, adapter: flaky, guardedTarget, confirmedRunId: "qa-recovery-12345" })).exitCode, 0);
  console.log("DESTRUCTIVE_QA_RECOVERY_OK temporary private manifests only");
} finally { rmSync(dir, { recursive: true, force: true }); }
