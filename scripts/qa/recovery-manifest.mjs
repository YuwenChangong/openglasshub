import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const RECOVERY_SCHEMA_VERSION = 1;

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function canonicalCandidate(path) {
  const absolute = resolve(path);
  const missing = [];
  let cursor = absolute;
  while (!existsSync(cursor)) { missing.unshift(cursor.split(/[\\/]/).pop()); const parent = dirname(cursor); if (parent === cursor) throw new Error("QA_RECOVERY_MANIFEST_PATH_INVALID"); cursor = parent; }
  return missing.reduce((value, part) => join(value, part), realpathSync(cursor));
}

export function assertPrivateManifestPath(manifestPath, repoRoot = process.cwd()) {
  const lexical = resolve(manifestPath);
  const repoLexical = resolve(repoRoot);
  const repoCanonical = realpathSync(repoLexical);
  const candidateCanonical = canonicalCandidate(lexical);
  if (!isAbsolute(lexical) || inside(repoLexical, lexical) || inside(repoCanonical, candidateCanonical)) throw new Error("QA_RECOVERY_MANIFEST_INSIDE_REPO");
  return lexical;
}

export function validateRecoveryManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== RECOVERY_SCHEMA_VERSION || !manifest.runId || !manifest.artifacts || !manifest.targetBinding?.projectRef || !manifest.targetBinding?.classification) throw new Error("QA_RECOVERY_MANIFEST_INVALID");
  return manifest;
}

export function writeRecoveryManifestAtomic(manifestPath, manifest, { repoRoot = process.cwd(), mode = "create", expectedRevision = null } = {}) {
  const path = assertPrivateManifestPath(manifestPath, repoRoot);
  validateRecoveryManifest(manifest);
  const exists = existsSync(path);
  if (mode === "create" && exists) throw new Error("QA_RECOVERY_MANIFEST_COLLISION");
  if (mode === "update") {
    if (!exists) throw new Error("QA_RECOVERY_MANIFEST_MISSING");
    const current = loadRecoveryManifest(path, repoRoot);
    if (current.runId !== manifest.runId || current.targetBinding.projectRef !== manifest.targetBinding.projectRef || current.revision !== expectedRevision) throw new Error("QA_RECOVERY_MANIFEST_STALE");
  }
  if (mode !== "create" && mode !== "update") throw new Error("QA_RECOVERY_MANIFEST_MODE_INVALID");
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify({ ...manifest, revision: (manifest.revision ?? 0) + 1, updatedAt: new Date().toISOString() }, null, 2);
  const fd = openSync(temp, "wx");
  try { writeFileSync(fd, payload); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
}

export function loadRecoveryManifest(manifestPath, repoRoot) {
  const path = assertPrivateManifestPath(manifestPath, repoRoot);
  try { return validateRecoveryManifest(JSON.parse(readFileSync(path, "utf8"))); }
  catch (error) { if (error?.message?.startsWith("QA_RECOVERY")) throw error; throw new Error("QA_RECOVERY_MANIFEST_INVALID"); }
}

const RECOVERY_ORDER = ["reports", "relationshipRows", "comments", "mediaObjects", "posts", "circles", "roleAssignments", "profiles", "users"];
const RECOVERY_METHODS = { reports: "deleteReportById", relationshipRows: "deleteRelationshipByExactId", comments: "deleteCommentById", mediaObjects: "deleteMediaByExactKey", posts: "deletePostById", circles: "deleteCircleById", roleAssignments: "revokeRoleByExactId", profiles: "deleteProfileById", users: "deleteUserById" };

export async function recoverDestructiveQaRun({ manifest, adapter, guardedTarget, confirmedRunId, persist = async () => {} }) {
  validateRecoveryManifest(manifest);
  if (manifest.runId !== confirmedRunId || manifest.targetBinding.projectRef !== guardedTarget.actualRef || manifest.targetBinding.projectRef !== guardedTarget.expectedRef) throw new Error("QA_RECOVERY_TARGET_MISMATCH");
  if (guardedTarget.productionTarget) throw new Error("QA_RECOVERY_PRODUCTION_REJECTED");
  manifest.recoveryAttempts ??= [];
  const attempt = { startedAt: new Date().toISOString(), failures: [] };
  manifest.recoveryAttempts.push(attempt);
  await persist(manifest);
  for (const group of RECOVERY_ORDER) for (const artifact of (manifest.artifacts[group] ?? []).slice().reverse()) {
    if (artifact.residueStatus === "ABSENT") continue;
    artifact.cleanupStatus = "ATTEMPTED"; await persist(manifest);
    try {
      const method = adapter[RECOVERY_METHODS[group]];
      if (typeof method !== "function") throw new Error("QA_RECOVERY_METHOD_MISSING");
      await method.call(adapter, artifact.id, artifact);
      artifact.cleanupStatus = "CLEANUP_RETURNED";
    } catch (error) { artifact.cleanupStatus = "FAILED"; attempt.failures.push({ type: group, id: artifact.id, error: String(error?.message ?? "QA_RECOVERY_CLEANUP_FAILED") }); }
    await persist(manifest);
    try { artifact.residueStatus = (await adapter.verifyArtifactAbsent(artifact))?.absent === true ? "ABSENT" : "REMAINS"; }
    catch (error) { artifact.residueStatus = "VERIFY_ERROR"; attempt.failures.push({ type: group, id: artifact.id, error: String(error?.message ?? "QA_RECOVERY_VERIFY_FAILED") }); }
    await persist(manifest);
  }
  const complete = Object.values(manifest.artifacts).flat().every((artifact) => artifact.residueStatus === "ABSENT");
  manifest.status = complete && attempt.failures.length === 0 ? "RECOVERED" : "RECOVERY_INCOMPLETE";
  attempt.completedAt = new Date().toISOString();
  await persist(manifest);
  return { manifest, exitCode: manifest.status === "RECOVERED" ? 0 : 1 };
}
