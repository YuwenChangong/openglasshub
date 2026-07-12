import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export const RECOVERY_SCHEMA_VERSION = 1;

export function assertPrivateManifestPath(manifestPath, repoRoot = process.cwd()) {
  const absolute = resolve(manifestPath);
  const repo = resolve(repoRoot);
  const rel = relative(repo, absolute);
  if (!isAbsolute(absolute) || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("QA_RECOVERY_MANIFEST_INSIDE_REPO");
  return absolute;
}

export function validateRecoveryManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== RECOVERY_SCHEMA_VERSION || !manifest.runId || !manifest.artifacts) throw new Error("QA_RECOVERY_MANIFEST_INVALID");
  return manifest;
}

export function writeRecoveryManifestAtomic(manifestPath, manifest, repoRoot) {
  const path = assertPrivateManifestPath(manifestPath, repoRoot);
  validateRecoveryManifest(manifest);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  const payload = JSON.stringify({ ...manifest, updatedAt: new Date().toISOString() }, null, 2);
  const fd = openSync(temp, "w");
  try { writeFileSync(fd, payload); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
}

export function loadRecoveryManifest(manifestPath, repoRoot) {
  const path = assertPrivateManifestPath(manifestPath, repoRoot);
  try { return validateRecoveryManifest(JSON.parse(readFileSync(path, "utf8"))); }
  catch (error) { if (error?.message?.startsWith("QA_RECOVERY")) throw error; throw new Error("QA_RECOVERY_MANIFEST_INVALID"); }
}
