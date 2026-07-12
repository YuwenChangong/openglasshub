import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunManifest, registerArtifact, serializeManifest } from "./qa/destructive-qa-orchestrator.mjs";
import { assertPrivateManifestPath, loadRecoveryManifest, writeRecoveryManifestAtomic } from "./qa/recovery-manifest.mjs";

const dir = mkdtempSync(join(tmpdir(), "openglass-qa-recovery-"));
try {
  const path = join(dir, "run.json");
  const manifest = createRunManifest({ runId: "qa-recovery-12345", targetClassification: "staging" });
  registerArtifact(manifest, "users", { id: "user-exact-123", creationStep: "createQaUser" });
  writeRecoveryManifestAtomic(path, manifest);
  const loaded = loadRecoveryManifest(path);
  assert.equal(loaded.artifacts.users[0].id, "user-exact-123", "private manifest retains exact IDs");
  assert(!JSON.stringify(serializeManifest(loaded)).includes("user-exact-123"), "normal report redacts exact IDs");
  assert.throws(() => assertPrivateManifestPath(join(process.cwd(), "recovery.json")), /INSIDE_REPO/);
  writeFileSync(`${path}.partial.tmp`, "{");
  assert.equal(loadRecoveryManifest(path).runId, "qa-recovery-12345", "atomic authoritative file remains readable beside partial temp");
  writeFileSync(join(dir, "bad.json"), "{");
  assert.throws(() => loadRecoveryManifest(join(dir, "bad.json")), /QA_RECOVERY_MANIFEST_INVALID/);
  console.log("DESTRUCTIVE_QA_RECOVERY_OK temporary private manifests only");
} finally { rmSync(dir, { recursive: true, force: true }); }
